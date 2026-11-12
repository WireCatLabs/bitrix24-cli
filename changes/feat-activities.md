### Added

- **Activities and tasks on deals and leads.** With `crm.bitrix24:<portal>.activities` set to `on`, `sync` also reads
  the calls, e-mails, meetings and to-dos on the deals and leads it keeps, and the Bitrix24 tasks bound to them;
  `deals show` and `leads show` list them, open ones first. The first sync reads 90 days. The client's phone or
  e-mail on an activity is never copied. Off by default and set by the owner only; tasks need the `task` scope.
  ([usage](../docs/usage.md#activities-and-tasks-on-a-deal))
