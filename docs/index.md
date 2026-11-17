# b24

Know where every deal stands and what a client said on the phone, without opening Bitrix24. Ask your AI agent in plain
words, in Claude Code, Codex or any app that speaks MCP. The portal keeps your deals in the cloud, and every question
to it is a live request, at about two a second for all its apps together. `b24` reads them through the portal's REST
API and keeps a copy on your computer, so most answers need no request at all.

An agent with `b24` tells you which deals are stuck in a stage and what changed overnight. It moves a deal, closes it
or updates a contact when you ask, as far as the permissions you set allow.

`b24` is a WireCat command-line tool, a program you or your agent run in a terminal. `sync` copies your deals and
leads with their clients into the WireCat local store, the one file on your computer that the WireCat tools share.
`search all` then finds a deal beside your messages, notes and meetings from the other tools. You need one inbound
webhook in Bitrix24, which `b24 work setup` helps you make.

**On this page:**

1. [Start](#start)
2. [Every page](#every-page)

## Start

[Install](installation.md) takes you from nothing to a signed-in profile and the first sync. Then [use it](usage.md)
shows the everyday commands and how to give `b24` to an agent.

## Every page

1. [Install](installation.md): install, make the webhook or a local application, sign in.
2. [Use it](usage.md): profiles, the sync, reading and changing deals, the morning digest, agents.
3. [Calls](calls.md): the portal's calls in the store, and their recordings as text.
4. [MCP](mcp.md): give `b24` to an agent that cannot run commands.
5. [Permissions](permissions.md): what an agent may read, change or must ask about.
6. [Commands](commands.md): every command, option and exit code.
7. [Settings](configuration.md): where settings live and how to change them.
8. [When something goes wrong](troubleshooting.md): symptoms and what to do.
9. [Security](security.md): where the webhook is kept and what never reaches a log.
10. [Roadmap](roadmap.md): what comes next.
