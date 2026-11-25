### Added

- **`sync --embed` and `search all` by meaning** (cli-core 0.751.0). With the `activities` setting on, `sync --embed`
  indexes the copied timeline comments, e-mails, calls, meetings and tasks with a model already downloaded, and
  `search all` then finds deals and leads by what their activities mean, in Russian or any language, not only by
  their words. The skill tells an agent to ask by meaning before it reads every activity.

### Fixed

- `search all` lists a name one letter off the one that matched after it, and finds a Latin name typed in Cyrillic
  letters and a Russian name typed in Latin letters, each marked `match: corrected`.
