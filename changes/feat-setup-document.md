### Added

- **`b24 setup` walks you through connecting a portal**, and WireCat Desktop draws the same steps: create an inbound
  webhook, tick its permissions, paste its address. `b24 setup show --json` prints the steps (setup format v1),
  `b24 work setup apply` checks the address against the portal the way `session start` does and only then keeps it.
  A local application stays one `session start --portal … --client-id …` away, shown at the end.
- **The permissions to tick now name `task` for Bitrix24 tasks, `telephony` for calls, and `disk` and
  `documentgenerator` for client files and documents**, beside `crm`, `user_basic` and `department`. Ticking `disk`
  now saves editing the webhook again when the files feature comes.
- **`changes list`** from cli-core 0.678.0: what changed in the CRM copy in a window, and `--format report` for a
  morning digest.

