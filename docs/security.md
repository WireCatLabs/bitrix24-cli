# Security

Let an agent work in your CRM while the webhook's address and your clients' contact details stay out of its answers
and your logs. The webhook's address is the password to the portal, so anyone who reads it can do what its employee
can.

You know where `b24` keeps the sign-in, what reaches the portal and nothing else, and which limits hold for an agent
whatever it is told.

What WireCat tools share, such as the keyring, permissions, MCP and what never reaches a log, is on the
[shared security page](https://wirecat.dev/en/docs/security). This page keeps only what is particular to `b24`.

**On this page:**

1. [Where it keeps what, and whom it talks to](#where-it-keeps-what-and-whom-it-talks-to)
2. [The webhook's rights](#the-webhooks-rights)
3. [Files and links](#files-and-links)
4. [Clients' phones and e-mails](#clients-phones-and-e-mails)
5. [Writes and search](#writes-and-search)
6. [api call](#api-call)
7. [Timers](#timers)
8. [MCP in the browser](#mcp-in-the-browser)
9. [Run records](#run-records)
10. [File modes](#file-modes)

## Where it keeps what, and whom it talks to

`b24` keeps its settings in `config.json` and its state in the folders `b24 doctor` shows. It talks only to the
portal of the profile's webhook or local application, and to `oauth.bitrix.info` for an application's tokens, over
HTTPS, and never follows a redirect.

The webhook's address carries its secret in its path, so the whole address is the password. `b24` keeps it in the
system keyring (service `bitrix24-cli`, account `token:<profile>`), or in a private file with
`--credential-storage file`, and never writes it to the output, an error, a log or a run record: a run keeps the
method and `/rest/:user/:token/<method>`, never the address. An error keeps Bitrix24's error code and the names of
the fields it refused, never Bitrix24's description, which can quote what was typed.

A local application's sign-in is kept in the same place (account `oauth:bitrix24:<profile>`): the application's
code and key, the access token, which lasts an hour, and the refresh token, which lasts 180 days and changes at each
renewal. The key goes only to `oauth.bitrix.info`, as Bitrix24 asks, never to the portal. The token goes to the
portal in the body of each call, never in its address. None of them reaches the output, an error, a log or a run
record. The sign-in returns through the page `https://wirecat.dev/webhooks/apps/b24-callback`, which passes the one-time
code to `b24` on this computer in your browser. The code works for 30 seconds and only with the key. Bitrix24 has no
call that revokes a token: `session end` forgets the sign-in here, and deleting the application in the portal stops it.

## The webhook's rights

The webhook acts with the rights of the employee who made it. A webhook made by an admin lets an agent read and
change everything in the CRM. `session status --check` says whose rights it carries. Make the webhook with an
employee whose rights fit the work, and only the scopes it needs. `sync` uses `crm`, `user_basic` for employees'
e-mail addresses and `department` for the company structure. `meetings sync` reads the call history with
`telephony`, and a call's recording only with `download_recordings` on ([Calls](calls.md)). `user_basic` is enough: `sync` never changes an
employee, and the full `user` scope adds the right to invite and edit them. The sync stores each employee's name,
e-mail address, position and department head in the local store, where every WireCat tool can read them.

## Files and links

A file in a CRM record's custom field is kept as its file id only, in the copy and in every answer, never its
links: Bitrix24's download link carries an access token, and anyone holding it gets the file. A file with no id, and a
portal link with a token in it (`/rest/…?auth=`, a webhook's `/rest/<user>/<code>/`), show as `[link removed]`. A
site or a link field you typed yourself stays as it is. `api call` prints `[link removed]` in place of every download
link, every generated document's public link (`publicUrl`), and every portal link with a token. A copy synced
before this rule may still hold such links. `b24 work sync --rescan` rewrites every record the portal still lists
for the profile. A large copy may take several runs, and `b24 work store status` shows how far it got. A record
deleted in the portal, or outside the sync's scope, keeps what it held: `b24 work account remove --delete-data`
removes the account's whole copy, and the next sync after signing in again builds it anew. SQLite may keep old bytes
in the store file's free space until it reuses them.

`files download` asks the portal for a fresh link at each download, fetches it from the portal's own address only,
and keeps the link nowhere: not in the store, a log or an answer. A saved file is readable by your OS user alone
(file 600, folders 700), and its text is kept in the store, so `search all` finds it; a profile that is not an
administrator finds only the text of files on records assigned to it. An agent over MCP gets the file's path and its
text marked as untrusted, never its bytes. `disk` lets `api call disk.*` read any Drive file the webhook's employee
may open, so a `disk.*` call through `api call` asks first, and one that makes a public link is refused.

## Clients' phones and e-mails

Unless the webhook's user is a Bitrix24 administrator, the sync copies only their own clients: the contacts and
companies assigned to them or named on their deals and leads. Lists show phones and e-mails of those alone. `people
show` and `organizations show` give them for anyone else's, at most 100 a day for the user and their agents together.
That count is kept on this computer, so it stops an accident or an agent, not someone who means to take the base:
Bitrix24's own access rights do that.

## Writes and search

Every write is checked against the permissions and kept in the send journal. `B24_READ_ONLY=1` refuses every write.
Assigning a record to another employee is refused until you allow it. A stage change can still start the portal's own
robots, which may write to your clients: if your portal has such robots, set `permissions.deals.move` and
`permissions.leads.move` to `readonly` or `deny` before an agent gets the profile over MCP, where `ask` does not ask
([permissions](permissions.md#stage-changes-start-the-portals-robots)). Every write that sets a stage checks them. A won or lost stage, and `close`, check
`deals.close` or `leads.close` too, and `api call` with a `stageId` checks both. A deal or lead `--field` that names a
stage, a pipeline or an owner is refused. Deleting a deal or a lead asks first. `api.crm.deal.update: deny` also stops
`deals update`, `move` and `close`, and at `ask` they ask too.

A write that got no answer is not sent again: it is `outcome_unknown` with its `operation_id`. Check the portal, and
write it again only if it is not there: Bitrix24 would make a repeat a second time.

`search all` reads what the list keys allow: under `deals.list: deny` it leaves deals out, under `leads.list: deny`
leads, and names each kind it left out in `missing` and on stderr. With every kind it was asked for denied, it is
refused.

## api call

`api call` works from an allow list. It allows the CRM, catalog, user and department reads `b24` makes itself, and the deal, lead,
contact and company writes. Contact, company and lead reads are an administrator's alone, whatever the permissions say. Reads and writes both check the key of the command that reads or writes the same records:
`api call crm.deal.list` checks `deals.list`, and `crm.item.update` with `entityTypeId` 2 checks `deals.update`.
`department.get` checks `users.list`, and `crm.mycompany.*` checks `organizations.list`. A body
that names one field twice in any spelling (`assignedById` and `ASSIGNED_BY_ID`, `fields` and `FIELDS`), an
`entityTypeId` that is not a plain number, and a method with a suffix other than one `.json` are refused before
anything is sent. A delete asks. Every other method asks too, and is refused without a terminal unless you pass
`--yes`. Methods that message people, publish or send data out are refused until you allow them: `im`,
`imopenlines`, `imbot`, `imconnector`, `log.blogpost`, SMS, mail, telephony, workflows, CRM activities, tasks,
`user.add`, public file and document links (`disk.*.getExternalLink`, `enablePublicUrl` of generated documents,
`crm.invoice.getExternalLink`, `salescenter.payment.getPublicUrl`), `event.bind` and `batch`. Their reads are refused too, since they hold messages,
e-mails and tasks. `api show <method>` names a method's level. `api call` is
not offered over MCP.

## Timers

`schedule command` installs a timer (systemd, launchd or Task Scheduler) that runs `b24` on its own, with no
terminal. The timer runs `b24 schedule exec <file>`, and the schedule file in the state folder holds the words, the
profile, your `PATH` and the folders `b24` uses (`B24_CONFIG_DIR`, `B24_STATE_DIR`, `MESSAGING_STORE`), never the
webhook's address. Each run checks the permissions again. `B24_READ_ONLY` refuses
`schedule command`, `remove`, `run` and `exec`. Over MCP an agent may run `schedule run` and `schedule exec`, each
behind its own permission key (`schedule.run`, `schedule.exec`). Adding, pausing, resuming or removing a timer over MCP
is refused unless the profile sets `permissions.mcp.authority` to `allow`.

## MCP in the browser

`b24 work mcp serve --http` listens on `127.0.0.1` only, for browser apps that reach it through your own
tunnel. Each app logs in with a one-time code, and the server keeps a hash of each login it gives, in the state
folder, readable by you only. `b24 work mcp revoke` forgets every one of them.

## Run records

A run record keeps the command line as you typed it, so `b24 runs show` tells you what was run. A secret is still
stored as `[redacted]`: an option named like a token or password, a password in a link, a long opaque string. A
phone number is replaced by `[redacted]` inside the word you typed, message text included: one written with its "+" and
country code, or 11 to 15 digits in a row, so a long id of that length is hidden as well. To keep none of the words
you type, run `b24 work config set record_input false`.

A secret is also found by what it looks like, in a run record and in a kept error message: a token in a known
format (GitHub, OpenAI, Slack, AWS, Stripe, npm and the like), a `Bearer` credential, a random-looking string of 20 or
more characters, and a random-looking run of 20 or more lower-case hex characters, such as a hex key or a full commit
hash. The value after a secret name is hidden too, whether it follows `=`, `:` or a space: `password=`, `API_TOKEN=`,
`password hunter2`, `pin 1234`. Some secrets look like ordinary words and stay: a value of letters only after a
secret name and a space (`pin this message` stays), a hex key in upper case, a short commit hash or a UUID, a short
password typed without a secret name before it, and a secret inside a link or a file path unless it is in a known
format or after a secret name.

## File modes

`config.json` is saved readable by you only (`0600`), and its folder is created for you only (`0700`). A file or
folder made by an older version may be open to other users of the computer: `b24 doctor` lists each under
`files.problems` and prints the `chmod` that fixes it. Windows is not checked. Report a vulnerability as [SECURITY.md](https://github.com/WireCatLabs/bitrix24-cli/blob/main/SECURITY.md)
says.
