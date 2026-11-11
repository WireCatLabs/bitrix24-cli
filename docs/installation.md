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
