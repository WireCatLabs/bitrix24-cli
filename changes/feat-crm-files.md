### Added

- **Client files: `files list`, `files download` and `files sync`.** `files list --deal 12` (or `--lead`, `--person`,
  `--organization`) reads one record's files from the portal: the files in its file fields, the documents made from
  templates (the PDF when the portal has made it, else the Word file), and the Drive files attached to its activities
  and timeline comments. `files download <id>` saves one under the state folder and reads its text, which `search all`
  then finds. A source the webhook may not read, such as activity files without the `disk` scope, is named under
  `issues` and the others are still listed. Each download asks the portal for a fresh link and fetches it from the
  portal alone; no link reaches the store or an answer. See [Client files](../docs/usage.md#client-files).

### Changed — may break callers

- **`api call` hides more links.** It now uses cli-core's rule: besides the download keys and the portal's tokened
  paths, any link that carries `auth=`, `access_token=`, `api_token=` or `X-Amz-Signature=` prints as
  `[link removed]`, whatever its host. Drive's `ERROR_NOT_FOUND` (such as `api call disk.file.get` of a missing file)
  is now `not_found`, exit 6, not `validation_error`.

- **`search all` can answer a new hit kind, `crm_file`**, the text of a downloaded file. A script that switches over
  `kind` gets it. It comes with `@wirecat/cli-core` 0.710.0, whose store moves to version 69 (forward-only).
