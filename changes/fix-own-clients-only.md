### Changed — may break callers

- Under `scope mine` a sync copies only the user's clients: the contacts and companies assigned to them or to an
  unassigned user, and the ones named on the deals and leads it copies. Before, it copied the portal's whole contact and
  company base, 114 165 contacts on one live portal where the user held no deal. The daily deletion pass lists only
  those ids too. Watch for: a copy that already holds the whole base keeps its contacts; companies wait for
  `sync --rescan`.
- Only a Bitrix24 administrator may sync under `scope all`. A department head is refused like an employee
  (`bitrix.scope-all-admin-only`, was `bitrix.scope-all-manager-only`).
- Anyone but a Bitrix24 administrator sees phones and e-mails only of their own clients. `people list` and
  `organizations list` leave them out of the rest; `people show` and `organizations show` of one give them, at most
  100 such contacts and companies a day for the user and their agents together. `api call` refuses contact and
  company reads (`crm.contact.*`, `crm.company.*`, `crm.item.*` of type 3 or 4, requisites, addresses, duplicate
  searches) to anyone but an administrator, whatever the permissions say.
- Only a Bitrix24 administrator may name a working employee in `crm.bitrix24:<portal>.unassigned`; a department head
  is held to dismissed users and non-employees like everyone else.
