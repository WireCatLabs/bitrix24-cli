# MCP

Use this page to give an AI agent your CRM over MCP (Model Context Protocol), the way an agent asks a program what it
can do and then calls it. An agent with a terminal, such as Claude Code or Codex, does better with the commands and
the skill (`b24 skill install`). MCP is for a client that cannot run commands: a chat app, a remote agent, ChatGPT or
Claude in the browser.

Before you start, sign the profile in (`b24 work session start`) and read [Permissions](permissions.md): over MCP a
write at `ask` goes ahead.

## Add b24 to an agent

```sh
b24 work mcp add claude-code --allow-writes   # or codex
b24 work mcp check                            # the handshake and the tool list, as the client sees them
```

`--allow-writes` says you know the profile offers tools that write. For any other client, `b24 work mcp config`
prints the entry to paste into its settings. By hand, for Claude Code:

```sh
claude mcp add b24 -- b24 work mcp serve
```

One server can serve several profiles: `b24 mcp serve --profiles work,sales`, or `--profiles all`. Each call then
names its profile, and the agent asks you if you did not say which.

## What the agent sees

The server has three tools:

- `b24_tools_search` finds a command by words, with its arguments and the shape of its answer.
- `b24_read` runs a command that only reads: `{ "command": "deals list", "arguments": { "query": "status:open" } }`.
- `b24_write` runs a command that writes: `{ "command": "deals move", "arguments": { "deal": "deal:12", ... } }`.

A command is named as on the command line, without the profile, and checks the same permission key. These are never
offered over MCP: `api call`, `schedule`, `session start` and `session end`. The agent asks you to run them in a
terminal.

Text from the portal comes marked `untrusted`: deal and lead titles, pipeline and stage names, the names of contacts,
companies and employees, custom field values, phones, e-mails and links, and what `search all` finds. The agent is told
it is data, never instructions.

## Keep writes yours

Over MCP nobody is at a terminal to answer `ask`, so the write goes ahead, built-in levels included:

- `deals.move=ask` does not stop an agent from moving a deal, and a stage change can start the portal's robots, which
  may write to a real client.
- `deals.delete` and `leads.delete` are `ask` by default, so an agent with an administrator's webhook can delete.

Choose one before you add the server:

- Set `readonly` or `deny` for each write the agent must not make:
  `b24 work config set permissions.deals.move readonly`. The full list is in
  [Permissions](permissions.md#agents-and-mcp).
- Or turn on approval for the `b24_write` tool in your agent's client, so the client asks you before each write.

To make one server stricter than the profile, give it its own levels. They never loosen the profile:

```sh
b24 work mcp add claude-code --allow-writes --permission deals.delete=deny --permission leads.delete=deny
b24 work mcp serve --permission deals=readonly
```

## ChatGPT and Claude in the browser

A browser app reaches the server over HTTP through your own tunnel, such as Tailscale Funnel:

```sh
b24 work mcp serve --http --public-url https://laptop.example.ts.net
```

The server listens on `127.0.0.1` only, port 8765 (`--port` changes it). A browser app logs in with a one-time code
the command prints. `b24 work mcp revoke` ends every login.

`b24 work mcp server start` runs the same server in the background. `mcp server status` shows its port, the login
code and the apps logged in, and `mcp server stop` ends it.

More: [permissions](permissions.md), [security](security.md), [the command reference](commands.md#b24-mcp).
