### Added

- **An agent can run a schedule over MCP.** `schedule list`, `schedule run` and `schedule exec` are MCP tools, each
  behind its own permission key. Adding, pausing, resuming or removing a timer over MCP is still refused unless
  `permissions.mcp.authority` is `allow`. Before, b24 kept all of `schedule` off MCP. See
  [MCP](../docs/mcp.md).
- `b24 --help` lists `pbx`, the Asterisk tool, under "Works with" (cli-core 0.651.0).

### Changed — may break callers

- **Built on cli-core 0.651.0** (was 0.650.0). A stale meeting project fingerprint is now `conflict`, not
  `configuration_error`. See the [cli-core changelog](https://github.com/WireCatLabs/cli-core/blob/main/CHANGELOG.md).
