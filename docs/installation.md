# Install

Get `b24` on your computer and connected to your Bitrix24 portal in a few minutes. After that, your agent reads your
deals, leads and clients, and changes them when you ask.

You install the tool with npm, make an inbound webhook in Bitrix24 and paste its address once. The address stays in
your system keyring. You need Node.js 22.16 or a later 22.x, or 24 or later. Node 23 is not supported.

**On this page:**

1. [Install the tool](#install-the-tool)
2. [Sign in](#sign-in)
3. [With a local application](#with-a-local-application)
4. [Check that it works](#check-that-it-works)
5. [Remove a profile](#remove-a-profile)

## Install the tool

Install `b24` once on each computer where you or an agent use it.

```sh
npm install -g @wirecat/bitrix24-cli
b24 --version
b24 skill install   # the agent skill, for Claude Code, Codex, Gemini CLI and OpenClaw
b24 doctor
```

An agent with no terminal, such as Claude Desktop, uses `b24` over [MCP](mcp.md) instead. `doctor` needs no network
and opens no keyring. It shows the version, where settings live, the profiles that exist, and whether other users of
the computer can read the settings.

Then pick a profile name for your portal, such as `work`. The profile is the first word of every command that uses
the portal: `b24 work sync`.

## Sign in

Make an inbound webhook in Bitrix24 (Developer resources → Common use cases → Other → Inbound webhook). Under
**Assign permissions** (in Russian «права доступа»), tick these, and copy the webhook's address:

| Scope | In Bitrix24 (EN / RU) | Needed for |
|---|---|---|
| `crm` | CRM | Required: deals, leads, contacts, companies, products and activities. |
| `user_basic` (or `user`) | Users (basic) / Пользователи (базовый) | Required: who made the webhook, and employees' names and e-mails. |
| `department` | Company Structure / Структура компании | Reporting lines. See [Who is who](usage.md#who-is-who). |
| `task` | Tasks / Задачи | The Bitrix24 tasks on your deals ([Activities and tasks](usage.md#activities-and-tasks-on-a-deal)). |
| `telephony` | Telephony / Телефония | The portal's calls ([Calls](calls.md)). The employee also needs the right to view call statistics. |
| `disk` | Drive / Диск | The files attached to activities and timeline comments ([Client files](usage.md#client-files)). |
| `documentgenerator` | Document Generator / Генератор документов | Documents made from templates ([Client files](usage.md#client-files)). Bitrix24's docs name `crm` on the method pages and this scope in the scope table. A webhook with `crm` alone lists them too. |

`b24 work setup` shows the same steps in the terminal, and WireCat Desktop draws them. Or sign in directly:

```sh
b24 work session start
```

`b24` asks for the address without showing it, or reads it from stdin, checks it against the portal and keeps it in
the system keyring. `--credential-storage file` keeps it in a private file instead, for a computer with no keyring.
`B24_TOKEN` set to the address is used before either. The address is the password: anyone who has it can do what
the webhook's employee can.

`b24 work session end` forgets the address on this computer. The webhook itself stays in Bitrix24 until you delete
it there. `b24 session list` lists the profiles on this computer.

One webhook belongs to one profile. `session start` refuses a webhook that another profile here already uses (the
same portal and the same employee), names that profile, and says how to sign it in again or remove it. Two profiles
on one portal are fine when each has its own employee's webhook.

When the portal answers that the webhook may not read who made it, the webhook lacks the "Users (basic)" right
(`user_basic`, «Пользователи (базовый)» on a Russian portal). Open Developer resources → Integrations, edit the
webhook, tick that right and save, then run `session start` again with the address the webhook shows.

## With a local application

A webhook acts as the employee who made it. A local application acts as the employee who signs in, and its tokens
last only an hour, renewed by `b24`. A Bitrix24 administrator, or an employee allowed to, creates it once:

1. Developer resources → Common use cases → Other → Local application.
2. Choose **Server** mode. Set **Your handler path** to `https://wirecat.dev/webhooks/apps/b24-callback`. Leave
   **Initial installation path** and the menu item texts empty, and **Application completes the installation itself**
   off, so the portal installs it on save.
3. Under **Assign permissions**, tick the same scopes as for a webhook (the table in [Sign in](#sign-in)), and save.
4. Copy the **Application ID (client_id)** and the **Application key (client_secret)** Bitrix24 shows.

Then sign in with your portal's host and Application ID in place of the example ones:

```sh
b24 work session start --portal example.bitrix24.ru --client-id local.0123abcd.45678901
```

`b24` asks for the key without showing it, or reads it from stdin or `B24_BITRIX24_CLIENT_SECRET`, and opens the
portal's sign-in in the browser. After you allow the application, the page at `wirecat.dev/webhooks/apps/b24-callback`
passes the answer back to `b24` on this computer. If the browser cannot reach `b24`, for example over SSH, paste the
address the browser ended on into the terminal. `session status` then shows `kind: app`. Setting a webhook again with
`session start` forgets the application's sign-in, and the other way round. `session end` forgets the tokens on this
computer. Bitrix24 has no way to revoke them, so delete the application in the portal to stop them.

## Check that it works

```sh
b24 work session status --check   # the employee the sign-in acts as, and whether they are an admin
b24 work sync                     # copies your deals and leads
b24 work deals list status:open
```

The open deals you see are yours. To copy a colleague's deals too, see
[whose deals and leads](usage.md#whose-deals-and-leads).

## Remove a profile

```sh
b24 work account remove --keep-data --dry-run   # what it would remove and keep, changing nothing
b24 work account remove --keep-data             # forget the profile, its copy of the portal stays searchable
b24 work account remove --delete-data --yes     # also delete the portal's deals, leads, contacts and companies
```

`account remove` forgets the profile on this computer: its webhook address, its settings and its files. It asks first,
or takes `--yes`. The webhook itself stays in Bitrix24 until you delete it there. The store keeps one copy of a
portal, so `--delete-data` refuses while another profile here reads the same portal. Remove that one first, or use
`--keep-data`.

Next: [use it](usage.md).
