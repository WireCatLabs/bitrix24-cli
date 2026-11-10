### Changed — may break callers

- **Only a Bitrix24 administrator's webhook deletes or clears in the CRM.** For any other webhook, `b24` refuses
  `deals delete`, `leads delete`, an `api call` to a method that deletes (its name ends in `.delete`,
  `.deletefieldvalue` or `.markdeleted`), an update or `.set` that sets a field to nothing (an empty value, `null`,
  `[]`, a `0` company, contact or lead link, or a phone or e-mail marked `DELETE: Y`), and `batch`. The refusal is a
  `permission_error` with reason `employee.delete`, `employee.clear` or `employee.batch`, and no permission level
  lifts it. A create may still leave fields empty.
