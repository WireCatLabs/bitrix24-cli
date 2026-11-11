# Install

Install `b24` once on each computer where you or an agent use it. You need Node.js 22.16 or a later 22.x, or 24 or
later; Node 23 is not supported.

```sh
npm install -g @wirecat/bitrix24-cli
b24 --version
```

Check the installation, then pick a profile name for your account, such as `work`:

```sh
b24 doctor
```

`doctor` needs no network and opens no keyring. It shows the version, where settings live, the profiles that
exist, and whether other users of the computer can read the settings. Next: [use it](usage.md).

## Sign in

The quick way is an incoming webhook: `b24 work session start` asks for its address. The steps are in
[sign in](usage.md#sign-in).

With a local application, `b24` acts with the rights of the employee who signs in, not of the one who made a
webhook. Create it once in the portal (Developer resources → Common use cases → Other → Local application), in
**Server** mode, with **Your handler path** `https://wirecat.dev/b24-callback`, an empty **Initial installation
path**, no menu item text, and the access permissions `crm`, `user_basic` and `department`. Then run
`b24 work session start --portal example.bitrix24.ru --client-id <Application ID>` and give it the Application key
when it asks. The steps are in [with a local application](usage.md#with-a-local-application).
