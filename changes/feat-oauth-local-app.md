### Added

- **Sign-in through a local application.** `b24 <profile> session start --portal <host> --client-id <id>` signs in
  through a local application you create in the portal, in the browser, and acts with the rights of the employee who
  signs in. The application key is asked without showing it, or read from stdin or `B24_BITRIX24_CLIENT_SECRET`. The
  sign-in returns through `https://wirecat.dev/b24-callback`, or the address you paste. Tokens are renewed by
  themselves. `session status` and `session list` show the kind of sign-in, and `session end` forgets either. The
  incoming webhook stays the quick way; see [sign in](../docs/usage.md#with-a-local-application).
