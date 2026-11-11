# Settings

Settings live in one file, `config.json`, in the folder `b24 doctor` shows. Each profile has its own part,
and `defaults` apply to every profile. This page lists how to see and change them.

```sh
b24 work config show
b24 work config set limit 50
b24 work config unset limit
```

`config show` lists each setting and where it came from: the file, a variable or the default.

## Permissions

`permissions` decides what a command may do for this profile: `allow`, `ask`, `readonly` or `deny`, per permission
key. Over MCP `ask` does not ask: the write goes ahead. The keys, their built-in levels and how to keep an agent's
writes yours are on [Permissions](permissions.md).

## CRM relationships

Two settings of the shared store, not of a profile, say how the sync stores relationships:
`crm.bitrix24:<portal>.links` (`reported` or `review`) and `crm.bitrix24:<portal>.company-types` (what each company
type means). [Who is who](usage.md#who-is-who) shows both.

## Run records

A command that fails is kept as a run, for `b24 runs list` and `runs show`. A command that calls the portal is kept
when it succeeds too, with the requests it made, unless `record` is `false` (then only failures) or it ran with
`--no-record`. `record_input` decides whether a run keeps the words you typed; it is `true` unless you set it to `false`. Secrets are masked either way; see
[Security](security.md).
