### Added

- `session start` and `session status --check` answer whether the webhook's user is a `manager` (a Bitrix24
  administrator or the head of a department), beside `admin`.

### Changed — may break callers

- Only a manager copies every deal and lead: a sync under `crm.bitrix24:<portal>.scope all` is refused
  (`configuration_error`) unless the webhook's user is a Bitrix24 administrator or the head of a department, checked
  on every sync. Anyone else copies their own deals and leads and the unassigned ones; the refusal says to set
  `scope` to `mine`. Watch for: a webhook without the `department` scope counts a department head as an employee.
