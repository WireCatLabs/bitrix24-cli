# b24

`b24` is a WireCat command-line tool for a Bitrix24 portal's sales data, for the terminal, for scripts and for AI
agents. It reads and changes deals, leads, contacts (`people`) and companies (`organizations`), and reads pipelines,
stages, products and employees (`users`). `sync` copies pipelines, companies, contacts, deals and leads into the
local WireCat store, which `deals`, `leads`, `pipelines` and `stages` read, offline too; contacts, companies,
products and employees are read from the portal.

It signs in with an incoming webhook of the portal, and acts with the rights of the employee who made that webhook.
`b24 work session status --check` says who that is, for the profile `work`.

Start with [installation](installation.md), then [usage](usage.md).
