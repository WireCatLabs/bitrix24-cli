### Added

- **A task when a deal or lead enters a stage.** The setting `crm.bitrix24:<portal>.stage-tasks` names stages, and
  each `sync` opens a local task for every deal or lead that moved into one of them since the last sync, once per
  move. Only you set it; moves made before it was first set open none. See
  [a task when a deal enters a stage](../docs/usage.md#a-task-when-a-deal-enters-a-stage).
- **Shell completion:** `b24 complete zsh` prints the script to source; bash, fish and PowerShell too.
- **The shared store's file commands and problem reports.** `b24 store backup`, `check`, `repair`, `restore` and the
  rest look after the one store file every WireCat tool shares, and `b24 doctor reports create` writes a report to
  send with a problem. An agent over MCP sees them too, each with its permission like any write.
- **`b24` tells you when a newer version is out**, after a command that succeeded, on stderr. `update_check: false`
  or `B24_NO_UPDATE_CHECK=1` turns it off.

