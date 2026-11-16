# Install

Get `b24` running on your computer and connected to your Bitrix24 portal in a few minutes. Bitrix24 lets a program
in only through an inbound webhook or an application you create in the portal, and this page sets up one of them.

Once it is done, an agent on this computer reads your deals, leads and clients, and changes them when you ask.

npm installs `b24` as a command. `b24 work setup` shows where to make the webhook in Bitrix24 and which permissions
(scopes) to tick, checks the webhook's address against the portal and keeps it in the system keyring. `b24 doctor`
shows what is set up, without the network. You need Node.js 22.16 or a later 22.x, or 24 or later. Node 23 is not
supported.

**On this page:**

1. [Install the tool](#install-the-tool)
2. [Sign in](#sign-in)

## Install the tool

Install `b24` once on each computer where you or an agent use it.

```sh
npm install -g @wirecat/bitrix24-cli
b24 --version
b24 doctor
```

`doctor` needs no network and opens no keyring. It shows the version, where settings live, the profiles that
exist, and whether other users of the computer can read the settings. Then pick a profile name for your portal, such
as `work`.

## Sign in

The quick way is an inbound webhook. `b24 work setup` walks you through it step by step, the same steps WireCat
Desktop shows. `b24 work session start` just asks for the address. The steps and the scopes to tick are in
[sign in](usage.md#sign-in).

With a local application, `b24` acts with the rights of the employee who signs in, not of the one who made a
webhook. Create it once in the portal (Developer resources → Common use cases → Other → Local application), in
**Server** mode, with **Your handler path** `https://wirecat.dev/webhooks/apps/b24-callback`, an empty **Initial
installation path**, no menu item text, and the access permissions `crm`, `user_basic` and `department`, `task` for
tasks, `telephony` for calls, and `disk` and `documentgenerator` for files and documents. Then run `session start`
with your portal's host and the Application ID Bitrix24 shows. Here the host is `example.bitrix24.ru` and the ID
`local.0123abcd.45678901`, so put your own in their place:

```sh
b24 work session start --portal example.bitrix24.ru --client-id local.0123abcd.45678901
```

Give it the Application key when it asks. The steps are in [with a local application](usage.md#with-a-local-application).

Next: [use it](usage.md).
