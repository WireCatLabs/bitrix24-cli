# Changelog

Notable changes to `@wirecat/bitrix24-cli`. One section per version, newest first.

## 0.17.0 — 12.11.2026

### Fixed

- `crm sync` with activities on also keeps an e-mail, call or meeting whose own owner is a contact or company and
  that is only bound to your deal or lead. Before, such an activity never reached `deals show`.
- `crm sync` with activities on reads only the activities on your own deals and leads, fifty deals or leads per
  request, instead of every activity on the portal. The first read of a large portal took about four minutes for a
  handful of activities; it now takes as many requests as you have deals and leads, divided by fifty.

## 0.16.0 — 12.11.2026

### Added

- **Activities and tasks on deals and leads.** With `crm.bitrix24:<portal>.activities` set to `on`, `sync` also reads
  the calls, e-mails, meetings and to-dos on the deals and leads it keeps, and the Bitrix24 tasks bound to them;
  `deals show` and `leads show` list them, open ones first. The first sync reads 90 days. The client's phone or
  e-mail on an activity is never copied. Off by default and set by the owner only; tasks need the `task` scope.
  ([usage](docs/usage.md#activities-and-tasks-on-a-deal))

### Fixed

- **Built on cli-core 0.647.0** (was 0.645.0). `doctor --help` shows its Returns and Example again. What changed is in
  [cli-core's changelog](https://github.com/WireCatLabs/cli-core/blob/main/CHANGELOG.md).

## 0.15.0 — 12.11.2026

### Added

- **`account remove` forgets a profile.** `b24 <profile> account remove --keep-data` forgets the webhook address or the
  local application's sign-in, the profile's settings and its files on this computer, and leaves its copy of the portal in the store, still
  searchable; `--delete-data` also deletes the portal's deals, leads, contacts, companies and sync state. It asks
  first, or takes `--yes`; `--dry-run` lists what it would remove and keep. It is cli-core's shared command, with
  the same answer as the other WireCat tools, so WireCat Desktop removes a Bitrix24 account the same way. The webhook
  itself stays in Bitrix24. `--delete-data` refuses (reason `account-remove.portal-shared`) while another profile
  here reads the same portal, since the store keeps one copy of it.
- **A task when a deal or lead enters a stage.** The setting `crm.bitrix24:<portal>.stage-tasks` names stages, and
  each `sync` opens a local task for every deal or lead that moved into one of them since the last sync, once per
  move. Only you set it; moves made before it was first set open none. See
  [a task when a deal enters a stage](docs/usage.md#a-task-when-a-deal-enters-a-stage).
- **Shell completion:** `b24 complete zsh` prints the script to source; bash, fish and PowerShell too.
- **The shared store's file commands and problem reports.** `b24 store backup`, `check`, `repair`, `restore` and the
  rest look after the one store file every WireCat tool shares, and `b24 doctor reports create` writes a report to
  send with a problem. An agent over MCP sees them too, each with its permission like any write.
- **`b24` tells you when a newer version is out**, after a command that succeeded, on stderr. `update_check: false`
  or `B24_NO_UPDATE_CHECK=1` turns it off.

### Changed — may break callers

- **On cli-core 0.644.0.** A CRM list page answers `hasMore` and `nextCursor`, cli-core's one list shape.
- **`session start` refuses a webhook another profile already uses.** The same portal and the same employee as a
  profile already signed in on this computer is a `conflict` with reason `session.duplicate`, which names that
  profile and says how to sign it in again or remove it. Nothing is asked of the portal. Signing the same profile in
  again, and another employee's webhook on the same portal, still work.

### Fixed

- **A webhook without the user scope says what to tick.** When `user.current` answers `INSUFFICIENT_SCOPE`,
  `session start` says the webhook lacks "Users (basic)" (`user_basic`, «Пользователи (базовый)»), where to add it on
  the portal (Developer resources → Integrations, edit the webhook) and to sign in again with the address it shows.
  The reason stays `webhook.scope-missing`; the sign-in stays refused.
- **A sync copies your own deals and leads without any setup.** Until you choose users in
  `crm.bitrix24:<portal>.unassigned`, a sync copies the deals and leads of the user who signed in, and their clients.
  It used to stop with `configuration_error`, which WireCat Desktop showed as `config.invalid`, until a `config set`
  was run in a terminal. A chosen list works as before, see [whose deals and leads](docs/usage.md#whose-deals-and-leads).
- **A stored `scope all` names its reason.** The refusal carries `bitrix.scope-all-refused`, where it showed the
  general `config.invalid`.
- **A lead keeps its own person and company.** A lead often has no contact or company linked; its name and company
  were in the lead's own fields, and `sync` dropped them, so «Иван Петров, ООО Ромашка» was found only by the lead's
  title. `b24` now reads `name`, `secondName`, `lastName` and `companyTitle` and gives them to the store as the lead's
  contact and company name. With a cli-core that keeps them, `leads show` answers `contact_name` and `company_name`
  and `search all` finds the lead by them. They are given to everyone; only the phones and e-mails of other people's
  clients stay hidden.

## 0.14.0 — 12.11.2026

### Added

- **`b24 guide` lists scenarios for common tasks**, each as commands in order with why: `first-sync` (the first sync
  and the pipeline board), `keep-in-sync` (a timer and search) and `safe-agent-writes` (an agent over MCP whose writes
  stay yours). `b24 guide <name> --json` gives one as data.
- **[MCP](docs/mcp.md) and [Permissions](docs/permissions.md) pages.** How to add `b24` to an agent, what the
  agent sees and what it is never offered; each level, the built-in levels, the keys one command checks, and the
  checks no level lifts.
- **Sign-in through a local application.** `b24 <profile> session start --portal <host> --client-id <id>` signs in
  through a local application you create in the portal, in the browser, and acts with the rights of the employee who
  signs in. The application key is asked without showing it, or read from stdin or `B24_BITRIX24_CLIENT_SECRET`. The
  sign-in returns through `https://wirecat.dev/webhooks/apps/b24-callback`, or the address you paste. Tokens are renewed
  by themselves. `session status` and `session list` show the kind of sign-in, and `session end` forgets either. The
  incoming webhook stays the quick way; see [sign in](docs/usage.md#with-a-local-application).

### Fixed

- **The quick start copies deals.** The [README](README.md) now chooses whose deals and leads to copy before the
  first `sync`, which copies nothing until then. It no longer says an administrator copies the whole CRM, says that
  over MCP a delete set to `ask` runs, and names `wcat-b24` for when another package's `b24` command is found first.
  [Troubleshooting](docs/troubleshooting.md) has the "no CRM user is chosen" error.
- **Over MCP, `ask` does not stop a write.** The [README](README.md), [security](docs/security.md) and the first
  screen told owners to set `deals.move` to `ask` against the portal's robots, which stops a move only at a terminal:
  over MCP nobody answers, so the write goes ahead. They now say to set `readonly` or `deny`, or to turn on approval
  in the agent's client.
- **The agent skill covers what an agent needs.** `b24 skill show` now has exit codes and error reasons, MCP and the
  `ask` trap, the first setup from the webhook to the first sync, the boundaries of a write, and the traps.
- The examples use the profile `work` throughout, in place of `personal`.
- **`b24 commands` lists the CRM by section.** Deals, leads, contacts and companies split into Read and Write,
  pipelines, stages, fields, products, users and `api` are under Read, `sync` under Automate and `session` under
  Set up; before, most of `b24` was under Other.
- **The two local state files are written atomically and stay private.** The list of your own companies and the day's
  count of other people's clients shown now go through a temporary file and a rename, as the settings file does.
- **A daily `sync` no longer reads every client again.** A round of changes read every contact and company named on
  the chosen users' deals and leads, whether or not anything changed: on a portal with 50,000 deals that was about
  300 requests and close to three minutes for a sync with nothing new. It now reads only the clients of the deals and
  leads that changed, and lists the users' deals for their clients once a sync instead of once for contacts and once
  for companies.

## 0.13.0 — 11.11.2026

### Changed — may break callers

- **Only a Bitrix24 administrator's webhook deletes or clears in the CRM.** For any other webhook, `b24` refuses
  `deals delete`, `leads delete`, an `api call` to a method that deletes (its name ends in `.delete`,
  `.deletefieldvalue` or `.markdeleted`), an update or `.set` that sets a field to nothing (an empty value, `null`,
  `[]`, a `0` company, contact or lead link, or a phone or e-mail marked `DELETE: Y`), and `batch`. The refusal is a
  `permission_error` with reason `employee.delete`, `employee.clear` or `employee.batch`, and no permission level
  lifts it. A create may still leave fields empty.
- **Only a Bitrix24 administrator's webhook unlinks records or merges duplicates.** For any other webhook, `api call`
  refuses a method whose name ends in `.unbind`, such as `crm.timeline.bindings.unbind`, with reason
  `employee.unbind`, and a merge of duplicates, `crm.entity.mergeBatch`, which deletes all but one of the records,
  with reason `employee.merge`. No permission level lifts it, as for deletes. `crm.deal.contact.delete` and
  `crm.deal.contact.items.delete` already counted as deletes.
- **A portal's account is stored as work.** The first `sync`, write or read of a profile stores a new portal's account
  with scope `work`, so work views and meeting preparation read its copy and personal reads leave it out. A portal
  already in the store keeps the scope it has, which is `personal` in every store so far: switch it once with
  `memo groups update bitrix24:<portal> --scope work` (memo 0.131.81 or later). A sync never changes a scope back.

## 0.12.0 — 10.11.2026

### Added

- `store apply` removes, from a copy made under `scope mine`, the contacts that no deal or lead of the chosen users
  names and that belong to no kept company, and the people they leave empty. Without `--yes` it only counts. A sync
  that narrows the copy, or `sync --rescan`, does this itself, and its answer gives the counts as `contacts_removed`.
- **Built on cli-core 0.631.0** (was 0.630.0). The store moves to version 64 on first open: saving or removing a
  deal's link to a person no longer reads every such link. What changed is in
  [cli-core's changelog](https://github.com/WireCatLabs/cli-core/blob/main/CHANGELOG.md).

### Changed — may break callers

- A sync copies only the deals and leads of the users the owner chooses in `crm.bitrix24:<portal>.unassigned`, and
  their clients. No one is chosen by default, the webhook's own user included: until the owner chooses, a sync is
  refused (`configuration_error`, reason `bitrix.scope-users-unchosen`) and names the `config set` to run. Watch
  for: an existing copy fails its next sync until the owner chooses.
- No sync copies the whole CRM any more, an administrator's either: a sync under a stored `scope all` is refused
  (reason `bitrix.scope-all-refused`, was `bitrix.scope-all-admin-only`) and says to set `mine`. Once set, deals and
  leads of users not chosen are marked deleted in the local copy. Find any other client live on the portal with
  `people list` or `organizations list`.
- An employee's webhook may choose themselves, a dismissed user or a non-employee; an administrator's, anyone.

### Fixed

- A contact's name no longer carries the `null` or `null #<id>` a portal import left in its name fields
  ("Ярослав Орлов null #907" is now "Ярослав Орлов"). 101,876 of 114,165 contacts on one live portal had it. Watch
  for: a name stored before keeps the leftover until that contact is synced again.
- **Built on cli-core 0.630.0** (was 0.623.0). The store moves to version 63 on first open. A CRM contact no longer
  joins or renames your own person, and two contacts sharing a company's mailbox or phone stay two people. What changed
  in between is in [cli-core's changelog](https://github.com/WireCatLabs/cli-core/blob/main/CHANGELOG.md).

## 0.11.0 — 10.11.2026

### Changed — may break callers

- Under `scope mine` a sync copies only the user's clients: the contacts and companies assigned to them or to an
  unassigned user, and the ones named on the deals and leads it copies. Before, it copied the portal's whole contact and
  company base, 114 165 contacts on one live portal where the user held no deal. The daily deletion pass lists only
  those ids too. Watch for: a copy that already holds the whole base keeps its contacts; companies wait for
  `sync --rescan`.
- Only a Bitrix24 administrator may sync under `scope all`. A department head is refused like an employee
  (`bitrix.scope-all-admin-only`, was `bitrix.scope-all-manager-only`).
- Anyone but a Bitrix24 administrator sees phones and e-mails only of their own clients. `people list` and
  `organizations list` leave them out of the rest; `people show` and `organizations show` of one give them, at most
  100 such contacts and companies a day for the user and their agents together. `api call` refuses contact and
  company reads (`crm.contact.*`, `crm.company.*`, `crm.item.*` of type 3 or 4, requisites, addresses, duplicate
  searches) to anyone but an administrator, whatever the permissions say.
- Only a Bitrix24 administrator may name a working employee in `crm.bitrix24:<portal>.unassigned`; a department head
  is held to dismissed users and non-employees like everyone else.
- **Built on cli-core 0.623.0** (was 0.621.0). The store moves to version 61 on first open (people ties, additive).
  What changed in between is in [cli-core's changelog](https://github.com/WireCatLabs/cli-core/blob/main/CHANGELOG.md).

## 0.10.0 — 09.11.2026

### Added

- `session start` and `session status --check` answer whether the webhook's user is a `manager` (a Bitrix24
  administrator or the head of a department), beside `admin`.

### Changed — may break callers

- Only a manager copies every deal and lead: a sync under `crm.bitrix24:<portal>.scope all` is refused
  (`configuration_error`) unless the webhook's user is a Bitrix24 administrator or the head of a department, checked
  on every sync. Anyone else copies their own deals and leads and the unassigned ones; the refusal says to set
  `scope` to `mine`. Watch for: a webhook without the `department` scope counts a department head as an employee.
- For anyone but a manager, `crm.bitrix24:<portal>.unassigned` counts only users the portal shows as dismissed or as
  not employees (extranet, e-mail, bot), checked at every sync. A working employee in the list is left out with the
  reason in the sync's `issues` (`crm.unassigned-dropped`), and their deals and leads leave the local copy. A manager
  may still list anyone. Watch for: a webhook without the `user` scope counts no one as unassigned for an employee.

## 0.9.0 — 09.11.2026

### Added

- `sync` stores who is who in the local store: a contact is a member of each of its companies with the role
  `contact`, its job title beside it; a deal's and a lead's contacts are on it with the main one marked, and the
  person responsible is its `owner`; employees are members of your own companies, read every sync, and report to
  their department's head; a converted lead points to its deal. These relationships are `reported` until you confirm
  them, end instead of being deleted when the portal stops saying them, and never change one you made. Watch for: the
  webhook needs the `user_basic` and `department` scopes for employees' e-mails and reporting lines; without them the
  sync reads the rest.
- `schedule` installs a timer that runs `sync`, or another `b24` command, on its own. MCP does not offer it.
- A sync copies only the deals and leads of the webhook's own user by default, and those of the users in
  `crm.bitrix24:<portal>.unassigned` (Bitrix24 always names a responsible person, so this is how a website form's or
  an integration's deals count as nobody's). `config set crm.bitrix24:<portal>.scope all` copies every one. The sync
  answer has `scope` (with the webhook's user as `self`), and each kind's `out_of_scope`: a deal given to another user
  leaves the local copy at the next sync. Contacts and companies are copied whole as before.
- Without a `scope` setting, a first `mine` that would mark more than half of the stored deals or leads deleted keeps
  them (`crm.narrowing-held`) until the owner sets `scope`. An agent cannot set `scope`, `self` or `unassigned`.
- One portal's copy belongs to one user: a sync through a webhook of another user than the first sync's is refused
  until `config unset crm.bitrix24:<portal>.self`.

### Changed — may break callers

- A deal's and a lead's `people` now include the employee responsible for it, with the role `owner`, beside its
  contacts. Watch for: code that took every entry in `people` for a client's contact.
- `store status` counts your own companies among the organizations and the portal's employees among the people.
- `api call department.get` and `crm.mycompany.basic.list` run without asking, as the other reads `b24` makes do;
  `department.get` is refused under `users.list: deny`, and `crm.mycompany.*` under `organizations.list: deny`.
- A webhook made with only the `crm` and `user` scopes now gets an entry in the sync's `issues` on every sync:
  Bitrix24 refuses it the departments. Add the `department` scope, or expect that entry.
- The first sync after the upgrade marks other users' deals and leads deleted in the local copy: they leave lists and
  search, and their earlier copy stays in the store file. Set `crm.bitrix24:<portal>.scope all` before it to keep them.
- A list answer without its items now fails that kind's sync (`invalid_response`) instead of ending the list there.

### Fixed

- `api show department.get` and `api call` named the method's scope `basic`; Bitrix24's is `department`.
- A method that Bitrix24 lets only an installed app call (`WRONG_AUTH_TYPE`) is refused as `permission_error` with
  the reason `webhook.app-only`. Before, `b24` said the webhook was refused and asked you to sign in again, which
  cannot help. Watch for: a script that branched on `authentication_error` for this refusal.
- `people` and `organizations` `create` and `update` declare their answers (`crm_record_created`,
  `crm_record_updated`), so `--json` takes their field names and `commands info` lists them.
- `session start` and troubleshooting name the same webhook scopes as the README: `crm`, `user_basic` and
  `department`. Troubleshooting also asked for `catalog`, which `b24` does not use.
- `api show`, `api list` and a refused call named the scope `basic` for every method outside five name prefixes, such
  as `im.message.add` and `tasks.task.add`. They now name the scope Bitrix24's reference gives (`im`, `task`,
  `calendar`), or `unknown`, and a refusal for an unknown one names no scope.

### Security

- `b24` sends requests only to the portal in your webhook address and refuses any other host before a byte leaves the
  machine. Its manifest says so (`network`), so WireCat Desktop shows where the data goes.

## 0.8.0 — 08.11.2026

### Added

- The package ships `contracts/wirecat.json`, so WireCat Desktop can read what `b24` does, how to sign in and what
  `sync` copies before it installs it. `b24 --wcat-describe` now answers format 2 with that file's Desktop section
  and its SHA-256.

### Fixed

- The first sync of a large portal uses far less memory and takes a third less time: on synthetic data with 20,000
  deals, its peak falls from 3.7 GB to 0.55 GB.
- `session start` asks for the webhook again when nothing arrived. An empty Enter at the hidden prompt, as after a
  Ctrl+V that pasted nothing in a Linux terminal, failed at once with "no webhook address was given". It now says to
  paste with Ctrl+Shift+V (Cmd+V on macOS) and asks again, up to three times.
- A crash while `b24` starts, or one an awaited step throws, exits 1 with b24's crash error (`command.crashed` as
  JSON when stdout is not a terminal). It printed a raw Node stack.

## 0.7.0 — 08.11.2026

### Added

- The package also installs the command as `wcat-b24`, so `wcat b24` runs it and `wcat --help` lists it.
  `b24 --wcat-describe` prints what the tool is, its version and its docs page.
- `config set owner_languages` names the languages the owner reads.

### Changed — may break callers

- A search with no letter or digit is refused (`validation_error`). `""`, a lone `?` or an emoji alone found nothing
  and said nothing. A lone `*` still reads as a wildcard.

### Fixed

- The first sync of a large portal is about twice as fast. It no longer slows down with every deal it saves: on
  synthetic data with 10 deal owners, 20,000 deals, 10,000 leads and 20,000 contacts sync in 30 s instead of 61 s.

## 0.6.0 — 08.11.2026

### Added

- `people list --format csv` and `organizations list --format csv` print a page as a CSV table for a spreadsheet, as
  `deals list` and `leads list` now do too. stdout carries the table and nothing else; the way to the next page goes
  to stderr. The columns are the record's own fields, then every custom field of the portal by its label, a money
  field as `<label> amount` and `<label> currency`, a label two fields share told apart by its code. `--json=a,b`
  beside it picks the columns, a custom field as `provider_metadata.<code>`. A cell that would start a spreadsheet
  formula gets a leading `'`. `--jsonl`, a bare `--json` and `--compact` are refused with `output.conflict`, and
  agents do not get the option.
- `pipelines show` is the sales funnel board: each stage gives its deals or leads and their total in each currency,
  and at a terminal prints a table of the stages with the open total, the won, the lost and the win rate. The
  pipeline may be left out when the portal has only one.

### Changed — may break callers

- A custom field the portal does not have, named in a list's query or in `--json`, is refused with `param` set to
  `--query` or `--json`, where it said `--field`.
- A command on a profile with no webhook is refused with reason `session.missing`, where it said `webhook.missing`:
  the one "not signed in" every WireCat tool with an API token gives. The webhook is read and kept where it was,
  `B24_TOKEN`, then the keyring entry `token:<profile>` under `bitrix24-cli`, then a private file, now by cli-core's
  shared token store.

## 0.5.0 — 07.11.2026

### Added

- `sync` copies the portal's pipelines, companies, contacts, deals and leads into the local WireCat store: what changed
  since the last sync, or everything with `--rescan`; once a day it also finds what the portal deleted. `store status`
  says how far each kind is. A sync stops before its deadline or `--max-pages`, and the next one goes on from there.
- `deals close <ref> won|lost` and `leads close`, to the first won or lost stage of the record's pipeline, and
  `deals delete` and `leads delete`, which ask first.
- `deals create` and `update` take `--pipeline`, `--stage`, `--amount` with `--currency`, `--close-date` and
  `--owner`; leads take the same but `--close-date`. A stage checks the move key, a won or lost one the close key too.
- `search all` finds stored deals and leads beside the other WireCat tools' messages, notes and events. Under
  `deals.list: deny` it leaves deals out and names them in `missing` and on stderr, and the same for leads; with every
  kind it was asked for denied, it is refused (`search.all-denied`).
- `b24 --help` and a bare `b24` open with what `b24` is for, what to try first, and where to start.

### Changed — may break callers

- `deals`, `leads`, `pipelines` and `stages` are cli-core's shared CRM commands, the same in every WireCat CRM tool.
  Their lists and `show` read the local store, so run `sync` first; `--offline` works for them now.
- A deal or lead is named by its ref, `deal:12` or `lead:7`, as a list prints it, not by its Bitrix24 id or title.
- A deal or lead answers `ref`, `pipeline` and `pipeline_name`, `stage` (its name), `status` (`open`, `won` or `lost`),
  `close_date`, `amount` as a decimal string in `currency`, both `null` with no amount, `assignee` as
  `<portal>/user/<id>`, and the portal's own fields in `provider_metadata` by code. `stage_id`, `pipeline_id`,
  `outcome`, `closes_on`, `assigned_to` and `person_ids` are gone from them; contacts are in `people`, the company in
  `organization`.
- Their list query takes `status`, `stage`, `pipeline` and `organization`; the free word, the time windows and the
  portal's own fields are gone from it. `--all` is gone from those lists.
- `deals move <ref> <stage>` takes the stage as an argument, not `--stage`.
- Deal and lead writes have no `--body`. `--field <label or code>=<value>` sets a custom field by the definitions the
  last `sync` stored: a list field takes its option's label or id, a multiple field one `--field` per value, and an
  empty value clears it. A code that names a standard field (`stageId`, `categoryId`, `assignedById`, a lead's
  `STATUS_ID`) is refused, and so is a `--field` with no key before its `=`.
- A custom field's label and a list option's label are matched as cli-core matches names, for every `--field` and
  query: `е` finds `ё`, and a letter typed as two code points finds the same letter typed as one. `people show` and
  `organizations show` compare a name with the portal's matches the same way. A label that matched one field may now
  match two, which is refused with both.
- `fields list <deals|leads|people|organizations>` is cli-core's: it reads the definitions `sync` stored, so run
  `sync` first, and each field names its `untrusted` parts.
- `api.crm.deal.update` (and the other deal and lead `api.*` keys) at `ask` now asks on `deals update`, `move` and
  `close` too, not only on `api call`. `--dry-run` of a deal or lead write names every key it may check: the
  `api.*` key, and the move, close and `crm.assign-others` keys with the option that would make each apply.
- `sync` reads the portal's field definitions of each kind, one more request per kind, so `--max-pages` reaches the
  records later. A webhook without the rights to read them still syncs; any other failure there fails the sync.
- Leads stand in one pipeline named `Leads`, since Bitrix24's leads have none.
- `deals.delete` and `leads.delete` default to `ask`; `api call` that sets a stage checks `deals.close` (or
  `leads.close`) as well as `deals.move`.
- `mcp` and `doctor` are cli-core's shared commands: `mcp` adds `config`, `add` and `check`, and `--profiles` and
  `--permission` on `serve`; `doctor` adds `--online`.
- A `--body` or `api call` method that could be read in more than one way is refused before anything is sent: a
  body that names one field twice in any spelling, an `entityTypeId` that is not a plain number, a `fields` that is
  not an object, a method with any suffix but one `.json`, and a `crm.item` method without `entityTypeId`. Send each
  field once, under one spelling.
- `--operation-id` is gone from every write. On a live portal a create repeated with the same id made a second
  record, so a repeat is never safe: after `outcome_unknown`, `sync` and `show` the record and write it again only if
  it is not there. A deal or lead write given `--operation-id` is refused before anything is sent.

### Fixed

- A `sync` after the first one works. It asked the portal for what changed with a time the portal refuses, so
  every kind failed and nothing new was copied. Times in a filter now go in whole seconds with an offset, which also
  fixes `updated_at:` and `created_at:` in `people list` and `organizations list`.
- A write answered with a server or gateway failure (500, 502, 504) is `outcome_unknown`, not `provider_unavailable`:
  the portal may have made it. A write a cancel cuts is `outcome_unknown` too, never `cancelled`.
- Stages are read page by page: a directory past REST 2's first 50 rows lost its later stages.
- An id or owner that is not a number is refused before anything is sent; it went out empty before.
- `--body` keeps integers past 2^53 as typed; `api call --body -` reads the body from stdin.
- A request that gets no answer is cut after 10 seconds, not 30, so a read can be tried again before a one-shot
  command's own 30 s run out.
- `show` for people and organizations fails when the portal's field labels fail for a reason other than missing
  rights, instead of showing the record without its labels.

### Security

- Permission checks on `api call` and on `people` and `organizations` writes read a body exactly as it is sent, so
  the key they check is the key the write needs.
- `api call` reads check the same keys as the commands that read those records, as its writes already did.

## 0.4.0 — 06.11.2026

### Added

- `create` and `update` for deals, leads, people and organizations take `--field "<label or code>=<value>"`, repeated
  for more fields or for each value of a multiple field. The label is looked up on the portal; two fields with that
  label are refused with their codes. A list field takes its option's label or id. `--field` wins over `--body` for the
  same field, and `--title`, `--name`, `--first-name` and `--last-name` win over both. Other values go to the portal as
  typed. `--dry-run` does not look the names up.
- `list` for deals, leads, people and organizations filters by the portal's own fields: `<code or label>:<value>`,
  for the fields the portal can filter by; a list field takes its option's label or id. A label with spaces is
  written `lead_source:web` or `Lead\ source:web`.
- `list --json=…,provider_metadata.<code>` adds that custom field to each item, as `show` gives it;
  `--json=…,provider_metadata` adds every one. Only codes the portal lists are asked for.
- `fields list <deals|leads|people|organizations>` lists the portal's custom fields of that kind: code, label, type,
  whether it holds several values, whether a list can filter by it, and a list field's options with their ids.

### Changed — may break callers

- `show` gives a list field's value by its option's label, not its id; the id moves to `option_id` beside it. A field
  that holds several options gives both as arrays.
- `api call` works from an allow list. The CRM, catalog and user reads and the four CRM types' writes are allowed as
  before. Any other method asks, so it needs `--yes` without a terminal, and the families that message people, publish
  or send data out are denied: `imconnector`, `log.blogpost`, public file links and `event.bind` join `im`,
  `imopenlines` and the rest. `api show` names each method's level.

### Fixed

- A `deny` in a profile stops a read command again. `b24` handed cli-core only `resolveSettings`, so cli-core never
  saw b24's permission table: `deals.list: deny` did not stop `deals list`, over MCP too, and with any b24 key in the
  config every `--dry-run` failed with "names no command".
- `api.crm.<type>.add` and `api.crm.<type>.update` now hold on `deals`, `leads`, `people` and `organizations`
  `create`, `update` and `move`, as the command keys already held on `api call`. `--dry-run` names them beside the
  command's own key.
- `api call --dry-run` names every key the call checks with its level, such as `api.crm.deal.delete` at `ask`, instead
  of "no key, allowed".
- `api call crm.item.add|update|delete` with `entityTypeId` 1 to 4 checks the lead, deal, contact or company command
  key, as `crm.deal.update` already did: `deals.delete: deny` now stops `crm.item.delete` for a deal.
- Every method whose name ends in `delete` asks, not only the listed ones. A method name in capitals or with a `.json`
  suffix is read as its plain name, so it no longer gets round a key.
- A write that sets a stage checks `deals.move` or `leads.move`: `update` and `create` with `stageId` in `--body`, over
  MCP too, and `api call` with `STAGE_ID` or a lead's `STATUS_ID`. `ASSIGNED_BY_ID` checks `crm.assign-others` like
  `assignedById`.
- A write is sent once. A REST 3.0 write that got no answer was sent up to three more times with the same
  `Idempotency-Key`, which is not yet checked on a live portal; it is now `outcome_unknown` at once, and its message
  names `--operation-id` once.
- `pipeline_id:0`, the default pipeline, is accepted by `deals list` and `stages list`.
- The allow list keeps the denied families' reads refused, as before it: `crm.activity.list`, `im.*`, `tasks.*` and
  the rest are `deny`, and `api show` says so.
- The MCP server applies b24's permission table (WC-PERM-23): a command the profile denies is listed by tools search
  as unavailable, not offered as available.

## 0.3.0 — 06.11.2026

### Changed — may break callers

- `show` for deals, leads, people and organizations gives each custom field its title on the portal:
  `provider_metadata` maps the field's code to `{ "label", "value" }`. `label` is `null` when the portal has no title
  for it or does not answer the request for titles; `show` still answers then.

## 0.2.0 — 06.11.2026

### Fixed

- Commands that call the portal now run inside cli-core's run: each answer's `meta.run_id` names a run `runs show`
  finds, with the portal requests in it, `meta.duration_ms` measures the command, and `--timeout` stops a stuck
  command. An MCP agent's permission overrides now reach these commands too.
- `show` for deals, leads, people and organizations no longer lists the portal's custom fields that hold no value:
  `provider_metadata` leaves out `null`, `""` and `[]`, and is left out when nothing is left.

## 0.1.0 — 06.11.2026

### Fixed

- An error reason that a newer cli-core also defines no longer makes every failing command crash instead of printing
  its error.

### Added

- Started from `@wirecat/cli-template` 0.14.0.
- The client for Bitrix24's REST API over an incoming webhook: REST 3.0 for deals, leads, contacts and companies,
  REST 2 for the rest; the portal's rate limits paced and waited out; a write repeated only with an
  `Idempotency-Key`; the webhook's secret kept out of every error and run record.
- `session start | status | end` per profile and `session list`: the webhook address read hidden or from stdin,
  checked against the portal, kept in the keyring under `bitrix24-cli`; `session status --check` says whose rights
  the webhook carries.
- `list` and `show` for `deals`, `leads`, `people` (contacts), `organizations` (companies), `pipelines`, `stages`
  (with each stage's outcome), `products` and `users`, live from the portal. A list takes a query that becomes the
  portal's own filter; a free word in it matches part of a title or name. A name two records share is refused with
  both as candidates.
- `create` and `update` for `deals`, `leads`, `people` and `organizations`, and `move` for deals and leads: each
  write answers its `operation_id`, which Bitrix24 receives as the `Idempotency-Key`, so `--operation-id` repeats a
  write safely; `--dry-run` previews; assigning a record to another employee is denied until allowed
  (`crm.assign-others`).
- `api list`, `api show <method>` and `api call <method> --body <json>`: any Bitrix24 method, on the REST version it
  lives on, checking `api.<method>` and the command key it does the same as; messaging, automation, tasks and
  `batch` writes are denied until allowed.
