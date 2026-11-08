# Use it

This page explains how a command is built, and how an agent uses the tool. Read it before your first command.

## The profile comes first

A profile is a name you choose for one account. It is the first word of every command that uses an account:

```sh
b24 personal config show
```

`B24_PROFILE=personal` does the same for one shell session. No profile is ever assumed, not even the only one: a
command without one stops with exit code 2 and lists the profiles on this computer.

## Sign in

Make an incoming webhook in Bitrix24 (Developer resources → Other → Incoming webhook) with the scopes `crm` and
`user`, and copy its address. Then:

```sh
b24 work session start
```

`b24` asks for the address without showing it, or reads it from stdin, checks it against the portal and keeps it in
the system keyring. `--credential-storage file` keeps it in a private file instead, for a computer with no keyring.
`B24_TOKEN` set to the address is used before either. The address is the password: anyone who has it can do what
the webhook's employee can.

`b24 work session status --check` shows the employee the webhook acts as, and whether they are an admin.
`b24 work session end` forgets the address on this computer; the webhook itself stays in Bitrix24 until you delete
it there. `b24 session list` lists the profiles on this computer.

## Sync

Deals, leads, pipelines and stages are read from the local WireCat store, the one every WireCat tool searches. `sync`
brings it up to date:

```sh
b24 work sync                    # what changed since the last sync; everything on the first one
b24 work sync --rescan           # everything again, every id too
b24 work store status            # how far each kind is, and how many are stored
```

A sync reads by each record's change time, with an overlap, so a record changed while it ran comes again next time.
Once a day it also lists every id, and marks deleted the ones the portal no longer has; a list that would mark more
than half of them is held back, as a webhook that lost its rights lists none. A sync stops before its deadline or
`--max-pages` and the next one goes on from there.

### Whose deals and leads

By default a sync copies only the deals and leads whose responsible person is the webhook's own user. Bitrix24 always
names a responsible person (the creator, unless someone else is set), so it has no unassigned deals: name the users
whose deals count as nobody's, such as the one a website form or an integration creates them as. A manager copies
every one:

```sh
b24 work config set crm.bitrix24:<portal>.unassigned 15,31   # these users' deals and leads count as unassigned
b24 work config set crm.bitrix24:<portal>.scope all          # every deal and lead; `mine` goes back
```

`<portal>` is the portal's host, such as `example.bitrix24.ru`. The sync answer says which `scope` it applied and the
webhook's own user (`self`). A deal given to another user leaves the local copy at the next sync. Switching to `all`
lists deals and leads in full again; switching to `mine` marks the others deleted here, from the copy alone, without
asking the portal. Deleted here means they leave lists and search; their earlier copy stays in the store file. If
you never set `scope` and `mine` would mark more than half of the stored deals or leads deleted (the webhook's user
holds few of them), the sync keeps them and says so (`crm.narrowing-held`) until you set `scope` to `mine` or `all`.
Only you set `scope`, `self` and `unassigned`: an agent is refused.
Contacts and companies are always copied whole.

One portal's copy belongs to one user: the first sync remembers the webhook's user as `crm.bitrix24:<portal>.self`.
A sync through a webhook of another user is refused; `b24 work config unset crm.bitrix24:<portal>.self` gives the
copy to the next one.

## Read

```sh
b24 work deals list status:open                 # open, won or lost
b24 work deals list stage:"Quote sent" pipeline:Sales
b24 work leads list --json
b24 work deals show deal:12                     # by the ref a list prints
b24 work pipelines show Sales                   # its funnel: how many reached each stage
b24 work stages list kind:lead                  # each stage with its outcome: open, won or lost
b24 work people show "Anna Ivanova"             # contacts and companies by id, or by the exact name
```

`deals`, `leads`, `pipelines` and `stages` are WireCat's shared CRM commands: the same words, query and answer in
every CRM tool. A deal or lead answers its `pipeline`, `stage`, `status`, `close_date`, and `amount` as a decimal in
its `currency`; `--offline` reads the same. Bitrix24's leads have no pipelines, so they stand in one pipeline named
`Leads`.

