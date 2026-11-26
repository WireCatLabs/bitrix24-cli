### Changed — may break callers

- **b24 is built on cli-core 1.3.0.** The store moves to version 77 on its first run, and tools on cli-core 1.0 still
  open it. The first help screen names `b24 session list`.
- **`session list` rows have `state`**: `saved`, `missing` or `unknown`, as in the other WireCat CLIs. A profile whose
  sign-in cannot be read stays `signed_in: null` and keeps its `error`.
- **`session start --credential-storage` with another value** says which value it got:
  `--credential-storage takes keyring or file; got <value>`.
- The deadline of each Bitrix24 request and of the token request is cli-core's `timeLimit`, not a copy of it.
