### Added

- **`search all` finds a deal or lead by the words of its activities.** With activities on, the subject and text of
  each call, e-mail, meeting, to-do and task on a deal count as its words, beside its title, company and contacts:
  `b24 work search all warehouse lease` finds the deal whose e-mail spoke of it (cli-core 0.648.0).

### Changed — may break callers

- **Built on cli-core 0.648.0 and cli-base 0.98.0** (were 0.647.0 and 0.97.0). See the
  [cli-core changelog](https://github.com/WireCatLabs/cli-core/blob/main/CHANGELOG.md).
- **A profile this computer has never seen is `not_found`** with reason `profile.unknown`, the profiles here, and the
  sign-in hint, exit code 6; it was `authentication_error`, exit code 4. A profile set in the environment keeps the
  sign-in refusal.
- **`store reset` is no longer offered over MCP**: it needs `--yes`, which an MCP call cannot pass.
