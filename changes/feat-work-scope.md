### Changed — may break callers

- **A portal's account is stored as work.** The first `sync`, write or read of a profile stores a new portal's account
  with scope `work`, so work views and meeting preparation read its copy and personal reads leave it out. A portal
  already in the store keeps the scope it has, which is `personal` in every store so far: switch it once with
  cli-core's `setAccountScope` (memo's command for it is not out yet). A sync never changes a scope back.
