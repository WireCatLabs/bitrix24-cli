### Changed — may break callers

- **Only a Bitrix24 administrator's webhook unlinks records or merges duplicates.** For any other webhook, `api call`
  refuses a method whose name ends in `.unbind`, such as `crm.timeline.bindings.unbind`, with reason
  `employee.unbind`, and a merge of duplicates, `crm.entity.mergeBatch`, which deletes all but one of the records,
  with reason `employee.merge`. No permission level lifts it, as for deletes. `crm.deal.contact.delete` and
  `crm.deal.contact.items.delete` already counted as deletes.
