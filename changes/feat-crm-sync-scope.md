### Added

- A sync copies only the deals and leads of the webhook's own user by default, and those of the users in
  `crm.bitrix24:<portal>.unassigned` (Bitrix24 always names a responsible person, so this is how a website form's or
  an integration's deals count as nobody's). `config set crm.bitrix24:<portal>.scope all` copies every one. The sync
  answer has `scope` (with the webhook's user as `self`), and each kind's `out_of_scope`: a deal given to another user
  leaves the local copy at the next sync. Contacts and companies are copied whole as before.
- Without a `scope` setting, a first `mine` that would mark more than half of the stored deals or leads deleted keeps
  them (`crm.narrowing-held`) until the owner sets `scope`. An agent cannot set `scope`, `self` or `unassigned`.
- One portal's copy belongs to one user: a sync through a webhook of another user than the first sync's is refused
  until `config unset crm.bitrix24:<portal>.self`.

### Changed — may break callers

- The first sync after the upgrade marks other users' deals and leads deleted in the local copy: they leave lists and
  search, and their earlier copy stays in the store file. Set `crm.bitrix24:<portal>.scope all` before it to keep them.
- A list answer without its items now fails that kind's sync (`invalid_response`) instead of ending the list there.