`people` and `organizations` read the portal itself. Their `show` gives the portal's own fields under
`provider_metadata`, each by its code with its label; a list field gives its option's label, and the option's id as
`option_id`. `b24 work fields list deals` lists those fields with their type and options, as the last `sync`
stored them; `leads`, `people` and `organizations` work the same way. Their lists filter by those fields too, by
code or label, when the portal can filter by them, and `--json` can add them:

```sh
b24 work organizations list industry:IT
b24 work organizations list --json=id,name,provider_metadata.UF_CRM_1745512486047
```

A list shows the newest first: `--limit`, `--page` and, for `people` and `organizations`, `--all` change that. The
fields a list can filter by are in its help, `b24 help deals list`.

## Write

```sh
b24 work deals create --title "Kitchen for Example" --pipeline Sales --amount 15000 --currency EUR
b24 work deals update deal:12 --amount 18000 --close-date 2026-12-24
b24 work deals move deal:12 "Contract signed"
b24 work deals close deal:12 won
b24 work deals delete deal:12                   # asks first
b24 work leads update lead:7 --field UF_CRM_SOURCE=Website
b24 work people create --first-name Anna --last-name Ivanova
b24 work organizations update 9 --field "Lead source=Fair" --body '{"revenue":1000}'
```

A deal or lead write sends one request, then reads the record back into the store. `--stage` takes a stage of the
record's own pipeline by name or id, and checks the `move` key too; a won or lost stage checks the `close` key as
well. `close` moves it to the first won or lost stage of its pipeline. `--field <label or code>=<value>` sets one of the
portal's own fields, as `fields list` names them; a list field takes its option's label or id, and an empty value
clears the field. A field that names a stage, a pipeline or an owner is refused: those have their own options.

For `people` and `organizations`, `--field "<label or code>=<value>"` takes the label too, and a field that holds
several values takes `--field` once per value; `--body` takes the other fields in Bitrix24's own REST 3.0 names.

Each write answers an `operation_id`, which the run journal keeps. A write is sent once. If it ends with
`outcome_unknown`, the portal may have made it: look at the record first (`sync`, then `show`), and write it again only
if it is not there, because Bitrix24 would make a repeat a second time. `--dry-run` sends nothing and names every
permission key the command checks, with the option that adds each one: a stage's move and close keys, and
`crm.assign-others` for another owner. Assigning a record to another employee is refused until you allow it, because
Bitrix24 tells that employee:
`b24 work config set permissions.crm.assign-others allow`.

`b24 work api call crm.deal.get --body '{"id":12}'` calls any other Bitrix24 method, here a read of deal 12. It
checks the same permissions as the command that does the same thing, and refuses writes that send messages, start the
portal's automation or create tasks until you allow them. `b24 api list` and `b24 api show crm.deal.update` show what
each method checks.

## Output for scripts

Every command except `mcp serve` on stdin and stdout takes `--json`, and prints one JSON value on stdout. Errors are
JSON on stderr, with a code to branch on. The [command reference](commands.md) lists the codes.

## Agents

`b24 skill install` puts the tool's skill where Claude Code, Codex, Gemini CLI and OpenClaw look for it.
`b24 skill install --for hermes` also adds that folder to Hermes Agent's own settings, so a bare `skill install`
leaves Hermes out. `b24 personal mcp serve` serves the profile's commands over MCP, on stdin and stdout:

```sh
claude mcp add b24 -- b24 personal mcp serve
```

The server offers every command, the ones that write included. The profile's permissions decide what runs; see
[settings](configuration.md#permissions).

For ChatGPT and Claude in the browser,
`b24 personal mcp serve --http --public-url https://laptop.example.ts.net` serves on `127.0.0.1` (port 8765, or
`--port`) behind your own tunnel. A browser app logs in with a one-time code that the command prints;
`b24 personal mcp revoke` ends every login. `b24 personal mcp server start` runs the same
server in the background, `mcp server status` shows its port, the login code and the apps logged in, and
`mcp server stop` ends it.
