# b24

`b24` reads and changes a Bitrix24 portal's sales data from the terminal, from scripts and from AI agents: deals,
leads, contacts, companies, pipelines and their stages, products and employees. It signs in with one of the portal's
incoming webhooks and acts with the rights of the employee who made it.

```sh
npm install -g @wirecat/bitrix24-cli
b24 work session start            # paste the webhook address; it is kept in the keyring
b24 work sync                     # copies pipelines, companies, contacts, deals and leads into the local store
b24 work deals list status:open
b24 work leads list stage:"In progress" --json
b24 work deals move deal:42 "Contract signed"
```

Every command answers JSON with `--json`, every write answers an `operation_id` and can be previewed with
`--dry-run`, and `b24 work mcp serve` gives the same commands to an agent. Start with
[installation](docs/installation.md), then [usage](docs/usage.md). The design is in
[docs/dev/DESIGN.md](docs/dev/DESIGN.md).
