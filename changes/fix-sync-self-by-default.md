### Fixed

- **A sync copies your own deals and leads without any setup.** Until you choose users in
  `crm.bitrix24:<portal>.unassigned`, a sync copies the deals and leads of the user who signed in, and their clients.
  It used to stop with `configuration_error`, which WireCat Desktop showed as `config.invalid`, until a `config set`
  was run in a terminal. A chosen list works as before, see [whose deals and leads](../docs/usage.md#whose-deals-and-leads).

- **A stored `scope all` names its reason.** The refusal carries `bitrix.scope-all-refused`, where it showed the
  general `config.invalid`.
