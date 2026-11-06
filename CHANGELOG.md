# Changelog

Notable changes to `@wirecat/bitrix24-cli`. One section per version, newest first.

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
