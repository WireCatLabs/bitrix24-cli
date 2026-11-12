# When something goes wrong

Start with the symptom, run the check, then retry the command. Keep the error code and the profile name for a
support request.

| Symptom | What to do |
| --- | --- |
| Not sure what is set up | Run `b24 doctor`. It reads no keyring and uses no network. |
| `b24` is not found | Open a new terminal, and check that npm's global folder is on `PATH`. |
| "name a profile" | Put the profile first, as in `b24 work config show`, or set `B24_PROFILE`. |
| The settings file does not read | `doctor` lists every problem in the file under `config.issues`. Run the `config unset` each one gives, or fix the file by hand. |
| `doctor` lists `files.problems` | Other users of the computer can read `config.json` or enter its folder. Run each `chmod` that `doctor` prints after "to make it private:". `doctor` never changes a file mode itself. |
| "no CRM user is chosen" | A sync copies the deals and leads of the users you choose. Find ids with `users list`, then `config set crm.bitrix24:<portal>.unassigned <ids>`; see [whose deals and leads](usage.md#whose-deals-and-leads). |
| "not signed in" | Run `session start` with your profile, such as `b24 work session start`, and paste the webhook address. |
| Bitrix24 refused this webhook or application sign-in | The webhook was deleted in Bitrix24, or an administrator edited a colleague's webhook, which gives it a new address; or the local application was deleted or its key changed. Copy the address the webhook shows now, or make a new one, and run `session start` again. |
| no scope for a method, or `ERROR_METHOD_NOT_FOUND` | Add the scope (`crm`, `user_basic`, `department`) to the webhook in Bitrix24: Developer resources → Integrations, edit the webhook. |
| "this webhook may not read who made it" at sign-in | Tick "Users (basic)" (`user_basic`) on the webhook, save, and run `session start` again with the address it shows. See [sign in](usage.md#sign-in). |
| "already uses this webhook" at sign-in | Another profile has it. Use that profile, or remove it with `b24 <profile> account remove --keep-data` and sign in again. |
| `rate_limited` | The portal allows about 2 requests a second for all its apps together. `b24` waits a short wait out by itself; a long one, it tells you. |
| `outcome_unknown` on a write | The portal may have made the change. Look at the record first (`sync`, then `show`), and write it again only if it is not there: Bitrix24 would make a repeat a second time. See [write](usage.md#write). |
| A write is refused | The profile's permissions or `B24_READ_ONLY` stop it; see [permissions](permissions.md). |

Never paste a token, a password or private content into a support request.
