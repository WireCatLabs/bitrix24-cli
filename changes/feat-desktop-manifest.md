### Added

- **WireCat Desktop reads b24's sign-in and MCP port from b24 itself.** The manifest (`b24 --wcat-describe`) now
  names the MCP server's port, 8764, and the two ways to sign in: an incoming webhook, and a local application signed
  in in the browser. The sign-in text Desktop shows is shorter and names the webhook the way Desktop does. Built on
  `@wirecat/cli-base` 1.2.0.
