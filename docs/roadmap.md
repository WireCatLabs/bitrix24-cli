# Roadmap

This page lists what is planned for `b24` and is not in it yet. Read it before you build a workaround for a missing
feature: it may already be on the way. The order is approximate and can change. To suggest something, open an
[issue on GitHub](https://github.com/WireCatLabs/bitrix24-cli/issues).

## What works today

`b24` signs in to a Bitrix24 portal with an incoming webhook. It reads and changes deals, leads, contacts (`people`)
and companies (`organizations`), moves and closes deals and leads, and reads pipelines, stages, products and
employees (`users`). `fields list` shows the portal's own fields with their options. `sync` copies pipelines,
companies, contacts, deals and leads into the local WireCat store, so `deals`, `leads`, `pipelines` and `stages` work
offline too, and `search all` searches them. `b24 api` reaches any portal method by name. Every command is in the
[command reference](commands.md).

## Next

- **A sales funnel board.** Deals grouped by stage, with the number of deals and their total in each currency per
  stage.
- **Contacts and companies from the local store.** `people` and `organizations` move to the same shared model as
  deals and leads, so they read from the local store and work offline.
- **Custom fields of contacts kept locally.** The values of your portal's own fields on contacts are stored with the
  contact, so you can read them offline.

## Later

- **Sign-in with a local app.** An OAuth sign-in instead of a webhook, and a queue of portal events, so `b24` learns
  what changed without a full pass.
- **Activities, to-dos and timeline comments** on deals, leads, contacts and companies.
- **Quotes, smart invoices and smart processes.**
- **A duplicate check before create.** `b24` warns when a contact, company or lead like the new one already exists.
- **CSV import and export.**
- **A Deals page in the WireCat desktop app.**

What each released version changed is in the [changelog](../CHANGELOG.md).
