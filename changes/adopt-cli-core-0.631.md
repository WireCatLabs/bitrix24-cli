### Added

- `store apply` removes, from a copy made under `scope mine`, the contacts that no deal or lead of the chosen users
  names and that belong to no kept company, and the people they leave empty. Without `--yes` it only counts. A sync
  that narrows the copy, or `sync --rescan`, does this itself, and its answer gives the counts as `contacts_removed`.
- **Built on cli-core 0.631.0** (was 0.630.0). The store moves to version 64 on first open: saving or removing a
  deal's link to a person no longer reads every such link. What changed is in
  [cli-core's changelog](https://github.com/WireCatLabs/cli-core/blob/main/CHANGELOG.md).
