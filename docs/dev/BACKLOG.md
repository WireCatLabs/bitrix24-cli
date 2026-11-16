# Backlog

Open work for bitrix24-cli (`b24`), most important first. Users read what shipped in
[CHANGELOG.md](../../CHANGELOG.md) and what is planned in [roadmap.md](../roadmap.md). Shared CRM work belongs to
cli-core; an item here names it when b24 only adopts it.

## Rules

- **An id is permanent** and never reused: `B24-<n>`, the next number above the highest in this file, on any branch.
- **One item:** id · priority · title · where the work starts · link to details.
- **Priority:** **P1** breaks something real, tells users something untrue, or blocks install · **P2** this cycle.
- **Close in the PR that ships the work:** delete the line here in that PR.

## Now (P1)

Nothing.

## Next (P2)

- **B24-2** · P2 · setup · **Screenshots for the setup flow** ([src/setup/flow.ts](../../src/setup/flow.ts)): capture
  `webhook-menu` (Developer resources → Common use cases → Other), `webhook-permissions` (the Assign permissions
  block with the scopes ticked), `webhook-address` (the created webhook and its address, secret blurred), `app-form`
  (the local application form in Server mode), `app-permissions` and `app-keys` (Application ID and key, blurred), on a
  Russian and an English portal. PNG, JPEG or WebP, at most 2 MB. `package.json` `files` publishes no `src/`, so put
  them in a published folder (or add one), declare them in `assets` with an `image` block each, and keep
  `setupFileProblems` in [flow.test.ts](../../src/setup/flow.test.ts) at `[]`.
