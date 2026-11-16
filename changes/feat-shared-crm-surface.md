### Changed — may break callers

- **`people`, `organizations` and `users` are WireCat's shared CRM commands now**, the same words, query and answer
  as in every CRM tool. An organization answers `type` and `own` instead of `type_id`; its industry, revenue and
  currency move under `provider_metadata`, and `industry_id:` is no longer a filter. Every live list and show gives
  the custom fields under `provider_metadata`, every item names its `untrusted` fields, and `--offline` still refuses
  them. A user is the `crm_user` entity, not `user`. A name that fits several records is `crm.record-ambiguous`, not
  `organization.ambiguous` or `person.ambiguous`.
- **These three lists page with `--limit` (1 to 250, 50 when left out) and `--page`.** `--all`, a limit above 250 and
  the profile's `defaults.limit` no longer apply to them. `users list name:` matches part of the whole name across
  every employee, not the portal's own name search.
- **`people create`, `people update`, `organizations create` and `organizations update` are the shared writes.** They
  take `--name`, `--owner`, `--field`, and for people `--first-name`, `--last-name` and `--position`; `--body` is
  gone (`api call` writes any other field). Each answers the record as the portal holds it, and stores it.
- **A label in `--field` needs a `sync` first.** Before one, name the field by its code, as `fields list` prints it.
- **The 100-a-day count of other people's contacts and companies is cli-core's** and starts again from zero. Its
  message and its reason (`crm.foreign-contacts-spent`) are the shared ones, and `api call` refuses client reads with
  `crm.client-reads-admin-only`.
- **Sign in again after an upgrade with a local application (`session start --app`).** The stored sign-in moved to
  cli-core's shape; the old one no longer reads. A webhook sign-in is not affected.
- **A run with moved folders (`B24_CONFIG_DIR`, `B24_STATE_DIR`) no longer renews an expired application sign-in.**
  Bitrix24 replaces the refresh token on every renewal, so a moved run that renewed it would sign the owner's own
  runs out. It says so; renew it in a run without moved folders.

### Fixed

- **A field the portal will not describe still shows**, from `userfield.list`, with no label: `sync` stores it and
  `--field` can set it.
