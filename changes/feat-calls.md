### Added

- **Bitrix24 telephony calls in the store.** `meetings sync` copies the portal's call history: each call is a meeting
  of kind call with its direction, the client's number, the employee, the talk time and how it ended, for the
  signed-in user or the users chosen in `unassigned`, never the whole portal. The employee is the portal's user in
  the copy; the client joins the contact, messenger account or other phone system's calls with the same mobile
  number. `meetings list`, `show`, `transcript`, `export` and `people` read them, and `memo context` shows them in a
  person's history. The webhook needs the `telephony` scope. See [Calls](../docs/calls.md).
- **`meetings transcribe` and `models`** turn call recordings into text with a local speech model, on this computer.
- **`download_recordings`** keeps each call's recording in the state folder, for WireCat Desktop to play;
  **`phone_region`** reads the numbers the portal writes without `+`.
