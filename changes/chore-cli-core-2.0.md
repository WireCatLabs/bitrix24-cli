### Changed — may break callers

- **b24 is built on cli-core 2.0.0.** The first run moves the store to version 78, and after that only tools on
  cli-core 2.0 open it: upgrade every WireCat CLI and WireCat Desktop on this computer the same day, with `serve`,
  `mcp` and syncs stopped. The migration keeps a rollback copy first. In the JSON output, the `type` of an agent
  author (`author`, `created_by`, `confirmed_by`, `decided_by`) is `"agent"` where it was `"bot"`.
