# Changelog

Notable changes to `@wirecat/bitrix24-cli`. One section per version, newest first.

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
