# b24 — design

Written by `npx @wirecat/cli-template new`. The agent reads it first, asks the further questions the reference CLI
does not answer, and starts building only after the owner has read it.

## First task

Delete this section once every step is done (WC-DOC-3).

1. If an answer below is missing, ask the owner the [design interview](skills/design-interview/SKILL.md).
2. Learn from the reference CLI below: its provider, its store and its commands.
3. Ask the further questions in the interview that the reference CLI does not answer, and write the answers here.
   Build only after the owner has read this page.
4. When the first command reaches the service, rewrite `README.md`, `docs/index.md` and the description in
   `package.json` and `skills/bitrix24-cli/SKILL.md` to say what the tool does and who it is for. Rewrite the
   MCP server's instructions in `src/mcp.ts` too: name the kinds of outside text the CLI carries (WC-MCP-11).

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

### Live first, the store later

- Every read asks the portal; nothing is kept locally yet. Slice 2 adds a sync into cli-core's store and `--offline`
  reads from it. Until then a command that needs the portal refuses `--offline`.
- A list follows WC-OUT-5. Bitrix24's newer API (REST 3.0) gives no total, so `page.total` is left out and
  `page.has_more` says whether another page exists. `--all` has no cap: a long walk is cut by the run's budget and
  answers `meta.complete: false` (WC-CMD-10).

### Storing, indexing, syncing and deleting

1. **Kept locally.** Nothing in slice 1. From slice 2: pipelines, stages, deals and leads as CRM records in cli-core;
   contacts as `people` identities, joined to a person only by an exact email (WC-ACCT-11); companies as
   organizations through the records mapping, where a same-name match is only a candidate for review (WC-DATA-1,
   WC-DATA-2). Custom fields go under `provider_metadata` with their labels.
2. **How it syncs.** On demand, with `sync`: changed records by their update time, with an overlap, then an id-only
   pass that finds deletions. Bitrix24 sends events only to an installed app, and a webhook cannot install one, so
   there is no change token to follow. `store status` shows where the sync stands.
3. **When the portal deletes something.** The local copy is marked deleted and kept, never wiped, and only after a
   full id pass has finished (WC-DATA-7).
4. **Deleting local data.** Per account, through cli-core's shared commands, as every CLI does; there is no command
   of `b24`'s own for it.

### Search

1. **What a search finds.** Deal and lead titles, and the names of people and organizations. The portal itself can
   search only whole values in REST 3.0, so a free word in a list query is sent to the older REST 2 method, which
   matches part of a title.
2. **`search all` and `memo context <person>`.** Yes, once cli-core has a `crm` kind for providers and search
   (slice 2).
3. **Without a network.** Nothing in slice 1. From slice 2, every list and show with `--offline`.

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
     `api call crm.deal.update` cannot get round `deals.update: deny`; an update that sets a stage also checks
     `deals.move` or `leads.move`.
   - Through `api call`, the writes of method families that reach people or start the portal's automation are
     `deny` until the owner allows them: `im`, `imopenlines`, `imbot`, `messageservice`, `mailservice`,
     `telephony`, `voximplant`, `bizproc`, `crm.automation`, `crm.activity`, `tasks`, `task`, `user.add` and
     `batch`, which can hold any of them. A method whose name ends in `delete` asks.
   - Never allowed, whatever the permissions: a bulk or filtered delete. A delete takes one id.
   - Messages to clients and employees (`im`, `imopenlines`) are not part of slice 1.
3. **Writes are safe to repeat.** Each write gets an `operation_id`, goes through cli-core's write guard and is
   journalled (WC-OUT-10, WC-PERM-13). On REST 3.0 the `operation_id` is sent as the `Idempotency-Key` header, so a
   retry with `--operation-id` does not create a second record. A write that got no answer is `outcome_unknown` and
   is never retried by `b24` itself.

### Writes

- `create` and `update` take the vocabulary's flags where it has one (`--title`, `--name`, `--first-name`,
  `--last-name`) and every other field through `--body`, a JSON object in Bitrix24's REST 3.0 field names. cli-base
  has no flags for an amount, a currency, a stage, a pipeline, a phone or an email yet; when it has, they replace the
  matching `--body` keys.
- `move` takes `--stage` by id or name, read among the record's own pipeline's stages. Its flag lives on a lint
  override until cli-base has a stage flag.
- A stage change can start the portal's own automation (robots, business processes), which may write to clients.
  That is the portal owner's set-up, not `b24`'s; `move` stays `allow` by WC-PERM-22, and the owner can set
  `deals.move` and `leads.move` to `ask` or `deny`.
- There is no delete command in slice 1.

### The portal's limits

- Bitrix24 allows 2 requests a second with a burst of 50 per portal (5 and 250 on Enterprise), shared by every app
  and webhook. `b24` paces itself with cli-core's `Pacer`, shared by every `b24` process of a profile.
- A refused rate (HTTP 503 `QUERY_LIMIT_EXCEEDED`, or 429 `OPERATION_TIME_LIMIT` for one method) is `rate_limited`
  with how long to wait. A read is tried again a few times; a write only when it carries an `Idempotency-Key`.

## Open questions for the owner

- A `leads` table in cli-core, or leads only as source records: the owner's portal runs its main funnel on leads
  (NEED-2279).
- A cli-base view noun for counts per value, shared by `tasks counts` and a deal funnel (NEED-2280).
