# Roadmap

See what `b24` does today and what comes next, before you build a workaround for something it lacks. It may already
be on the way.

You learn which parts of your Bitrix24 an agent can work with now, and which come in the next releases. The order is
approximate and can change. To suggest something, open an
[issue on GitHub](https://github.com/WireCatLabs/bitrix24-cli/issues).

**On this page:**

1. [What works today](#what-works-today)
2. [Next](#next)
3. [Later](#later)

## What works today

`b24` signs in to a Bitrix24 portal with an incoming webhook, or through a local application you create in the
portal. It reads and changes deals, leads, contacts (`people`)
and companies (`organizations`), moves and closes deals and leads, and reads pipelines, stages, products and
employees (`users`). `fields list` shows the portal's own fields with their options. `sync` copies pipelines,
companies, contacts, deals and leads into the local WireCat store, so `deals`, `leads`, `pipelines` and `stages` work
offline too, and `search all` searches them. It also stores who is who: contacts as members of their companies,
deals' contacts and owners, employees of your own company and their reporting lines. `pipelines show` is the sales
funnel board: each stage's deals or leads, with their number and their total in each currency. `deals list`,
`leads list`, `people list` and `organizations list` print a page as a CSV table for a spreadsheet with
`--format csv`. `schedule` runs `sync` on a timer. `changes list` shows what changed in the copy, and `--format
report` makes it a morning digest. With `activities` on, the sync also reads the calls, e-mails, to-dos, tasks and
comments on deals and leads. `meetings sync` copies the portal's calls, `meetings transcribe` turns their recordings
into text on this computer, and `calls export` writes other phone systems' calls into Bitrix24. `b24 api` reaches any
portal method by name. Every command is in the [command reference](commands.md).

## Next

- **Contacts and companies from the local store.** `people` and `organizations` move to the same shared model as
  deals and leads, so they read from the local store and work offline.
- **Custom fields of contacts kept locally.** The values of your portal's own fields on contacts are stored with the
  contact, so you can read them offline.
- **Client files and documents.** The files of deals and their attachments, and documents made from the portal's
  templates. The setup already asks for the `disk` and `documentgenerator` scopes they need.

## Later

- **Portal events.** A queue of the portal's events, so `b24` learns what changed without a full pass.
- **Activities, to-dos and timeline comments on contacts and companies.** Those on deals and leads are read.
- **Quotes, smart invoices and smart processes.**
- **A duplicate check before create.** `b24` warns when a contact, company or lead like the new one already exists.
- **CSV import.** Export is there: `--format csv` on the lists.
- **A Deals page in the WireCat desktop app.**

What each released version changed is in the [changelog](../CHANGELOG.md).
