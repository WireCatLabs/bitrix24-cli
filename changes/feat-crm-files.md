### Added

- **Client files: `files list`, `files download` and `files sync`.** `files list --deal 12` (or `--lead`, `--person`,
  `--organization`) reads one record's files from the portal: the files in its file fields, the documents made from
  templates (the PDF when the portal has made it, else the Word file), and the Drive files attached to its activities
  and timeline comments. `files download <id>` saves one under the state folder and reads its text, which `search all`
  then finds. A source the webhook may not read, such as activity files without the `disk` scope, is named under
  `issues` and the others are still listed. Each download asks the portal for a fresh link and fetches it from the
  portal alone; no link reaches the store or an answer. See [Client files](../docs/usage.md#client-files).

### Changed — may break callers

- **`search all` can answer a new hit kind, `crm_file`**, the text of a downloaded file. A script that switches over
  `kind` gets it. It comes with `@wirecat/cli-core` 0.708.0, whose store moves to version 69 (forward-only).
