# Permissions

Read this page before you let an AI agent, a script or a colleague change your CRM through `b24`. It shows how to
decide, for each profile, what may only be read, what asks you first and what may go ahead. By the end you can stop
agents from moving deals or deleting, and you know which checks hold whatever the permissions say.

Words this page uses:

- **Profile**: the name you gave one portal's sign-in, such as `work`. It is the first word of a command.
- **Permission key**: the name of a command, such as `deals.move`, or of a group of commands, such as `deals`. A
  longer key is more specific and wins.
- **Level**: what happens when the command runs: `deny`, `readonly`, `ask` or `allow`.

## The levels

| Level | What happens |
|---|---|
| `deny` | The command is refused, a read too. |
| `readonly` | Reads work; a write is refused. |
| `ask` | A write asks first at a terminal; without one it is refused unless `--yes` is given. **Over MCP it runs.** |
| `allow` | The command runs without a question. |

```sh
b24 work config set permissions.deals.move readonly   # no deal moves through b24 on this profile
b24 work config set permissions.deals readonly        # every deal command reads, none writes
b24 work config show                                  # each key with its level and where it came from
```

A refusal is `permission_error` (exit code 5) and names the key. It does not mean the sign-in is broken.

An agent cannot loosen a permission: a `config set` or `config unset` that would lift a limit is refused unless you
run it yourself in a terminal.

## What is set before you change anything

| Key | Built-in level | Why |
|---|---|---|
| `deals.delete`, `leads.delete` | `ask` | A delete cannot be undone. |
| `crm.assign-others` | `deny` | Bitrix24 tells the employee a record was given to them. |
| `api.<method>` of a family that messages people, publishes or starts automation | `deny` | See below; reads too. |
| `api.<method>` that `b24` does not read or write itself | `ask` | It may hold what you keep from agents. |
| Every other command | `allow` | |

The families denied through `api call` are `im`, `imopenlines`, `imbot`, `imconnector`, `log.blogpost`, SMS
(`messageservice`), mail (`mailservice`), telephony (`telephony`, `voximplant`), workflows (`bizproc`,
`crm.automation`), CRM activities (`crm.activity`), tasks (`tasks`, `task`), `user.add`, public file links,
`event.bind` and `batch`. `b24 work api show <method>` names a method's key, its level and the keys it also checks.

## One command can check several keys

A command checks its own key, and the keys of what it does on the way. `--dry-run` names each one with its level, and
sends nothing:

```sh
b24 work deals update deal:12 --stage "Contract signed" --owner 34 --dry-run
```

- A write that sets a stage (`--stage`, `move`) checks `deals.move` or `leads.move`. A won or lost stage, and
  `close`, also check `deals.close` or `leads.close`.
- An owner other than the webhook's own user (`--owner`) checks `crm.assign-others`.
- `api call` checks `api.<method>` and the key of the command that does the same: `api call crm.deal.update` checks
  `deals.update`, and with a `stageId` also `deals.move`. So `api.crm.deal.update: deny` also stops `deals update`,
  `move` and `close`.
- `search all` leaves out a kind whose list key is denied, and names it in `missing`.

## Stage changes start the portal's robots

A stage in Bitrix24 can have robots and business processes: they send the client an e-mail, an SMS or an invoice, or
make a task for a colleague. `b24` cannot see them. If your portal has such robots, decide who may move a deal:

```sh
b24 work config set permissions.deals.move ask        # at a terminal, every move asks you first
b24 work config set permissions.leads.move ask
```

`ask` protects you at a terminal only. Before an agent gets the profile over MCP, set the moves to `readonly`, or turn
on approval in the agent's client: see [Agents and MCP](#agents-and-mcp).

## Agents and MCP

Over MCP nobody is at a terminal to answer, and the server shows no form, so a write at `ask` goes ahead. This holds
for the built-in levels too: an agent with an administrator's webhook may delete deals and leads. Choose one:

- Set `readonly` or `deny` for each write an agent must not make:

  ```sh
  b24 work config set permissions.deals.move readonly
  b24 work config set permissions.leads.move readonly
  b24 work config set permissions.deals.delete deny
  b24 work config set permissions.leads.delete deny
  ```

- Or keep the levels and turn on approval for the `b24_write` tool in your agent's client, so the client asks you
  before each write.

`mcp serve --permission deals.delete=deny` and `mcp add … --permission …` make a level stricter for that one server.
They never loosen the profile. See [MCP](mcp.md).

## Checks that hold whatever the permissions say

- **`B24_READ_ONLY=1`** refuses every write, for that shell or timer. An agent that `schedule agent` starts runs with
  it.
- **An employee's webhook cannot delete or clear.** Unless the webhook's user is a Bitrix24 administrator, `b24`
  refuses every delete, an update that sets a field to nothing, an unbind, a merge of duplicates and `api call batch`
  (reason `employee.*`).
- **Contact and company reads through `api call`** are an administrator's alone.
- **Phones and e-mails** of clients who are not the webhook user's own: at most 100 such contacts and companies a day
  through `people show` and `organizations show`, for the user and their agents together. The count is kept on this
  computer: it stops an accident or an agent, not someone who means to take the base.
- **Whose deals a sync copies** (`crm.bitrix24:<portal>.unassigned`, `scope`, `self`): only you set them; an agent is
  refused.
- **Bitrix24's own access rights.** The webhook acts as the employee who made it, and the portal refuses what that
  employee may not do (`bitrix.access-denied`).

Signed in through a local application instead of a webhook, `b24` acts as the employee who signed in, and every rule
above that names the webhook's user applies to that employee.

More: [settings](configuration.md), [security](security.md).
