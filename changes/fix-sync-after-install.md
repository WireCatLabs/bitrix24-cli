### Fixed

- **`sync` runs on a fresh install.** A shared WireCat config that could not be read (a byte-order mark, broken
  JSON, a folder in its place, an older `setup` shape) made b24 refuse `sync` with "setup's answer keeps every
  WireCat tool read-only". Now only the owner's own "read only" answer limits b24, and even then `sync` runs: it only
  reads the portal into the local store (cli-core 0.654.0).

### Changed — may break callers

- **Built on cli-core 0.654.0** (was 0.651.0). See the
  [cli-core changelog](https://github.com/WireCatLabs/cli-core/blob/main/CHANGELOG.md).
