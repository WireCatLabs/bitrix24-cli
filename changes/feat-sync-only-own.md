### Changed — may break callers

- No sync copies the whole CRM any more, an administrator's either: a sync under a stored `scope all` is refused
  (`configuration_error`, reason `bitrix.scope-all-refused`, was `bitrix.scope-all-admin-only`) and says to run
  `config set crm.bitrix24:<portal>.scope mine`. Once set, deals and leads that are not the user's or unassigned are
  marked deleted in the local copy. Find any other client live on the portal with `people list` or
  `organizations list`.
- An administrator names in `crm.bitrix24:<portal>.unassigned` only a dismissed user or a non-employee, like
  everyone else: a working colleague's deals are no longer copied as nobody's.
