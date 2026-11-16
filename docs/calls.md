# Calls

Read this page if your company's phones run through Bitrix24 telephony. It shows how to copy the portal's calls into
the local WireCat store, turn their recordings into text on this computer, and find a client's calls beside their
deals, messages and mail. By the end, `memo context` shows a client's calls in their history.

Words this page uses:

- **Call history**: the list of calls the portal keeps under Telephony → Call history. b24 reads it with the
  `voximplant.statistic.get` method.
- **Profile**: the name of one portal's sign-in, such as `work`. It is the first word of a command.

## Before the first sync

The webhook needs the `telephony` scope, besides `crm`, `user_basic` and `department`. Edit the webhook in Developer
resources → Integrations, tick Telephony, and save. A local application needs the same scope on its card.
The employee who made the webhook also needs the portal's right to view call statistics.

Copying calls only reads. No command places a call or changes a line. Only `calls export`, off until you turn it
on, writes to the portal: see [Write other phone systems' calls into Bitrix24](#write-other-phone-systems-calls-into-bitrix24).

## Copy the calls

`b24 work sync` copies the calls after the CRM, and says how many under its answer. If they cannot be copied, for
example because the webhook has no telephony scope, it says why in a note and the CRM sync still succeeds. To leave
the calls out of `sync`: `b24 work config set sync_calls false`. `meetings sync` copies only the calls:

```sh
b24 work meetings sync                                   # calls since the last sync; the first reads 30 days
b24 work meetings sync --since-time 2026-11-01T00:00:00Z # calls from a date on
b24 work meetings list                                   # newest first, from the store, offline too
b24 work meetings show 12                                # one call: who, when, how it ended
```

Each call is a meeting of kind call. It keeps its direction (incoming or outgoing), the client's number, the
employee, how long they talked, and how it ended: answered, not answered, busy or failed. It also keeps the CRM
contact, company or lead the portal linked the call to, and the call's CRM activity, as numbers to look up.

A first sync on a busy line reads many pages before it saves anything. If it stops at its time limit, give it a
shorter window or more time: `meetings sync --since-time 7d`, or `--timeout 5m`.

Each sync reads again the three hours before the last one, so a call that was still going on is found the next time.
A timer that runs `sync` keeps the calls up to date too.

### Whose calls

The same rule as for deals: a copy is never the whole portal. `meetings sync` copies the calls of the signed-in user,
or of the users you chose in `crm.bitrix24:<portal>.unassigned` (see [Whose deals and leads](usage.md#whose-deals-and-leads)).
A profile whose `scope` is `all` refuses to sync calls until you set it to `mine`.

## The client and the employee

The employee on a call is the same person as the portal's user in your copy: their calls show on that person.

The client is found by their number. A number the portal writes with `+` is read as it is. A number without `+`, such
as `79000000001`, needs its country:

```sh
b24 work config set phone_region ru        # or several: ru,kz
b24 work meetings sync --rescan            # read the calls again with it
```

Without `phone_region`, or when two of its countries read a number differently, the number is kept as written and
joins nobody. With it, a call from a mobile number joins the contact, the WhatsApp or Telegram account, or the
calls from another phone system that have the same number. A landline joins nobody on its own: an office line is
everyone's who works there.

```sh
memo context person:12        # the client's history: messages, mail and calls, newest first
```

## Recordings

Recordings stay on the portal unless you ask for them:

```sh
b24 work config set download_recordings true
b24 work meetings sync         # downloads the recording of each new call
```

Each recording is saved in b24's state folder, under `recordings/<profile>/`, readable only by you. `meetings show`
gives its path as `local_path`, and WireCat Desktop plays it. A recording can be a few megabytes per call: check the
space before you turn this on for a busy line.

The link the portal gives for a recording holds an access token. b24 follows it only on the portal's own address,
right after reading it, and never saves or prints it.

## Turn calls into text

The text is made on this computer with a local speech model: no recording leaves it.

```sh
b24 models download gigaam-v3        # once, a few hundred megabytes
b24 work meetings transcribe         # calls of five seconds or more with no text yet, newest first
b24 work meetings transcript 12      # one call's text
```

A recording kept by `download_recordings` is read from this computer; any other is downloaded for the
transcription, and kept only when `download_recordings` is on. Bitrix24 does not say which side of a stereo
recording is the employee, so the text names the channels "Channel 1" and "Channel 2". A call of more than an hour
is skipped.

## Permissions

Each command has its own key: `meetings.sync`, `meetings.transcribe`, `meetings.list` and so on. To stop agents from
copying calls:

```sh
b24 work config set permissions.meetings.sync deny
```

`api call voximplant.statistic.get` stays denied: its answer holds the recording links with their tokens. See
[Permissions](permissions.md).

## Write other phone systems' calls into Bitrix24

Calls from another phone system, such as pbx, can land on the client's contact in Bitrix24, so the CRM shows them
beside the portal's own calls. It is off until you turn it on, and it writes each call once.

Bitrix24 lets only an application write a call, not a webhook. Sign the profile in as a local application first:
`b24 work session start --portal <portal> --client-id <id>`. Then turn it on and allow its two methods:

```sh
b24 work config set export_calls true
b24 work config set permissions.api.telephony.externalcall.register allow
b24 work config set permissions.api.telephony.externalcall.finish allow
b24 work calls export --since-time 7d --dry-run   # each call, the fields it would send, where it would land
b24 work calls export --since-time 7d
```

A call lands only when its client is linked to exactly one contact of this portal, and its employee to one portal
user (`memo people link` links them). Any other call is listed as skipped, with the reason. The portal's own calls
are skipped: they are in Bitrix24 already.

Each call is registered and finished with `telephony.externalCall.register` and `telephony.externalCall.finish`, with
no new CRM record, no call card and no chat message. b24 keeps the calls it wrote in its state folder, under
`calls-export/<portal>.json`, so a second run never writes a call again. Bitrix24 itself only notices a repeat within 30
minutes.

To stop it: `b24 work config set export_calls false`. Nothing written to the portal is taken back.
