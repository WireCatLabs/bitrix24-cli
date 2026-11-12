### Added

- **`account remove` forgets a profile.** `b24 <profile> account remove --keep-data` forgets the webhook address or the
  local application's sign-in, the profile's settings and its files on this computer, and leaves its copy of the portal in the store, still
  searchable; `--delete-data` also deletes the portal's deals, leads, contacts, companies and sync state. It asks
  first, or takes `--yes`; `--dry-run` lists what it would remove and keep. It is cli-core's shared command, with
  the same answer as the other WireCat tools, so WireCat Desktop removes a Bitrix24 account the same way. The webhook
  itself stays in Bitrix24. `--delete-data` refuses (reason `account-remove.portal-shared`) while another profile
  here reads the same portal, since the store keeps one copy of it.

### Changed — may break callers

- **On cli-core 0.643.0.** A CRM list page answers `hasMore` and `nextCursor`, cli-core's one list shape.
- **`session start` refuses a webhook another profile already uses.** The same portal and the same employee as a
  profile already signed in on this computer is a `conflict` with reason `session.duplicate`, which names that
  profile and says how to sign it in again or remove it. Nothing is asked of the portal. Signing the same profile in
  again, and another employee's webhook on the same portal, still work.

### Fixed

- **A webhook without the user scope says what to tick.** When `user.current` answers `INSUFFICIENT_SCOPE`,
  `session start` says the webhook lacks "Users (basic)" (`user_basic`, «Пользователи (базовый)»), where to add it on
  the portal (Developer resources → Integrations, edit the webhook) and to sign in again with the address it shows.
  The reason stays `webhook.scope-missing`; the sign-in stays refused.
