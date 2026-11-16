### Changed — may break callers

- **The agent skill is shorter.** `SKILL.md` keeps what an agent needs on every turn (the profile rule, answering
  from the CRM, the limits on writes, MCP's `ask` that does not ask, output) in about 8 KB instead of 18 KB, and links
  the rest in `skills/bitrix24-cli/references/`: reading, writing, MCP, output and setup. No rule was dropped. The
  skill now says what changed since it was written: activities, tasks and comments on deals are read when the owner
  turns them on, `deals list` takes `updated:`, `created:`, `closed:` and `owner:me`, `pipelines show` counts a
  window's funnel, `people create` and `organizations create` take `--email` and `--phone` while `update` refuses
  them, and a profile that is not the administrator reads offline only its own deals and leads. An agent that reads
  the skill pays about 2,500 fewer tokens on every turn.
