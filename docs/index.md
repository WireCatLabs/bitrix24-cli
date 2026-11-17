# Bitrix24

Know where every deal stands and what a client said on the phone, without opening Bitrix24. `b24` gives the AI agent
you already use, such as Claude Code or Codex, a copy of your deals and leads on your computer, so it answers from
that copy, even offline. It moves and closes deals for you too, as far as you allow.

Ask which deals are stuck in "Quote sent", what changed in the CRM overnight, or how the Sales funnel did in the last 30
days and why deals were lost. The agent answers with the deal, its amount and its owner. You need a Bitrix24 plan
that includes the REST API, which is how programs talk to the portal.

**On this page:**

1. [What you get](#what-you-get)
2. [Things a newcomer would not guess](#things-a-newcomer-would-not-guess)
3. [How it looks](#how-it-looks)
4. [Why b24](#why-b24)
5. [What it can do](#what-it-can-do)
6. [How it works](#how-it-works)
7. [Start in a few minutes](#start-in-a-few-minutes)
8. [Limits](#limits)
9. [Find a guide for your task](#find-a-guide-for-your-task)

## What you get

- **The answer, not the search.** Ask about a deal or a client in your own words. The agent finds the deal with its
  amount and owner, read from your computer, with no clicking through the portal.
- **The funnel at a glance.** How many deals reached each stage, how long the closed ones took, and why the lost ones
  were lost.
- **Mornings that start with what changed.** Yesterday's wins, losses and moves arrive as a short digest at the time
  you choose, as a notice on your desktop, or in your Telegram through WireCat's `tg`.
- **Calls you can read.** The recording of a client call becomes text on your computer, so the agent can tell you
  what was promised.
- **Changes by asking.** "Move Kitchen for Example to Contract signed" is enough. The agent finds the stage by its
  name, and you can check which permissions a change needs before it is made.
- **Your CRM beside your chats.** One search finds a deal next to the messages, mail and meetings about it that the
  other WireCat tools keep on your computer.

## Things a newcomer would not guess

- **A webhook is your key.** Bitrix24 gives you a link that works as a password, called an inbound webhook. `b24` acts
  with the rights of the employee who made it. `b24 work setup` shows where to click and which permissions to tick.
- **`work` is a name you choose.** It names one portal, and it is the first word of every command. No command picks a
  portal for you.
- **The copy holds deals, not the whole CRM.** A sync copies the deals and leads of the webhook's employee, or, with an
  administrator's webhook, of the colleagues you choose, with their clients, pipelines and stages. Contacts, companies
  and employees are read from the portal each time.
- **Over MCP, "ask" goes ahead.** MCP is the way apps such as Claude Desktop call a tool, and nobody sits at a
  terminal there to answer a question. Set the writes an agent must not make to read only or refuse before you
  connect it.
- **A stage change can start the portal's robots**, which may write to your clients. Decide who may move a deal before
  an agent gets the profile.

## How it looks

```text
You:    Which of my deals are in Quote sent?
Agent:  (runs b24 work deals list stage:"Quote sent" owner:me)
        · "Kitchen for Example", 15 000 EUR, deal 42
        · "Office for Sample", 8 200 EUR, deal 57
You:    Move Kitchen for Example to Contract signed.
Agent:  (runs b24 work deals move deal:42 "Contract signed")
        Done. "Kitchen for Example" (deal 42) is in Contract signed now.
```

## Why b24

- **A copy of your deals on your computer.** Of the five tools on the
  [comparison](https://wirecat.dev/en/docs/b24/compare), Bitrix24's own Vibecode MCP among them, no other documents
  reading deals and leads without the internet. The next sync takes only the changes.
- **A permission on every action.** Allow, ask, read only or refuse, for each command and each Bitrix24 method.
  Methods that message clients or start workflows, and giving a deal to a colleague, are refused until you allow them.
- **Writes you can check first.** `--dry-run` sends nothing and shows which permissions the write needs. A write that lost its
  answer is never sent again on its own, so a dropped connection makes no second deal.
- **Polite to the portal.** Bitrix24 allows about 2 requests a second for all its apps together. `b24` keeps to that
  pace, and most answers need no request at all.
- **The webhook stays in your system keyring.** It never shows in output, errors or logs.
- **Free and open source.** Apache 2.0.

Another tool fits better when you want Bitrix24 in ChatGPT or Claude in the browser with nothing to run on your
computer (Zapier MCP), or more of Bitrix24 than sales data, such as tasks and chats (Vibecode MCP).

## What it can do

- **Deals and leads:** list them by stage, pipeline or owner, show one with the stages it passed, create, move, close
  as won or lost, set your portal's own fields by their label. [Use it](usage.md)
- **The funnel:** each stage with its count, sum and how many went on, and the last 30 days with time to close and
  lost reasons. [Use it](usage.md)
- **Contacts and companies:** read, create and update them, and export a list to a CSV file for a spreadsheet.
  Employees can be read. [Use it](usage.md)
- **Calls:** the portal's call history, and recordings turned into text on your computer. [Calls](calls.md)
- **What changed:** deals made, moved, won and lost in a window you choose, and a digest on a schedule.
  [Use it](usage.md)
- **The work on a deal:** its calls, e-mails, meetings, tasks and timeline comments once you turn them on, and a task
  on your computer each time a deal enters a stage you name. [Use it](usage.md)
- **Any Bitrix24 method** from a terminal, with the same permission checks. [Commands](commands.md)

## How it works

- **A copy on your computer.** `sync` puts your deals and leads into the WireCat local store, the one file on your
  computer that every WireCat tool shares. Lists, the funnel and search read it, also offline.
- **Sign-in with a webhook or a local application.** Either is kept in the system keyring, or in a private file on a
  computer without one.
- **Made for scripts and agents.** `--json` gives a JSON answer, and an error comes with a code to branch
  on. [MCP](mcp.md)
- **What is stored and what goes over the network.** [Security](security.md)

## Start in a few minutes

Paste this into your agent:

```text prompt
Install b24 with npm install -g @wirecat/bitrix24-cli. Help me run b24 work setup to connect my Bitrix24 portal, then sync and show my open deals.
```

Or in a terminal:

```sh
npm install -g @wirecat/bitrix24-cli
b24 skill install          # teaches Claude Code, Codex and Gemini CLI to use b24
b24 work setup             # make an inbound webhook in Bitrix24, tick its permissions, paste its address
b24 work sync              # copy your deals, leads and their clients
b24 work deals list status:open    # your open deals, read from the copy
```

You need Node.js 22.16 or a later 22.x, or Node.js 24 or later. [Install](installation.md)

## Limits

- Tested on cloud Bitrix24. A self-hosted portal is not tested.
- The REST API comes with Bitrix24's Vibe+ plans and the 15-day trial, not with the Essentials plans
  ([Bitrix24's page](https://apidocs.bitrix24.com/first-steps/access-to-rest-api.html)).
- Contacts, companies, products and employees are read from the portal each time, so they need the internet.

## Find a guide for your task

| Task | Guide |
|---|---|
| Install and connect a portal | [Install](installation.md) |
| Read and change deals, the digest, agents | [Use it](usage.md) |
| Calls and their text | [Calls](calls.md) |
| Connect an app that uses MCP | [MCP](mcp.md) |
| Decide what an agent may change | [Permissions](permissions.md) |
| An exact command or option | [Commands](commands.md) |
| Something does not work | [When something goes wrong](troubleshooting.md) |
| How b24 differs from other Bitrix24 tools | [Comparison](https://wirecat.dev/en/docs/b24/compare) |
