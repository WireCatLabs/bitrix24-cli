### Added

- **Built on cli-core 0.683.0** (was 0.670.0), with its CRM additions: `deals list` and `leads list` take `updated:`,
  `created:`, `closed:` and `owner:` (`owner:me` is your own portal user); `pipelines show --since-time --until-time`
  answers the funnel of a window with closed deals, cycle time, owners and lost reasons; `deals show` answers
  `stage_history` from the portal's own stage history; `stages list` answers `stage_task`. See the
  [cli-core changelog](https://github.com/WireCatLabs/cli-core/blob/main/CHANGELOG.md).
- **`people create` and `organizations create` take `--email` and `--phone`.** A phone is taken only in international
  form (`+…`). `people update` and `organizations update` still refuse them: Bitrix24 would add the new ones to the
  old ones rather than replace them.

### Changed — may break callers

- **`sync` reads the portal's stage history every time**, 90 days back at first, so the funnel and `deals show` count
  the stages a deal really passed. A webhook without the right to `crm.stagehistory.list` names it as an issue.
- **Offline CRM reads read the stored sign-in to know your portal user**, from `B24_TOKEN`, the OS keyring or the
  credentials file, without the network. Where no keyring can be reached, the read warns and uses the file; with no
  sign-in found it shows no deals or leads.
- **`pipelines list`, `stages list` and `pipelines show` leave out a stage the portal removed** unless a deal stands in
  it.

### Fixed

- **A contact given to a colleague leaves the copy at the next `sync`**, with its phone and e-mail. Before, its one
  phone and e-mail stayed until `sync --rescan`.

### Security

- **A profile that is not the portal's administrator reads offline only the deals and leads assigned to it.** The copy
  is kept per portal, so an ordinary employee's profile on the same portal as the administrator's read every deal the
  administrator synced, and `search all` found them by their contacts' e-mails and phones. Now another user's deal is
  `not_found` and the reports count only its own. A profile whose sign-in names no portal user reads none of the
  copy's deals, says so and exits 1; sign in again with `session start`. The administrator, as its last `sync` found,
  reads the whole copy as before. Until a `sync` of this version runs, every profile reads only its own deals and
  leads: run `sync` once after upgrading.
