# When something goes wrong

A command stopped with an error, a sync did not bring your deals, or the agent says it may not change a deal. Most of
these take one step to fix, and the error message names that step.

Find what you see and do what it says. If the problem stays, write to us with the error code and the command you ran.

**On this page:**

1. [Check what is set up](#check-what-is-set-up)
2. [The tool or the profile](#the-tool-or-the-profile)
3. [The sign-in](#the-sign-in)
4. [The sync](#the-sync)
5. [Writes](#writes)
6. [Check that it works](#check-that-it-works)
7. [Ask for help](#ask-for-help)

## Check what is set up

```sh
b24 doctor                         # the version, the settings, the profiles, without the network or the keyring
b24 work session status --check    # the employee the sign-in acts as, and whether they are an admin
```

## The tool or the profile

| What you see | What to do |
| --- | --- |
| `b24` is not found | Open a new terminal, and check that npm's global folder is on `PATH`. |
| "name a profile" | Put the profile first, as in `b24 work config show`, or set `B24_PROFILE`. |
| The settings file does not read | `doctor` lists every problem in the file under `config.issues`. Run the `config unset` each one gives, or fix the file by hand. |
| `doctor` lists `files.problems` | Other users of the computer can read `config.json` or enter its folder. Run each `chmod` that `doctor` prints after "to make it private:". `doctor` never changes a file mode itself. |

## The sign-in

| What you see | What to do |
| --- | --- |
| "not signed in" | Run `session start` with your profile, such as `b24 work session start`, and paste the webhook address. |
| Bitrix24 refused this webhook or application sign-in | Someone deleted the webhook in Bitrix24, or an administrator edited a colleague's webhook, which gives it a new address. Or the local application was deleted or its key changed. Copy the address the webhook shows now, or make a new one, and run `session start` again. |
| "this webhook may not read who made it" at sign-in | Tick "Users (basic)" (`user_basic`) on the webhook, save, and run `session start` again with the address it shows. See [sign in](installation.md#sign-in). |
| "already uses this webhook" at sign-in | Another profile has it. Use that profile, or remove it with `b24 work account remove --keep-data`, with that profile's name in place of `work`, and sign in again. |
| No scope for a method, or `ERROR_METHOD_NOT_FOUND` | Add the scope (`crm`, `user_basic`, `department`, and `telephony` for `meetings sync`) to the webhook in Bitrix24: Developer resources → Integrations, edit the webhook. |

## The sync

| What you see | What to do |
| --- | --- |
| The sync copies someone else's deals, or not all of yours | A sync copies the deals and leads of the user who signed in, or of the users you list. Find ids with `b24 work users list`, then list theirs and your own: `b24 work config set crm.bitrix24:example.bitrix24.ru.unassigned 3327,4410`. See [whose deals and leads](usage.md#whose-deals-and-leads). |
| `crm.unassigned-dropped` in `issues` | Only a Bitrix24 administrator may copy any colleague's deals. Others may list only themselves and users who are not employees. Sign in with an administrator's webhook, or take that user out of the list. |
| Lists and `show` find no deals offline | The sign-in names no portal user. Run `b24 work session start` again. |
| `crm.unlisted-held` in `issues` | The portal listed far fewer records than your copy has, so the sync marked none deleted. A webhook that lost a right lists none, so check it with `session status --check` first. If the records are really gone, `b24 work sync --allow-deletions 40` marks up to 40 of them deleted. |
| `rate_limited` | The portal allows about 2 requests a second for all its apps together. `b24` waits out a short wait by itself and tells you about a long one. |

## Writes

| What you see | What to do |
| --- | --- |
| A write is refused | The profile's permissions or `B24_READ_ONLY` stop it. See [permissions](permissions.md). |
| `outcome_unknown` on a write | The portal may have made the change. Look at the record first (`sync`, then `show`), and write it again only if it is not there: otherwise Bitrix24 makes it a second time. See [write](usage.md#write). |

## Check that it works

Run the command that failed again. For a sign-in or sync problem, `b24 work session status --check` names the
employee, and `b24 work sync` ends with no `issues` you did not expect.

## Ask for help

Ask on [Discord](https://discord.gg/DebENqbRrJ), or open an [issue](https://github.com/WireCatLabs/bitrix24-cli/issues)
with the error code, the profile name and the command. Never paste a token, a password or private content into a
support request.
