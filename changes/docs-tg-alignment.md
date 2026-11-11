### Added

- **`b24 guide` lists scenarios for common tasks**, each as commands in order with why: `first-sync` (the first sync
  and the pipeline board), `keep-in-sync` (a timer and search) and `safe-agent-writes` (an agent over MCP whose writes
  stay yours). `b24 guide <name> --json` gives one as data.
- **[MCP](../docs/mcp.md) and [Permissions](../docs/permissions.md) pages.** How to add `b24` to an agent, what the
  agent sees and what it is never offered; each level, the built-in levels, the keys one command checks, and the
  checks no level lifts.

### Fixed

- **Over MCP, `ask` does not stop a write.** The [README](../README.md), [security](../docs/security.md) and the first
  screen told owners to set `deals.move` to `ask` against the portal's robots, which stops a move only at a terminal:
  over MCP nobody answers, so the write goes ahead. They now say to set `readonly` or `deny`, or to turn on approval
  in the agent's client.
- **The agent skill covers what an agent needs.** `b24 skill show` now has exit codes and error reasons, MCP and the
  `ask` trap, the first setup from the webhook to the first sync, the boundaries of a write, and the traps.
- The examples use the profile `work` throughout, in place of `personal`.
