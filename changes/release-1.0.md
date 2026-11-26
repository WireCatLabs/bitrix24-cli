### Changed — may break callers

- **b24 is built on cli-core 1.0 and cli-base 1.0.** After its first run the store is at version 74, and only tools
  on cli-core 1.0 open it: upgrade every WireCat CLI on this computer together. The migration keeps a rollback copy,
  and refuses to run when it cannot write one (`store migrate --no-backup` migrates anyway).
- **`sync --rescan` no longer lets a sync mark most of a kind deleted.** It only lists everything again. When the
  guard holds a pass, `sync --allow-deletions <count>` lets it mark at most that many records deleted. The flag is
  for the owner in a terminal; the MCP server does not offer it.
- **MCP no longer offers `schedule exec`.** It is the timer's own entry and runs only a schedule file in b24's
  schedules folder. An agent runs a saved schedule with `schedule run <name>`. See
  [Security](../docs/security.md#timers).
- **An MCP call that names a refused folder answers `permission_error`**, not `validation_error`.
