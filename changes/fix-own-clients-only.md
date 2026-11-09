### Changed — may break callers

- Under `scope mine` a sync copies only the user's clients: the contacts and companies assigned to them or to an
  unassigned user, and the ones named on the deals and leads it copies. Before, it copied the portal's whole contact and
  company base, 114 165 contacts on one live portal where the user held no deal. The daily deletion pass lists only
  those ids too. Watch for: a copy that already holds the whole base keeps its contacts; companies wait for
  `sync --rescan`.
- Only a Bitrix24 administrator may sync under `scope all`. A department head is refused like an employee
  (`bitrix.scope-all-admin-only`, was `bitrix.scope-all-manager-only`).
