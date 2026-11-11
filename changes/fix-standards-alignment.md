### Fixed

- **`b24 commands` lists the CRM by section.** Deals, leads, contacts and companies split into Read and Write,
  pipelines, stages, fields, products, users and `api` are under Read, `sync` under Automate and `session` under
  Set up; before, most of `b24` was under Other.
- **The two local state files are written atomically and stay private.** The list of your own companies and the day's
  count of other people's clients shown now go through a temporary file and a rename, as the settings file does.
