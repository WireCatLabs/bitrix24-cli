### Changed — may break callers

- A sync copies only the deals and leads of the users the owner chooses in `crm.bitrix24:<portal>.unassigned`, and
  their clients. No one is chosen by default, the webhook's own user included: until the owner chooses, a sync is
  refused (`configuration_error`, reason `bitrix.scope-users-unchosen`) and names the `config set` to run. Watch
  for: an existing copy fails its next sync until the owner chooses.
- No sync copies the whole CRM any more, an administrator's either: a sync under a stored `scope all` is refused
  (reason `bitrix.scope-all-refused`, was `bitrix.scope-all-admin-only`) and says to set `mine`. Once set, deals and
  leads of users not chosen are marked deleted in the local copy. Find any other client live on the portal with
  `people list` or `organizations list`.
- An employee's webhook may choose themselves, a dismissed user or a non-employee; an administrator's, anyone.

### Fixed

- A contact's name no longer carries the `null` or `null #<id>` a portal import left in its name fields
  ("Ярослав Орлов null #907" is now "Ярослав Орлов"). 101,876 of 114,165 contacts on one live portal had it. Watch
  for: a name stored before keeps the leftover until that contact is synced again.
