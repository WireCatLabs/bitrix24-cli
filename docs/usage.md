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

## Read

Each kind of record has `list` and `show`:

```sh
b24 work deals list outcome:open pipeline_id:1 amount>=10000
b24 work deals list kitchen                    # a word matches part of the title
b24 work leads list stage_id:NEW updated_at>=7d
b24 work people show "Anna Ivanova"            # by id, or by the exact name
b24 work stages list entity:leads              # each stage with its outcome: open, won or lost
```

`show` gives the portal's own fields under `provider_metadata`, each by its code with its label; a list field gives
its option's label, and the option's id as `option_id`. `b24 work fields list deals` lists those fields with their
type and options; `leads`, `people` and `organizations` work the same way.

A list filters by those fields too, by code or label, when the portal can filter by them, and `--json` can add them:

```sh
b24 work deals list lead_source:Website rooms:3   # a label with spaces: lead_source or Lead\ source
b24 work deals list --json=id,title,provider_metadata.UF_CRM_1745512486047
```

A list shows the newest first, 20 at a time: `--limit`, `--page` and `--all` change that. The fields a list can
filter by are in its help, `b24 help deals list`. When two records have the name you gave, `show` refuses and lists
both, so you can pick one by its id.

## Write

```sh
b24 work deals create --title "Kitchen for Acme" --body '{"opportunity":15000,"currencyId":"EUR"}'
b24 work deals update 42 --title "Kitchen and hall"
b24 work deals move 42 --stage "Contract signed"
b24 work people create --first-name Anna --last-name Ivanova
b24 work leads update 7 --set Source=Website --set Tags=Hot --set Tags=Repeat
```

`--set "<label or code>=<value>"` sets one of the portal's own fields, as `fields list` names them; a list field takes
its option's label or id, and a field that holds several values takes `--set` once per value. `--set` wins over
`--body` for the same field.

`--body` takes the other fields in Bitrix24's own names, the ones its REST 3.0 reference lists. Each write answers
an `operation_id`. If a write ends with `outcome_unknown`, repeat it with `--operation-id <that id>`: Bitrix24 then
answers from its record of the first try instead of making a second record. `--dry-run` shows what a write would do
and sends nothing. Assigning a record to another employee is refused until you allow it, because Bitrix24 tells that
employee: `b24 work config set permissions.crm.assign-others allow`.

`b24 work api call <method> --body <json>` calls any other Bitrix24 method. It checks the same permissions as the
command that does the same thing, and refuses writes that send messages, start the portal's automation or create
tasks until you allow them. `b24 api list` and `b24 api show <method>` show what each method checks.

## Output for scripts

Every command except `mcp serve` on stdin and stdout takes `--json`, and prints one JSON value on stdout. Errors are JSON on stderr, with a code to branch
on. The [command reference](commands.md) lists the codes.

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
