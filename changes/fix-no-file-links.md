### Security

- **No file download link in the copy or the output.** A file in a CRM record's custom field is now kept as its
  file id, in `sync` and in every `show`, `list` and write answer: Bitrix24's download link (`urlMachine`,
  `downloadUrl`) carries an access token. A file with no id and a portal link with a token show as `[link removed]`;
  a site or link field typed by hand stays. `api call` prints `[link removed]` in place of every download link, every
  generated document's `publicUrl`, and every portal link with a token. A copy synced before this version may still
  hold such links: `b24 work sync --rescan` rewrites the records the portal still lists; a record deleted or outside
  the sync's scope keeps what it held until `account remove --delete-data`. See [Security](../docs/security.md).
- **`api call` refuses the methods that make a public link**: `enablePublicUrl` of generated documents,
  `crm.invoice.getExternalLink` and `salescenter.payment.getPublicUrl`, reads and writes alike, as it already refused
  `disk.*.getExternalLink`.
- **A call recording's download is logged without the webhook's code**: its run record keeps
  `/rest/:user/:token/…`, never the link.
