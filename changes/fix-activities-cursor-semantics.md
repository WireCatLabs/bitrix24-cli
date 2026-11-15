### Fixed

- **`api call` refuses lead reads to anyone but a Bitrix24 administrator**, as it refuses contact and company reads.
  A lead holds its own name, phones and e-mails, so `crm.lead.list` handed an employee the whole portal's lead contact
  data past the 100-a-day rule.
