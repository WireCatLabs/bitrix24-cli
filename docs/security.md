# Security

What WireCat CLIs share — the keyring, permissions, MCP and what never reaches a log — is on the
[shared security page](https://wirecat.dev/en/docs/security). This page keeps only what is particular to `b24`.

`b24` keeps its settings in `config.json` and its state in the folders `b24 doctor` shows. It talks only to the
portal of the profile's webhook, over HTTPS, and never follows a redirect.

The webhook's address carries its secret in its path, so the whole address is the password. `b24` keeps it in the
system keyring (service `bitrix24-cli`, account `token:<profile>`), or in a private file with
`--credential-storage file`, and never writes it to the output, an error, a log or a run record: a run keeps the
method and `/rest/:user/:token/<method>`, never the address. An error keeps Bitrix24's error code and the names of
the fields it refused, never Bitrix24's description, which can quote what was typed.

The webhook acts with the rights of the employee who made it. A webhook made by an admin lets an agent read and
change everything in the CRM. `session status --check` says whose rights it carries; make the webhook with an
employee whose rights fit the work, and only the scopes it needs.

Every write is checked against the permissions and kept in the send journal. `B24_READ_ONLY=1` refuses every write.
Assigning a record to another employee is refused until you allow it. A stage change can still start the portal's own
robots, which may write to your clients: set `permissions.deals.move` and `permissions.leads.move` to `ask` or `deny`
if your portal has such robots. Every write that sets a stage checks them; a won or lost stage, and `close`, check
`deals.close` or `leads.close` too, and `api call` with a `stageId` checks both. A deal or lead `--field` that names a
stage, a pipeline or an owner is refused. Deleting a deal or a lead asks first. `api.crm.deal.update: deny` also stops
`deals update`, `move` and `close`, and at `ask` they ask too.

`api call` works from an allow list. It allows the CRM, catalog and user reads `b24` makes itself, and the deal, lead,
contact and company writes. Reads and writes both check the key of the command that reads or writes the same records:
`api call crm.deal.list` checks `deals.list`, and `crm.item.update` with `entityTypeId` 2 checks `deals.update`. A body
that names one field twice in any spelling (`assignedById` and `ASSIGNED_BY_ID`, `fields` and `FIELDS`), an
`entityTypeId` that is not a plain number, and a method with a suffix other than one `.json` are refused before
anything is sent. A delete asks. Every other method asks too, and is refused without a terminal unless you pass
`--yes`. Methods that message people, publish or send data out are refused until you allow them: `im`,
`imopenlines`, `imbot`, `imconnector`, `log.blogpost`, SMS, mail, telephony, workflows, CRM activities, tasks,
`user.add`, public file links, `event.bind` and `batch`. Their reads are refused too, since they hold messages,
e-mails and tasks. `api show <method>` names a method's level. `api call` is
not offered over MCP.

A write that got no answer is not sent again: it is `outcome_unknown` with its `operation_id`. Check the portal, and
repeat it with `--operation-id` only if it is not there.

`b24 personal mcp serve --http` listens on `127.0.0.1` only, for browser apps that reach it through your own
tunnel. Each app logs in with a one-time code, and the server keeps a hash of each login it gives, in the state
folder, readable by you only. `b24 personal mcp revoke` forgets every one of them.

A run record keeps the command line as you typed it, so `b24 runs show` tells you what was run. A secret is still
stored as `[redacted]`: an option named like a token or password, a password in a link, a long opaque string. A
phone number is replaced by `[redacted]` inside the word you typed, message text included: one written with its "+" and
country code, or 11 to 15 digits in a row, so a long id of that length is hidden as well. To keep none of the words
you type, run `b24 personal config set record_input false`.

A secret is also found by what it looks like, in a run record and in a kept error message: a token in a known
format (GitHub, OpenAI, Slack, AWS, Stripe, npm and the like), a `Bearer` credential, a random-looking string of 20 or
more characters, and a random-looking run of 20 or more lower-case hex characters, such as a hex key or a full commit
hash. The value after a secret name is hidden too, whether it follows `=`, `:` or a space: `password=`, `API_TOKEN=`,
`password hunter2`, `pin 1234`. Some secrets look like ordinary words and stay: a value of letters only after a
secret name and a space (`pin this message` stays), a hex key in upper case, a short commit hash or a UUID, a short
password typed without a secret name before it, and a secret inside a link or a file path unless it is in a known
format or after a secret name.

`config.json` is saved readable by you only (`0600`), and its folder is created for you only (`0700`). A file or
folder made by an older version may be open to other users of the computer: `b24 doctor` lists each under
`files.problems` and prints the `chmod` that fixes it. Windows is not checked. Report a vulnerability as [SECURITY.md](https://github.com/WireCatLabs/bitrix24-cli/blob/main/SECURITY.md)
says.
