# Testing

How the tests run, and what they never touch. The rules are the handbook's
[Testing page](../../node_modules/@wirecat/cli-base/docs/standards/testing.md).

- `pnpm test` runs vitest. `@wirecat/cli-base/testing/setup` gives each test file its own temporary home folder, a
  keyring that throws and no network, and points this CLI's config, state, cache and the shared store into that
  folder. `src/testing/sandbox.ts` names the config folder, which tests write into by name.
- `pnpm test:coverage` adds the coverage floor in `vitest.config.ts`.
- `pnpm test:slow` lists the 20 slowest tests and the 10 slowest files. No test waits for real time (`WC-TEST-5`):
  waits go through an injected sleep, and `fakeClock()` from `@wirecat/cli-base/testing` records them.
- Each run logs the command lines the tests drove (`coverage/argv.jsonl`). `pnpm test:matrix` turns that log into
  [test-matrix.md](test-matrix.md); a command or option no test drives needs a reason in
  `scripts/test-matrix-untested.ts`.
- `src/testing/fake-crm.ts` is a portal's CRM in memory that refuses what the real one refuses: a REST 3.0 field name
  its reference does not document (`src/crm/rest3-fields.ts`, the one list the adapter and the fake share), a stage
  of another pipeline. Like the live portal, it ignores `Idempotency-Key`, so a repeated write is made a second time.
  `src/crm/contracts.test.ts` runs cli-core's `crmSourceContract`, `crmSyncContract` and
  `crmWriteContract` against it, and `src/testing/sandbox.ts` gives each test its own state folder and store, since
  the portal's pace and a sync's cursor live there.
- `pnpm contracts:check` runs the built CLI against `contracts/plan.json`: help, discovery, errors and the MCP tool
  list. `pnpm exec cli-contract contracts/plan.json --update` rewrites the snapshots; review the diff.
- `pnpm contracts:upgrade` checks that this build reads what the previous release wrote
  ([WC-TEST-14](../../node_modules/@wirecat/cli-base/docs/standards/testing.md)). `contracts/previous/` installs that
  release from npm (`@wirecat/previous-cli`, now `@wirecat/bitrix24-cli@0.6.0`). `contracts/seed.mjs` loads its own
  modules and its own cli-core and syncs one deal and its pipeline from a fake portal into the synthetic store, as
  `b24 sync` would. `contracts/upgrade.json` then reads the deal with that release and with this build, and this
  build's sync cursors and pipelines. The webhook is not seeded: cli-core's token store reaches for the keyring even
  to write a file, and the contract runner denies the keyring. After a release, move the baseline: the version in
  `contracts/previous/package.json` and in `upgrade.json`'s `previous.version`, then
  `pnpm --dir contracts/previous install`. A cli-core bump that migrates the store makes this build print one line on
  stderr the first time it opens the old store; give that case the exact line as its `diagnostic`.
- `pnpm smoke` installs the packed package into a temporary folder and runs it offline.
- `pnpm audit:commands` audits the command tree beside the latest published WireCat CLIs.

## The bundle a user installs

`pnpm build` compiles `src/` with `tsc`, then cli-base's `cli-dev bundle`
([WC-LAY-10](https://github.com/WireCatLabs/cli-base/blob/main/docs/standards/layout.md))
bundles `dist/bin/b24.js` into `dist/bundle/` and makes the bin a loader. The vitest suite runs
against `src/`, so `scripts/smoke-bundle.ts` is the proof the bundle works: `pnpm smoke:node` runs it
under Node and `pnpm smoke:bun` under Bun, both in CI.
