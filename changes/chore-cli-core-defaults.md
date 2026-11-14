### Changed — may break callers

- **Built on cli-core 0.659.0** (was 0.654.0). A shared WireCat config (`~/.config/WireCat/config.json`) with a
  byte-order mark, a comment, a trailing comma or a missing comma between two lines is now mended when it is read,
  the old file kept beside it as `config.json.bak-<time>`; other damage names its line and the likely fix. See the
  [cli-core changelog](https://github.com/WireCatLabs/cli-core/blob/main/CHANGELOG.md).
