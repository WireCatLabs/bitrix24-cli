# b24 — design

Written by `npx @wirecat/cli-template new`. The agent reads it first, asks the further questions the reference CLI
does not answer, and starts building only after the owner has read it.

## Answers

- **Category:** CRM (sales: deals, contacts, companies)
- **Content languages:** ru, en
- **Sign-in:** an API token or key
- **The API:** official API documentation only
- **How people filter:** by time, by person, by container (chat, folder, calendar), by words in the text, by status or label
- **Never in the store, a log or the output:** tokens and passwords, links that carry a secret
- **Untrusted input:** messages from other people, names and titles set by others, links

## Reference CLI

No CRM CLI exists yet, so `b24` learns from three, each for one part:

- [gcal-cli](https://github.com/WireCatLabs/gcal-cli): a provider API over HTTP, the `api list | show | call` group,
  per-method permission keys, the write guard and `session list`.
- [beeline-cli](https://github.com/WireCatLabs/beeline-cli): sign-in with a token read hidden or from stdin, kept in
  the keyring.
- [tg-cli](https://github.com/WireCatLabs/tg-cli) `src/bot/transport.ts`: a secret inside the URL path, kept out of
  every error, log and run record.

## Content languages

Languages: ru, en.

## Further answers

Answered from the owner's plan for `b24` (2026-11-06) and his rulings on it.

### Words

- The command is `b24`; the keyring service and the config folder are `bitrix24-cli` (WC-SECR-4).
- CRM records keep cli-base's words: `deals`, `leads`, `pipelines`, `stages`, `products` and `users`. A Bitrix
  contact is a `people` record and a Bitrix company an `organizations` record, the words every WireCat CLI already
  uses.
- A deal's or lead's stage changes with `move`. Won and lost come from the stage's own outcome (`open`, `won`,
  `lost`), which Bitrix24 keeps in the stage's semantics, never from its name.

### The store and the portal

- Deals, leads, pipelines and stages are read from cli-core's store after `sync`, with `--offline` too. People,
  organizations, products, users and fields ask the portal on every read, and refuse `--offline`.
- A list follows WC-OUT-5. Bitrix24's newer API (REST 3.0) gives no total, so `page.total` is left out and
  `page.has_more` says whether another page exists. `--all` has no cap: a long walk is cut by the run's budget and
  answers `meta.complete: false` (WC-CMD-10).

### Storing, indexing, syncing and deleting

1. **Kept locally.** Pipelines, stages, deals and leads as CRM records in cli-core, read by cli-core's shared
   `deals`, `leads`, `pipelines` and `stages` commands (`addCrmCommands`);
   contacts as `people` identities, joined to a person only by an exact email (WC-ACCT-11); companies as
   organizations through the records mapping, each its own organization: cli-core never matches one by name, not
   even as a candidate (WC-DATA-1, WC-DATA-2; cli-core `src/store/sqlite/crm.ts` `saveOrganizations`). Custom fields of deals, leads and companies go into the record's metadata with their labels; cli-core's
   answer does not show them yet. A lead stands in one pipeline b24 makes, `Leads` (`0`), since Bitrix24's leads
   have none.
2. **How it syncs.** On demand, with cli-core's `sync` over b24's `CrmSource` (`src/crm/source.ts`): REST 3.0 lists
   by id (keyset paging, so a record changed mid-round shifts nothing), changes from `updatedTime` at the last
   round's start less ten minutes, then cli-core's daily id-only pass that finds deletions. Bitrix24 sends events only to an installed app, and a webhook cannot install one, so
   there is no change token to follow. `store status` shows where the sync stands.
3. **When the portal deletes something.** The local copy is marked deleted and kept, never wiped, and only after a
   full id pass has finished (WC-DATA-7).
4. **Deleting local data.** Per account, through cli-core's shared commands, as every CLI does; there is no command
   of `b24`'s own for it.

### Relationships

Decided 2026-11-07 with the owner's CRM relationships plan; cli-core writes them as a diff that never overrides the
owner (WC-DATA-6) and withdraws what the portal stops reporting (WC-DATA-7). `b24` only maps the portal's fields onto
cli-core's contract (`CrmPerson.organizations`, `CrmItem.people`, `CrmUser`, `CrmDepartment`, `CrmOrganization.own`
and `type`); field names are from the REST 3.0 field pages and the `user.get` and `department.get` pages, not live.

- **Contact → company** ([fields-contact](https://apidocs.bitrix24.com/api-reference/crm/rest-v3/items/fields-contact.html)). REST 3.0
  `companiesId`, first is primary, from the contact list the sync already pages; no
  call per contact. A filter on `companiesId` answers HTTP 500, so `b24` never filters on it. `post` is the
  position. A contact read without `companiesId` leaves its companies as stored.
- **Deal and lead people** ([fields-deal](https://apidocs.bitrix24.com/api-reference/crm/rest-v3/items/fields-deal.html),
  [crm.deal.contact.items.get](https://apidocs.bitrix24.com/api-reference/crm/deals/contacts/crm-deal-contact-items-get.html)). `contactsId` with `contactId` as the primary; `assignedById` is the assignee, which core
  makes the `owner`. `ROLE_ID` of `crm.deal.contact.items.get` is a system field that cannot be set (`0` in every
  example), so no decision-maker or influencer comes from the portal, and `b24` makes no such call.
- **Request budget.** Core takes one request before each source call; every further request the call makes (a
  second page, the lead → deal lookup, the own companies) spends one more through `context.spend()`.
- **A refused scope** carries `scope` in the error's details, from the method's scope, so core's gap names it.
- **Lead → deal** ([fields-lead](https://apidocs.bitrix24.com/api-reference/crm/rest-v3/items/fields-lead.html)). A lead has no field for the deal it became; the deal has `leadId`. Each page of leads costs one
  more `crm.deal.list` with `["leadId", "in", …]`.
- **Users** ([user.get](https://apidocs.bitrix24.com/api-reference/user/user-get.html), [user scope](https://apidocs.bitrix24.com/api-reference/user/user-scope.html)). `user.get` with `USER_TYPE: employee` and no `ACTIVE` filter, so a user who left reaches core inactive
  and loses the own company. A missing `EMAIL` key (no `user_basic`) and a missing `UF_DEPARTMENT` are unknown, not
  empty. When no user row carries `EMAIL`, the source reports a `user_basic` gap through core's `context.gap`:
  employees then have no e-mail and join no mail identity.
- **Departments** ([department.get](https://apidocs.bitrix24.com/api-reference/departments/department-get.html)). `department.get` (scope `department`); `reports-to` is core's department-head derivation,
  `metadata.derived: department-head`. A refused scope fails only this list: core records the gap and changes no
  reporting line. A refusal is REST 2 HTTP 401 `insufficient_scope`, REST 3.0 HTTP 403
  `BITRIX_REST_V3_EXCEPTION_INSUFFICIENTSCOPEEXCEPTION` ([error codes](https://apidocs.bitrix24.com/error-codes.html),
  [REST 3.0](https://apidocs.bitrix24.com/api-reference/rest-v3.html)); the strict fake answers both.
- **Own companies.** A refusal (403 or a missing method) leaves them out as a gap; client companies and their id pass
  still complete. The id pass then cannot list them either.
- **Own companies, read**
  ([crm.mycompany.basic.list](https://apidocs.bitrix24.com/api-reference/crm/rest-v3/items/crm-my-company-basic-list-rest-v3.html)). REST 3.0 `crm.mycompany.basic.list`, which needs no CRM admin right and takes only `id`,
  `title` and the like, `=` and `in`: read whole by offset at the end of every round of companies, and listed in the
  id pass so it never marks them deleted. `crm.company.*` never returns them.
- **Company type** ([dictionaries](https://apidocs.bitrix24.com/api-reference/crm/rest-v3/dictionaries/index.html)). `typeId` goes to core as `type`; it means a relationship only through the owner's
  `crm.bitrix24:<portal>.company-types` setting.
- **No parent company, no dates** ([fields-company](https://apidocs.bitrix24.com/api-reference/crm/rest-v3/items/fields-company.html)). Bitrix24 has neither, so neither is stored.
- **On a timer.** `schedule` is cli-core's shared command, mounted as gcal mounts it and off MCP, so `b24 <profile>
  schedule command <name> --every 1h -- sync` keeps the store fresh.

### Search

1. **What a search finds.** Stored deal and lead titles, through cli-core's shared commands. For people and
   organizations, a free word in a list query goes to the portal's REST 2 `crm.item.list`, which matches part of a
   name; REST 3.0 matches only whole values.
2. **`search all`.** It finds stored deals and leads beside the other WireCat tools' data.
3. **Without a network.** `deals`, `leads`, `pipelines`, `stages` and `store status` read the store, with
   `--offline` too; `sync`, the writes and the portal's own reads (`people`, `organizations`, `products`, `users`,
   `fields`, `api`) refuse `--offline`.

### Security

1. **Secrets.** The sign-in is the portal's incoming webhook address. Its secret is part of the URL path, so the whole
   address is the secret: kept in the system keyring under `bitrix24-cli` / `token:<profile>`, or in a private file
   with `--credential-storage file`; `B24_TOKEN` comes first. It never reaches an error, a log, a run record or the
   output (WC-SECR-6, WC-SECR-7). A webhook acts with the rights of the employee who made it, so
   `session status --check` says whose rights those are: user id, name and whether that user is an admin.
2. **Permissions** follow WC-PERM-22:
   - reads, and an ordinary `create`, `update` and `move`, are `allow`;
   - a delete is `ask`;
   - a write that tells employees something by itself is its own key, `deny` until the owner allows it:
     `crm.assign-others`, checked when a create or update sets `assignedById` to someone other than the webhook's own
     user, whom Bitrix24 then tells they are responsible. The notification is how Bitrix24 is known to behave, not
     yet seen on the owner's portal;
   - `B24_READ_ONLY` refuses every write;
   - `api call <method>` checks `api.<method>` and also the key of the command that does the same thing, so
     `api call crm.deal.update` cannot get round `deals.update: deny`. `crm.item.*` with `entityTypeId` 1 to 4 is
     the lead, deal, contact or company. A create or update that sets a stage (`stageId` in any letter case, a
     lead's `STATUS_ID`) also checks `deals.move` and `deals.close`, or the leads' keys, since the stage may be won or
     lost. The other way round, `api.crm.deal.update` is checked by `deals update`, `move` and `close` through
     cli-core's `CrmWrites.alsoChecks`: `deny` stops them before any request, `ask` asks, and `--dry-run` names it.
     The method name is lowercased and loses a `.json` suffix before any key is read. `department.*` also checks
     `users.list` and `crm.mycompany.*` `organizations.list`.
   - `api call` defaults come from an allow list: the reads `b24` makes (`crm`, `catalog`, `user`, `department`,
     `profile` and the method listings) and the four CRM types' create and update are `allow`; a method whose name ends in
     `delete` and every other method are `ask`; the families that reach people, publish or send data out are
     `deny`, reads included, until the owner allows them: `im`, `imopenlines`, `imbot`, `imconnector`, `log.blogpost`,
     `messageservice`, `mailservice`, `telephony`, `voximplant`, `bizproc`, `crm.automation`, `crm.activity`,
     `tasks`, `task`, `user.add`, `disk.file.getexternallink`, `disk.folder.getexternallink`, `event.bind` and
     `batch`, which can hold any of them.
   - Never allowed, whatever the permissions: a bulk or filtered delete. A delete takes one id.
   - Messages to clients and employees (`im`, `imopenlines`) are not part of slice 1.
3. **A write is sent once.** Each write gets an `operation_id`, goes through cli-core's write guard and is
   journalled (WC-OUT-10, WC-PERM-13). On REST 3.0 the `operation_id` is sent as the `Idempotency-Key` header, but
   the live check of 2026-11-07 saw a repeated create make a second lead, so the write port declares Bitrix24 not
   idempotent and there is no `--operation-id`. A write that got no answer is `outcome_unknown`, and the owner looks
   at the portal before writing again.

### Writes

- Deals and leads are written through cli-core's write port (`CrmWriter`, `src/crm/writer.ts`): `create`, `update`,
  `move`, `close`, `delete`, with the operation id as REST 3.0's `Idempotency-Key`, sent once, then read back whole
  into the store. `close` goes to the first won or lost stage of the record's pipeline; Bitrix24 keeps no close
  reason, so `--reason` is refused. A `--field` that names a standard field (`stageId`, `categoryId`,
  `assignedById`, a lead's `STATUS_ID`, in any letter case) is refused before any request.
- `people` and `organizations` keep b24's own `create` and `update`, with the vocabulary's flags (`--name`,
  `--first-name`, `--last-name`), `--field` by label or code, and `--body` in Bitrix24's REST 3.0 field names.
- A stage change can start the portal's own automation (robots, business processes), which may write to clients.
  That is the portal owner's set-up, not `b24`'s; `move` stays `allow` by WC-PERM-22, and the owner can set
  `deals.move` and `leads.move` to `ask` or `deny`.
- `deals delete` and `leads delete` ask first (cli-core's `CRM_WRITE_DEFAULTS`); `people` and `organizations` have no
  delete.

### Custom fields

- **Definitions.** Every lookup reads two calls that need only read rights: REST 3.0 `crm.<type>.field.list`
  (title, filterable) and REST 2 `crm.<type>.userfield.list` (the real type and a list field's options).
  `field.list` alone shows a list field as `int` with no options. `sync` reads them for all four kinds and cli-core
  keeps them, so `fields list <kind>` and a deal's or lead's `--field` read the store; `people` and `organizations`
  read them once per command run, only when a command needs them.
- **A list field's value** is its option's label, with the id beside it: `{ "label", "value": "Wholesale",
  "option_id": "45" }`, both arrays for a multiple field. Every other field keeps `{ label, value }`.
- **Names.** A custom field is named by its code or its whole label, ignoring case, spaces and underscores, so
  `lead_source` is `Lead source`. Two fields with one label are refused with their codes, never guessed. The query
  language has no quoted field name, so a label with spaces is `lead_source:web` or `Lead\ source:web`.
- **Lists** filter only by the fields the portal marks `filterable`. `--json=…,provider_metadata.<code>` adds a
  custom field to each item, and `provider_metadata` alone adds all. A bare code in `--json` is refused by cli-core's
  field check before `b24` runs.
- **Writes:** `--field "<label or code>=<value>"` sets custom fields only, the name and shape of `gh api --field`.
  `--body` comes first, `--field` over it, and the named options over both.

### The portal's limits

- Bitrix24 allows 2 requests a second with a burst of 50 per portal (5 and 250 on Enterprise), shared by every app
  and webhook. `b24` paces itself with cli-core's `Pacer`, shared by every `b24` process of a profile.
- A refused rate (HTTP 503 `QUERY_LIMIT_EXCEEDED`, or 429 `OPERATION_TIME_LIMIT` for one method) is `rate_limited`
  with how long to wait. A read is tried again a few times; a write never is.

## Open questions for the owner

- A `leads` table in cli-core, or leads only as source records: the owner's portal runs its main funnel on leads
  (NEED-2279).
- A cli-base view noun for counts per value, shared by `tasks counts` and a deal funnel (NEED-2280).
