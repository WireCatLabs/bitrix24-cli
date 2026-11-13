# Working rules for agents

The [WireCat CLI standards](node_modules/@wirecat/cli-base/docs/standards/README.md) apply here and win over this
file and over every other document in this repository. The handbook ships inside `@wirecat/cli-base`; run
`pnpm install` first. Read the page for the area you change before changing it, and cite the rule ids the change
touches (`WC-<AREA>-<n>`) in the commit message and the pull request. The rules of this CLI alone are in
[CLAUDE.md](CLAUDE.md).

## Design

[docs/dev/DESIGN.md](docs/dev/DESIGN.md) holds the owner's answers to the
[design interview](docs/dev/skills/design-interview/SKILL.md) and the decisions made since. Read it before changing
what a command does, and write a new decision there. Learn how a command reaches the portal from the section below,
and the domain, the store and its commands from the reference CLI.

<!-- cli-template:reference-cli:start -->
## Reference CLI

`b24` is the first CRM CLI, and the shared CRM commands, store and sync it uses live in cli-core. It learned from
gcal-cli (a provider API, `api`, permissions, the write guard, help sections), beeline-cli (a token sign-in) and
tg-cli's Bot API transport (a secret in the URL path); see [DESIGN.md](docs/dev/DESIGN.md).
<!-- cli-template:reference-cli:end -->

## How a command reaches the portal

<!-- cspell:words gcal SECR -->

The template's `comments` sample is gone: b24's own commands cover each pattern it showed. The parts below are the
template's, kept in b24's own files. [cli-template](https://github.com/WireCatLabs/cli-template/tree/main/src) still
has the sample, for a pattern you want to read in isolation.

Kept from the template, the same for every service:

- **Token storage and the command context**, `src/portal.ts`: cli-core's `ProfileTokenStore` keeps the webhook
  address (the environment variable, then the keyring, then a private file; a run with moved folders never replaces
  the owner's entry, WC-SECR-4, WC-SECR-24), and `contextOf` takes settings, the keyring and the run from cli-core's
  `baseContext` only. Every request runs inside its `run()`, which bounds it by `--timeout` and records a run named
  after the command (WC-LIFE-5, WC-LIFE-15).
- **Sign-in**, `src/commands/session.ts`: `session start | status | end | list`. The webhook address is read hidden or
  from stdin, never as an argument, and checked against the portal before it is kept (WC-ACCT-12, WC-SECR-5).
- **Permissions**, `src/config.ts` and `src/api-keys.ts`: the program hands cli-core the whole `configuration`, and
  each command path is its own key (WC-PERM-22). `api call` also checks the key of the command it does the same as,
  with `alsoChecks`.
- **Writes**, `src/commands/write.ts` and `src/commands/crm-writes.ts`: the guard asks or refuses by the command's
  key, the send journal records the attempt, the answer carries `operation_id`, and a write is tried again only when
  the portal refused its rate: one that got no answer is `outcome_unknown` (WC-PERM-13, WC-PERM-17, WC-OUT-10,
  WC-LIFE-9). `--dry-run` and
  `B24_READ_ONLY` are cli-core's.
- **MCP and doctor**, `src/program.ts`: cli-core's `appMcpCommand` and `appDoctorCommand`, with b24's own `name` and
  `untrusted` list (WC-MCP-11).
- **The test harness**, `src/testing/harness.ts`: the CLI through its own `run()`, with a memory keyring and the fake
  portal in place of the network (WC-TEST-2, WC-TEST-3, WC-TEST-6).

Bitrix24's own:

- **The transport**, `src/bitrix/transport.ts`: the webhook's secret in the URL path, never in output, no redirects,
  a timeout, cli-core's `Pacer` at the portal's limit shared by every profile on the portal, and cli-base's error
  codes. It tries a read again up to 3 times on a refused rate or a lost answer, and a write only on a refused rate
  (WC-SECR-6, WC-SECR-7, WC-OUT-20). `src/bitrix/errors.ts` maps the portal's errors.
- **Wire shapes and mappers**, `src/crm/` and `src/bitrix/methods.ts`: each field name from the Bitrix24 REST
  documentation or a captured answer, never from memory; no wire type leaves them (WC-ARCH-3).
- **The commands**, `src/commands/crm.ts`, `crm-shared.ts`, `crm-writes.ts` and `api.ts`: the shared CRM commands
  are cli-core's; b24 adds the portal's own reads and writes.
- **The strict fakes**, `src/testing/fake-portal.ts` and `src/testing/fake-crm.ts`: they refuse an unknown method,
  parameter or field, so a name typed from memory fails a test instead of reaching the owner's portal.

## Template-owned files

This CLI was made from [cli-template](https://github.com/WireCatLabs/cli-template). `template.json` names the files
`npx @wirecat/cli-template upgrade` keeps in step with the template. Change one of them here only when this CLI needs
to differ; `upgrade` asks before it touches your change. Text that holds for this CLI alone goes into the pages it
owns, such as `DESIGN.md`, `CLAUDE.md` and `README.md`, not into a template-owned page.
