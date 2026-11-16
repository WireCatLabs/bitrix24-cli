### Added

- **`calls export` writes the calls of other phone systems onto the client's contact in Bitrix24**, once each, with
  `telephony.externalCall.register` and `finish`. Off by default: it needs the setting `export_calls`, the two methods'
  permissions, and the local application sign-in, since Bitrix24 lets no webhook write a call. `--dry-run` shows each
  call's fields and where it lands, and sends nothing. See [Calls](../docs/calls.md).
