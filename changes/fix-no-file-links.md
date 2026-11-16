### Security

- **No file download link in the copy or the output.** A file in a CRM record's custom field is now kept as its
  file id, in `sync` and in every `show`, `list` and write answer: Bitrix24's download link (`urlMachine`,
  `downloadUrl`) carries an access token. `api call` prints `[link removed]` in place of every download link and every
  link with `auth=` or `token=` in it. A copy synced before this version may still hold such links:
  `b24 work sync --rescan` rewrites the records the portal still lists; a record deleted or outside the sync's scope
  keeps what it held until `account remove --delete-data`. See [Security](../docs/security.md).
- **`api call` refuses the methods that make a public link**: `enablePublicUrl` of generated documents,
  `crm.invoice.getExternalLink` and `salescenter.payment.getPublicUrl`, reads and writes alike, as it already refused
  `disk.*.getExternalLink`.
