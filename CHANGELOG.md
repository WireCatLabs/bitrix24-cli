# Changelog

Notable changes to `@wirecat/bitrix24-cli`. One section per version, newest first.

## Unreleased

### Added

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
