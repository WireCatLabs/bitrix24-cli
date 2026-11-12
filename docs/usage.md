# Use it

This page explains how a command is built, and how an agent uses the tool. Read it before your first command.

## The profile comes first

A profile is a name you choose for one account. It is the first word of every command that uses an account:

```sh
b24 work config show
```

`B24_PROFILE=work` does the same for one shell session. No profile is ever assumed, not even the only one: a
command without one stops with exit code 2 and lists the profiles on this computer.

## Sign in

Make an incoming webhook in Bitrix24 (Developer resources → Other → Incoming webhook) with the scopes `crm`,
`user_basic` (or `user`) and `department`, and copy its address. Without `user_basic` the sync gets no employee's
e-mail; without `department` it gets no reporting lines; see [Who is who](#who-is-who). Add `task` to read the
Bitrix24 tasks on your deals ([Activities and tasks](#activities-and-tasks-on-a-deal)). Then:

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

One webhook belongs to one profile. `session start` refuses a webhook that another profile here already uses (the
same portal and the same employee), names that profile, and says how to sign it in again or remove it. Two profiles
on one portal are fine when each has its own employee's webhook.

When the portal answers that the webhook may not read who made it, the webhook lacks the "Users (basic)" right
(`user_basic`; «Пользователи (базовый)» on a Russian portal). Open Developer resources → Integrations, edit the
webhook, tick that right and save, then run `session start` again with the address the webhook shows.

### With a local application

A webhook acts as the employee who made it. A local application acts as the employee who signs in, and its tokens
last only an hour, renewed by `b24`. A Bitrix24 administrator, or an employee allowed to, creates it once:

1. Developer resources → Common use cases → Other → Local application.
2. Choose **Server** mode. Set **Your handler path** to `https://wirecat.dev/webhooks/apps/b24-callback`. Leave
   **Initial installation path** and the menu item texts empty, and **Application completes the installation itself**
   off, so the portal installs it on save.
3. Tick the access permissions `crm`, `user_basic` (or `user`) and `department`, `task` too for Bitrix24 tasks, and
   save.
4. Copy the **Application ID (client_id)** and the **Application key (client_secret)** Bitrix24 shows.

Then sign in:

```sh
b24 work session start --portal example.bitrix24.ru --client-id local.0123abcd.45678901
```

`b24` asks for the key without showing it, or reads it from stdin or `B24_BITRIX24_CLIENT_SECRET`, and opens the
portal's sign-in in the browser. After you allow the application, the page at `wirecat.dev/webhooks/apps/b24-callback`
passes the answer back to `b24` on this computer. If the browser cannot reach `b24`, for example over SSH, paste the
address the browser ended on into the terminal. `session status` then shows `kind: app`. Setting a webhook again with
`session start` forgets the application's sign-in, and the other way round. `session end` forgets the tokens on this
computer; Bitrix24 has no way to revoke them, so delete the application in the portal to stop them.

### Remove a profile

```sh
b24 work account remove --keep-data --dry-run   # what it would remove and keep, changing nothing
b24 work account remove --keep-data             # forget the profile; its copy of the portal stays searchable
b24 work account remove --delete-data --yes     # also delete the portal's deals, leads, contacts and companies
```

`account remove` forgets the profile on this computer: its webhook address, its settings and its files. It asks first,
or takes `--yes`. The webhook itself stays in Bitrix24 until you delete it there. The store keeps one copy of a
portal, so `--delete-data` refuses while another profile here reads the same portal; remove that one first, or use
`--keep-data`.

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

A sync copies the deals and leads of the Bitrix24 users you choose in `crm.bitrix24:<portal>.unassigned`, and the
clients on them. Until you choose, it copies the deals and leads of the user who signed in, the webhook's or the
local application's own user. A chosen list replaces that user, who is left out unless named: choose when the webhook
is a colleague's, or when you work on someone else's portal. No sync copies the whole CRM, an administrator's either: find any
other client on the portal itself.

```sh
b24 work users list                                                    # who is who on the portal
b24 work config set crm.bitrix24:example.bitrix24.ru.unassigned 3327   # copy the deals and leads of user 3327
b24 work config set crm.bitrix24:example.bitrix24.ru.scope mine        # the default; an old "all" is refused
b24 work people list name:ivan*                                        # any contact, read from the portal now
```

`example.bitrix24.ru` stands for your portal's host. A Bitrix24 administrator's webhook may choose anyone. Anyone
else's may choose only themselves, a dismissed user or a user who is not an employee (an extranet, e-mail or bot user, as
Bitrix24's `USER_TYPE` says). The sync checks the list every time: a user it may not take is left out, with the reason
in `issues` (`crm.unassigned-dropped`), and their deals and leads leave the copy. A webhook without the `user` scope
keeps only its own user. A `scope all` set before is refused at the next sync, which says to set `mine`; once set,
the deals and leads of users you did not choose are marked deleted here.

The sync answer says which `scope` it applied and the webhook's own user (`self`). A deal given to a user you did not choose
leaves the local copy at the next sync, and one given to a chosen user arrives. Switching to `mine` marks the others deleted here, from the copy alone, without asking the portal. Deleted
here means they leave lists and search; their earlier copy stays in the store file. If you never set `scope` and
`mine` would mark more than half of the stored deals or leads deleted, the sync keeps them and says so
(`crm.narrowing-held`) until you set `scope` to `mine`. Only you set `scope`, `self` and `unassigned`: an
agent is refused.

Under `mine` a sync copies only your clients: the contacts and companies assigned to you or to an unassigned user,
and the ones named on the deals and leads it copies. The rest of the portal's client base stays on the portal.

One portal's copy belongs to one user: the first sync remembers the webhook's user as `crm.bitrix24:<portal>.self`.
A sync through a webhook of another user is refused;
`b24 work config unset crm.bitrix24:example.bitrix24.ru.self` gives the copy to the next one.

### Who is who

The sync also stores who belongs where, as relationships between people, organizations and deals. Every WireCat
tool reads them from the same store.

| In Bitrix24 | In the store |
|---|---|
| A company | An organization. A company of the same name elsewhere stays a separate organization. |
| Your own companies ("My companies") | Organizations marked as your own, read on every sync. |
| A contact | A person, joined to one you already have only by the same e-mail address. |
| A contact's companies | The person is a member of each, with the role `contact`. The first company is the main one. The job title (`post`) is kept beside it, never as a role. |
| A deal's or lead's contacts | People on the deal with the role `contact`. The main contact is marked. |
| The person responsible for a deal or lead | The deal's `owner`. |
| An employee (a portal user) | A person, a member of your own company with the role `employee`. An employee who left keeps the person, and the membership ends. |
| A department head | Each employee reports to the head of their department, and a head to the head of the parent department. |
| A lead turned into a deal | The lead points to its deal. |

Bitrix24 does not say everything, so some relationships come only from you:

- A deal contact's part (decision-maker, influencer). Bitrix24 keeps no role for a deal's contact.
- Who a contact reports to. Bitrix24 has reporting lines only between its own employees.
- A company's parent company. Bitrix24 has no field for it.
- When a relationship started or ended. Bitrix24 gives no dates.

A relationship the sync stores is `reported`: Bitrix24 says so, and you have not confirmed it. It counts in every
answer. When Bitrix24 stops saying it, for example when a contact leaves a company, the sync ends it: it stays, with
the date it ended, and is never deleted. A relationship you made or confirmed is never changed by a sync. If you
removed one, the sync does not write it again.

To have new relationships wait for your review instead, set the account's `links` setting to `review`. The account is
`bitrix24:` and your portal's address:

```sh
b24 work config set crm.bitrix24:example.bitrix24.com.links review
```

A company type, such as `CUSTOMER`, means nothing by itself, since an admin can rename or add types. Say what a type
means, and the next sync makes each company of that type a customer of your own company, a supplier to it or a
partner of it:

```sh
b24 work config set crm.bitrix24:example.bitrix24.com.company-types CUSTOMER=customer-of,SUPPLIER=supplier
```

When the webhook lacks the `user` or the `department` scope, the sync reads the rest and says what it could not read
in `issues`. Nothing it stored before is ended for that. Without `user_basic` the employees come without their e-mail
addresses, so an employee is not joined to the same person in your mail; a portal that refuses its own companies
leaves its employees in no company. The sync keeps these two as gaps of the account, which memo's answers name, not
in `issues`.

### Keep it up to date

`schedule` installs a timer (a systemd user timer on Linux, a launchd agent on macOS, a Task Scheduler task on
Windows) that runs `sync` on its own:

```sh
b24 work schedule command crm --every 1h -- sync
b24 work schedule list                           # the schedule and how its last run went
b24 work schedule remove crm
```

### A task when a deal enters a stage

`stage-tasks` names stages, and each deal or lead that moves into one of them opens a task on this computer, beside
your other WireCat tasks. The sync that brings the move opens it, once per move: a task you dismiss does not come
back, and the next entry into the same stage opens a new one. A lead's stage is written `lead:<stage id>`;
`b24 work stages list` shows the ids.

```sh
b24 work config set crm.bitrix24:example.bitrix24.ru.stage-tasks \
  '{"C1:WON":{"title":"Send the closing papers","due_days":2},"lead:CONVERTED":{"title":"Call back","due_days":0}}'
b24 work sync          # moves since the last sync open their tasks
```

Moves made before the setting was first set open none, and neither does a deal's first copy. The task names the
deal, its stage and pipeline, and is due `due_days` days after the sync. Only you set it: an agent is refused. To
stop, `b24 work config unset crm.bitrix24:example.bitrix24.ru.stage-tasks`. In the portal itself, Bitrix24's robot
"Create task" does the same for a portal task.

### Activities and tasks on a deal

With `activities` on, each sync also reads the calls, e-mails, meetings and to-dos on the deals and leads it keeps,
and the Bitrix24 tasks bound to them. `deals show` and `leads show` list them, open ones first, with their text: an
e-mail's body, a task's description. The first sync reads the last 90 days, each later one what changed since.

```sh
b24 work config set crm.bitrix24:example.bitrix24.ru.activities on
b24 work sync
b24 work deals show deal:12
```

It is off until you turn it on, and only you can: an agent is refused. The client's phone number or e-mail address
on a call or a letter is never copied. Tasks need the webhook's or application's `task` scope; without it the sync
reads the activities and says the tasks were not read. Timeline comments are not read yet: the portal lists them
one deal at a time.

### Ask memo about a client

The relationships the sync stores are what `memo` answers from. These commands need a `memo` version that has them,
which is not released yet:

```sh
memo context person:12                    # a person's companies, deals and reporting lines, with what was not read
memo organizations context organization:4 # a company's people, deals and open work
memo deals context deal:7 --brief         # a deal's people with their parts, its owner and stage
```

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

Phones and e-mails are your clients' only, unless you are a Bitrix24 administrator. Your clients are the contacts and
companies assigned to you, and the ones on your deals and leads. A list shows anyone else's without them. `people show`
or `organizations show` of one who is not your client gives them, at most 100 such contacts and companies a day (UTC),
counted for you and your agents together; showing the same one again that day is free, and your own clients are never
counted. The count is kept on this computer, so it guards against an accident and an agent, not against someone who
means to take the base: Bitrix24's own access rights do that.

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
portal's automation or create tasks until you allow them. Only a Bitrix24 administrator reads contacts or companies
through it (`crm.contact.*`, `crm.company.*`, `crm.item.*` of type 3 or 4, requisites, addresses and duplicate
searches): for anyone else they are refused, whatever the permissions say. `b24 api list` and `b24 api show crm.deal.update` show what
each method checks.

## Output for scripts

Every command except `mcp serve` on stdin and stdout takes `--json`, and prints one JSON value on stdout. Errors are
JSON on stderr, with a code to branch on. The [command reference](commands.md) lists the codes.

## Agents

`b24 skill install` puts the tool's skill where Claude Code, Codex, Gemini CLI and OpenClaw look for it.
`b24 skill install --for hermes` also adds that folder to Hermes Agent's own settings, so a bare `skill install`
leaves Hermes out. `b24 guide` lists scenarios for common tasks, each as commands in order and why.

`b24 work mcp serve` serves the profile's commands over MCP, for a client that cannot run commands:

```sh
claude mcp add b24 -- b24 work mcp serve
```

The server offers every command, the ones that write included, and the profile's permissions decide what runs. Over
MCP a write at `ask` goes ahead, since nobody is there to answer. Set `readonly` or `deny` for the writes an agent
must not make, or turn on approval in the agent's client: see [Permissions](permissions.md#agents-and-mcp). Adding the
server to Claude Code or Codex, several profiles in one server, and ChatGPT or Claude in the browser are on
[MCP](mcp.md).
