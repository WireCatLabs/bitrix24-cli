# When something goes wrong

Start with the symptom, run the check, then retry the command. Keep the error code and the profile name for a
support request.

| Symptom | What to do |
| --- | --- |
| Not sure what is set up | Run `b24 doctor`. It reads no keyring and uses no network. |
| `b24` is not found | Open a new terminal, and check that npm's global folder is on `PATH`. |
| "name a profile" | Put the profile first, as in `b24 personal config show`, or set `B24_PROFILE`. |
| The settings file does not read | `doctor` lists every problem in the file under `config.issues`. Run the `config unset` each one gives, or fix the file by hand. |
| `doctor` lists `files.problems` | Other users of the computer can read `config.json` or enter its folder. Run each `chmod` that `doctor` prints after "to make it private:". `doctor` never changes a file mode itself. |
| "not signed in" | Run `session start` with your profile, such as `b24 work session start`, and paste the webhook address. |
| Bitrix24 refused this webhook | The webhook was deleted or edited in Bitrix24, which changes its address. Make a new one and run `session start` again. |
| no scope for a method, or `ERROR_METHOD_NOT_FOUND` | Add the scope (`crm`, `user`, `catalog`) to the webhook in Bitrix24. |
| `rate_limited` | The portal allows about 2 requests a second for all its apps together. `b24` waits a short wait out by itself; a long one, it tells you. |
| `outcome_unknown` on a write | The portal may have made the change. Look at the record first (`sync`, then `show`), and repeat it with the `--operation-id` the error names only if it is not there; see [write](usage.md#write). |
| A write is refused | The profile's permissions or `B24_READ_ONLY` stop it; see [settings](configuration.md#permissions). |

Never paste a token, a password or private content into a support request.
