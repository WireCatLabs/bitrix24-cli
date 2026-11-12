### Fixed

- **A lead keeps its own person and company.** A lead often has no contact or company linked; its name and company
  were in the lead's own fields, and `sync` dropped them, so «Иван Петров, ООО Ромашка» was found only by the lead's
  title. `b24` now reads `name`, `secondName`, `lastName` and `companyTitle` and gives them to the store as the lead's
  contact and company name. With a cli-core that keeps them, `leads show` answers `contact_name` and `company_name`
  and `search all` finds the lead by them. They are given to everyone; only the phones and e-mails of other people's
  clients stay hidden.
