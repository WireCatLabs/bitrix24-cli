### Added

- **`search all` finds deals and leads by the meaning of their activities:** calls, e-mails, comments and tasks, in
  other words or another language, with the activity's excerpt in the hit. `b24 work sync --embed` builds the index
  with a model already downloaded (`b24 models download embeddinggemma`); until then `search all` says it searched by
  words only. Needs `activities` on (`@wirecat/cli-core` 0.751.0).

### Changed — may break callers

- **`synced[].saved` in the `sync` answer counts only rows that changed** (new, different, deleted or back again), so
  a sync with nothing new answers 0.
