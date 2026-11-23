### Changed — may break callers

- **`account remove --delete-data` refuses with `account-remove.account-shared`, detail `account`.** It was
  `account-remove.portal-shared` with detail `portal`. The command is now cli-core's shared CRM one (`@wirecat/cli-core`
  0.722.0). It still refuses while another profile here reads the same portal, even one whose session ended. Under
  `--dry-run` it now warns and lists what would go, where it used to fail.
- **`account remove --delete-data` refuses when b24 cannot tell which portal another profile holds**
  (`account-remove.account-unknown`, detail `profile`): a profile whose saved webhook is unreadable and that
  `session start` never remembered. `--keep-data` still removes.
- **`session start` refuses a second sign-in to the same portal and user with the shared words.** The reason stays
  `session.duplicate`; its detail `portal` is now `account`, and the message says to end the other profile with
  `b24 <profile> session end`. A webhook sign-in to a profile named `files` or `foreign-contacts`, folders every
  portal shares, is refused with `profile.reserved`.
