### Fixed

- **`api call` refuses lead reads to anyone but a Bitrix24 administrator**, as it refuses contact and company reads.
  A lead holds its own name, phones and e-mails, so `crm.lead.list` handed an employee the whole portal's lead contact
  data past the 100-a-day rule.
- **Won and lost stages read from `EXTRA.SEMANTICS` are won and lost, not open.** A stage the portal lists without
  the short `SEMANTICS` carries only `success`, `failure` or `apology`, which `sync` stored as open: their deals counted
  as open and `deals close` found no won stage.
