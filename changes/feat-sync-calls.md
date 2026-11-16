### Added

- **`sync` copies the portal's calls too**, after the CRM, as `meetings sync` does, so WireCat Desktop's sync and the
  sync after install bring calls. A calls step that fails, such as a webhook without the telephony scope, is a note,
  and the CRM sync still succeeds. The setting `sync_calls` (on when not set) leaves them out. When calls came in and
  `phone_region` is not set, the note says how to set it. See [Calls](../docs/calls.md).
