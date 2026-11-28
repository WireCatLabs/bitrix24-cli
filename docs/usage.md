# Use it

See which deals are stuck in a stage, move one or read what changed overnight, with commands that take stage names
and field labels as your portal shows them. Your agent runs the same commands when you ask it in your own words.

`sync` copies your deals and leads to your computer, where the reads find them, offline too. `api call` reaches any
other Bitrix24 method. You need a signed-in profile, as [install](installation.md) shows.

**On this page:**

1. [The profile comes first](#the-profile-comes-first)
2. [Sign in](#sign-in)
3. [Sync](#sync)
4. [Read](#read)
5. [Client files](#client-files)
6. [What changed](#what-changed)
7. [Write](#write)
8. [Output for scripts](#output-for-scripts)
9. [Agents](#agents)

## The profile comes first

A profile is a name you choose for one account. It is the first word of every command that uses an account:

```sh
b24 work config show
```

`B24_PROFILE=work` does the same for one shell session. No profile is ever assumed, not even the only one: a
command without one stops with exit code 2 and lists the profiles on this computer.

## Sign in

The webhook, the scopes to tick and removing a profile are on [install](installation.md#sign-in).

### With a local application

A local application acts as the employee who signs in, not the one who made a webhook. Its steps are on
[install](installation.md#with-a-local-application).

## Sync

Deals, leads, pipelines and stages are read from the local WireCat store, the one every WireCat tool searches. `sync`
brings it up to date:

```sh
b24 work sync                    # what changed since the last sync, everything on the first one
b24 work sync --rescan           # everything again, every id too
b24 work store status            # how far each kind is, and how many are stored
```

A sync reads by each record's change time, with an overlap, so a record changed while it ran comes again next time.
Once a day it also lists every id, and marks deleted the ones the portal no longer has. A list that would mark more
than half of them is held back, as a webhook that lost its rights lists none. A sync stops before its deadline or
`--max-pages` and the next one goes on from there.

### Whose deals and leads

A sync copies your own deals and leads, with their clients: those of the user who signed in, the webhook's or the
local application's own user. To copy a colleague's too, list their user ids and your own in
`crm.bitrix24:<portal>.unassigned`. The list replaces your own user, so name yourself in it. No sync copies the whole
CRM, an administrator's either: find any other client on the portal itself.

```sh
b24 work users list                                                         # who is who on the portal
b24 work config set crm.bitrix24:example.bitrix24.ru.unassigned 3327,4410   # user 3327's deals and your own (4410)
b24 work people list name:ivan*                                             # any contact, read from the portal now
```

`example.bitrix24.ru` stands for your portal's host.

| Who signed in | Whose deals and leads a sync may copy | What the profile reads offline |
|---|---|---|
| A Bitrix24 administrator | Anyone's | The whole copy |
| Any other employee | Their own, a dismissed user's, or a user's who is not an employee (an extranet, e-mail or bot user, as Bitrix24's `USER_TYPE` says) | Only the deals and leads assigned to them |
| A webhook without the `user` scope | Only its own user's | As above, by whether its user is an administrator |

The sync checks the list every time. A user it may not take is left out, with the reason in `issues`
(`crm.unassigned-dropped`), and their deals and leads leave the copy.

The sync answer says which `scope` it applied and the webhook's own user (`self`). A deal given to a user you did not
choose leaves the local copy at the next sync, and one given to a chosen user arrives. A deal that leaves the copy
leaves lists and search, and its earlier copy stays in the store file. Only you set `scope`, `self` and
`unassigned`: an agent is refused.

A sync copies only your clients: the contacts and companies assigned to you or to an unassigned user,
and the ones named on the deals and leads it copies. The rest of the portal's client base stays on the portal.

One portal's copy belongs to one user: the first sync remembers the webhook's user as `crm.bitrix24:<portal>.self`.
A sync through a webhook of another user is refused.
`b24 work config unset crm.bitrix24:example.bitrix24.ru.self` gives the copy to the next one.

A profile reads offline only what its own user may read, as the table says. Whether the user is an administrator
comes from the last `sync`. For anyone else, the unassigned deals and those of the users they chose stay out of lists,
`show` (`not_found`), the funnel and `search all`, even in a copy their own sync made. A sign-in that names no portal
user reads none. `session start` again fixes it.

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
b24 work config set crm.bitrix24:example.bitrix24.ru.links review
```

A company type, such as `CUSTOMER`, means nothing by itself, since an admin can rename or add types. Say what a type
means, and the next sync makes each company of that type a customer of your own company, a supplier to it or a
partner of it:

```sh
b24 work config set crm.bitrix24:example.bitrix24.ru.company-types CUSTOMER=customer-of,SUPPLIER=supplier
```

When the webhook lacks the `user` or the `department` scope, the sync reads the rest and says what it could not read
in `issues`. Nothing it stored before is ended for that. Without `user_basic` the employees come without their e-mail
addresses, so an employee is not joined to the same person in your mail. A portal that refuses its own companies
leaves its employees in no company. The sync keeps these two as gaps of the account, which memo's answers name, not
in `issues`.

### Calls

`meetings sync` copies the portal's calls, and `meetings transcribe` turns them into text on this computer. They have
their own page: [Calls](calls.md).

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
back, and the next entry into the same stage opens a new one. A lead's stage is written `lead:<stage id>`.
`b24 work stages list` shows the ids.

```sh
b24 work config set crm.bitrix24:example.bitrix24.ru.stage-tasks \
  '{"C1:WON":{"title":"Send the closing papers","due_days":2},"lead:CONVERTED":{"title":"Call back","due_days":0}}'
b24 work sync          # moves since the last sync open their tasks
```

b24 reads the portal's own stage history, so a deal that passed through a stage between two syncs still gets that
stage's task: a move from "New" through "Quote" to "Won" in one day opens the tasks of both "Quote" and "Won".
Moves made before the setting was first set open none, and neither does a deal's first copy. The task names the
deal, its stage and pipeline, and is due `due_days` days after the sync. Only you set it: an agent is refused. To
stop, `b24 work config unset crm.bitrix24:example.bitrix24.ru.stage-tasks`. In the portal itself, Bitrix24's robot
"Create task" does the same for a portal task.

### Activities and tasks on a deal

With `activities` on, each sync also reads the calls, e-mails, meetings and to-dos on the deals and leads it keeps,
the Bitrix24 tasks bound to them, and the comments in their timelines. `deals show` and `leads show` list them, open
ones first, with their text: an e-mail's body, a task's description, a comment. The first sync reads the last 90
days, each later one what changed since. Only the activities, tasks and comments of the deals and leads the copy keeps
are read.

```sh
b24 work config set crm.bitrix24:example.bitrix24.ru.activities on
b24 work sync
b24 work deals show deal:12
```

It is off until you turn it on, and only you can: an agent is refused. The client's phone number or e-mail address
on a call or a letter is never copied. Tasks need the webhook's or application's `task` scope. Without it the sync
reads the activities and says the tasks were not read.

The portal gives comments one deal or lead per request, so a sync asks each open deal and lead in the copy, and each
closed one that changed since the last sync. A comment does not change its deal: one left on a deal already won or
lost, with nothing else changed, is read once the deal changes. An edited comment keeps its first text.

### Ask memo about a client

`memo` answers from the relationships the sync stores:

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
its `currency`. `--offline` reads the same. Bitrix24's leads have no pipelines, so they stand in one pipeline named
`Leads`.

`people`, `organizations` and `users` are shared CRM commands too, and read the portal itself, so `--offline` refuses
them. A person or organization gives the portal's own fields under `provider_metadata`, each by its code with its
label. A list field gives its option's label, and the option's id as `option_id`. A company's industry, revenue and
currency are there too. `b24 work fields list deals` lists those fields with their type and options, as the last `sync`
stored them. `leads`, `people` and `organizations` work the same way. Their lists filter by those fields too, by
code or label, when the portal can filter by them, and `--json` can add them:

```sh
b24 work organizations list type:CUSTOMER
b24 work organizations list --json=id,name,provider_metadata.UF_CRM_1745512486047
```

A list shows the newest first: `--limit` and `--page` change that. The fields a list can filter by are in its help,
`b24 help deals list`.

Phones and e-mails are your clients' only, unless you are a Bitrix24 administrator. Your clients are the contacts and
companies assigned to you, and the ones on your deals and leads. A list shows anyone else's without them. `people show`
or `organizations show` of one who is not your client gives them, at most 100 such contacts and companies a day (UTC),
counted for you and your agents together. Showing the same one again that day is free, and your own clients are never
counted. The count is kept on this computer, so it guards against an accident and an agent, not against someone who
means to take the base: Bitrix24's own access rights do that.

## Client files

`files list` shows the files of one deal, lead, contact or company, read from the portal now. `files download` saves
one on this computer and reads its text, so `search all` finds it later.

```sh
b24 work files list --deal 12                      # the deal's files, each with an id
b24 work files download deal:12:document:61        # saved in the state folder, its text in the answer
b24 work files download deal:12:document:61 --dir ~/Documents/clients
b24 work files sync                                # prefetches the files of your own deals and leads
```

A record's files come from four places on the portal:

| Source | What it is | Scope |
|---|---|---|
| `field` | A file in one of the record's own file fields | `crm` |
| `document` | A document made from a template: a contract, an invoice, a quote. The PDF when the portal has made it, else the Word file | `crm` |
| `activity` | A file attached to an e-mail, a call or another activity | `crm` and `disk` |
| `comment` | A file attached to a timeline comment | `crm` and `disk` |

A source the webhook may not read is left out, and the answer names it under `issues` with the scope to add. Comment
files are listed without `disk`, since the comment names them, but downloading one needs it. A file in
a field has no name on the portal, so it is listed as the field's name and the file's id. Files on your own records
are free. A colleague's record counts toward the same limit of 100 a day as their clients' phones and e-mails, unless
you are an administrator. `sync` never downloads a file. `files sync` downloads the last week's files of your own deals and leads,
within limits kept in the `crm.bitrix24:<portal>.files.*` settings (`max_files`, `max_file_mb`, `max_run_mb`,
`run_minutes`, `days`, `max_total_mb`), which `config set` changes.

## What changed

`changes list` shows what the syncs saw change in the copy: deals and leads made, moved, won, lost and given another
owner, activities added and done, and new contacts, newest first. It reads the last day unless `at:` says otherwise.

```sh
b24 work changes list "at>=1d"
b24 work changes list change:won "at>=7d" --json
```

`--format report` turns the window into a morning digest. Run by a schedule, each digest starts where the last one
ended:

```sh
b24 work schedule command morning --at 08:00 -- changes list "at>=1d" --format report
```

The schedule shows each digest as a desktop notice. `--deliver-to` also sends it to your Telegram or mailbox through
your own `tg` or mail tool, as `b24 help schedule command` shows.

## Write

```sh
b24 work deals create --title "Kitchen for Example" --pipeline Sales --amount 15000 --currency EUR
b24 work deals update deal:12 --amount 18000 --close-date 2026-12-24
b24 work deals move deal:12 "Contract signed"
b24 work deals close deal:12 won
b24 work deals delete deal:12                   # asks first
b24 work leads update lead:7 --field UF_CRM_SOURCE=Website
b24 work people create --first-name Anna --last-name Ivanova
b24 work organizations update 9 --name "Example LLC" --field "Lead source=Fair"
```

A write sends one request, then reads the record back into the store. `--stage` takes a stage of the
record's own pipeline by name or id, and checks the `move` key too. A won or lost stage checks the `close` key as
well. `close` moves it to the first won or lost stage of its pipeline. `--field <label or code>=<value>` sets one of the
portal's own fields, as `fields list` names them. A list field takes its option's label or id, and an empty value
clears the field. A field that names a stage, a pipeline or an owner is refused: those have their own options.

A field that holds several values takes `--field` once per value. A label works once a `sync` has stored the
fields. Before that, name the field by its code. `people` and `organizations` take their names, `--position` and
`--owner` as options. `api call` writes any other field.

Each write answers an `operation_id`, which the run journal keeps. A write is sent once, and again only when the
portal refused it for its request limit, which it does before making anything. If it ends with
`outcome_unknown`, the portal may have made it: look at the record first (`sync`, then `show`), and write it again only
if it is not there, because Bitrix24 would make a repeat a second time. `--dry-run` sends nothing and names every
permission key the command checks, with the option that adds each one: a stage's move and close keys, and
`crm.assign-others` for another owner. Assigning a record to another employee is refused until you allow it, because
Bitrix24 tells that employee:
`b24 work config set permissions.crm.assign-others allow`.

`b24 work api call crm.deal.get --body '{"id":12}'` calls any other Bitrix24 method, here a read of deal 12. It
checks the same permissions as the command that does the same thing, and refuses writes that send messages, start the
portal's automation or create tasks until you allow them. Only a Bitrix24 administrator reads contacts, companies or
leads through it (`crm.contact.*`, `crm.company.*`, `crm.lead.*`, `crm.item.*` of type 1, 3 or 4, requisites, addresses
and duplicate searches): for anyone else they are refused, whatever the permissions say. `b24 api list` and `b24 api show crm.deal.update` show what
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
