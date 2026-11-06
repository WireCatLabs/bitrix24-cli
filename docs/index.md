# b24

`b24` is a WireCat command-line tool for a Bitrix24 portal's sales data, for the terminal, for scripts and for AI
agents. It reads and changes deals, leads, contacts (`people`) and companies (`organizations`), and reads pipelines,
stages, products and employees (`users`). Every read asks the portal; nothing is kept on this computer yet.

It signs in with an incoming webhook of the portal, and acts with the rights of the employee who made that webhook.
`b24 <profile> session status --check` says who that is.

Start with [installation](installation.md), then [usage](usage.md).
