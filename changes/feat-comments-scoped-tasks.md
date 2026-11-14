### Added

- **Timeline comments on deals and leads.** With `activities` on, `sync` reads the comments in the timeline of each
  open deal and lead in the copy, and of each closed one that changed since the last sync. `deals show`,
  `leads show` and `search all` see them. The portal answers one deal or lead per request, so a copy of 100 open
  deals takes about 100 requests a sync. A comment on a closed deal that nothing else changed waits until the deal
  changes. See [Activities and tasks on a deal](../docs/usage.md#activities-and-tasks-on-a-deal).

### Fixed

- **Only the tasks of the copy's deals and leads are read.** `sync` asked the portal for every task changed in 90
  days and dropped those on other deals. It now filters by the copy's deals and leads, 50 a request.
