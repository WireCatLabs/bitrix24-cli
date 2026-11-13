### Added

- **A stage task opens for a stage passed between two syncs.** `sync` reads the portal's stage history
  (`crm.stagehistory.list`) while `stage-tasks` names a stage, so a deal moved from "New" through "Quote" to "Won" in
  one day opens the tasks of both "Quote" and "Won"; before, only "Won". The history is read from the last sync on,
  a page or two a day, and not at all without the setting (cli-core 0.650.0).

### Changed — may break callers

- **Built on cli-core 0.650.0** (was 0.648.0). See the
  [cli-core changelog](https://github.com/WireCatLabs/cli-core/blob/main/CHANGELOG.md).
