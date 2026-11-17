# When something goes wrong

Get `b24` working again from the symptom you see. Most failures come from the sign-in, a missing scope on the
webhook or the profile's permissions, and each has a check that names the cause.

You find your symptom in the table, run the check it gives, and retry the command. If it still fails, you have the
error code and the profile name ready for a support request.

`b24 doctor` shows what is set up without the network or the keyring. `b24 work session status --check` asks the
portal which employee the webhook acts as.

**On this page:**

1. [First checks](#first-checks)
2. [Symptoms and what to do](#symptoms-and-what-to-do)
3. [Ask for help](#ask-for-help)

## First checks

```sh
b24 doctor                         # the version, the settings, the profiles, without the network
b24 work session status --check    # the employee the webhook acts as, and whether they are an admin
```

## Symptoms and what to do

| Symptom | What to do |
| --- | --- |
| Not sure what is set up | Run `b24 doctor`. It reads no keyring and uses no network. |
| `b24` is not found | Open a new terminal, and check that npm's global folder is on `PATH`. |
| "name a profile" | Put the profile first, as in `b24 work config show`, or set `B24_PROFILE`. |
| The settings file does not read | `doctor` lists every problem in the file under `config.issues`. Run the `config unset` each one gives, or fix the file by hand. |
| `doctor` lists `files.problems` | Other users of the computer can read `config.json` or enter its folder. Run each `chmod` that `doctor` prints after "to make it private:". `doctor` never changes a file mode itself. |
| The sync copies someone else's deals, or not all of yours | A sync copies the deals and leads of the user who signed in, or of the users you choose. Find ids with `users list`, then `config set crm.bitrix24:<portal>.unassigned <ids>`. See [whose deals and leads](usage.md#whose-deals-and-leads). |
| "not signed in" | Run `session start` with your profile, such as `b24 work session start`, and paste the webhook address. |
| Bitrix24 refused this webhook or application sign-in | The webhook was deleted in Bitrix24, or an administrator edited a colleague's webhook, which gives it a new address. Or the local application was deleted or its key changed. Copy the address the webhook shows now, or make a new one, and run `session start` again. |
| no scope for a method, or `ERROR_METHOD_NOT_FOUND` | Add the scope (`crm`, `user_basic`, `department`, and `telephony` for `meetings sync`) to the webhook in Bitrix24: Developer resources → Integrations, edit the webhook. |
| "this webhook may not read who made it" at sign-in | Tick "Users (basic)" (`user_basic`) on the webhook, save, and run `session start` again with the address it shows. See [sign in](usage.md#sign-in). |
| "already uses this webhook" at sign-in | Another profile has it. Use that profile, or remove it with `b24 <profile> account remove --keep-data` and sign in again. |
| `rate_limited` | The portal allows about 2 requests a second for all its apps together. `b24` waits out a short wait by itself and tells you about a long one. |
| `outcome_unknown` on a write | The portal may have made the change. Look at the record first (`sync`, then `show`), and write it again only if it is not there: Bitrix24 would make a repeat a second time. See [write](usage.md#write). |
| A write is refused | The profile's permissions or `B24_READ_ONLY` stop it. See [permissions](permissions.md). |

## Ask for help

Ask on [Discord](https://discord.gg/DebENqbRrJ), or open an [issue](https://github.com/WireCatLabs/bitrix24-cli/issues)
with the error code, the profile name and the command. Never paste a token, a password or private content into a
support request.
