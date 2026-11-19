const SHARED_MCP =
  "cli-core's appMcpCommand; its app-mcp-command and mcp-server-command tests drive it, and src/mcp.test.ts and " +
  "src/permissions.test.ts run b24's own server"
const SHARED_SCHEDULE =
  "cli-core's scheduleCommandFor; its schedule tests drive every timer and option, and src/schedule.test.ts installs, " +
  "lists and removes b24's sync timer"
const SHARED_STORE =
  "cli-core's addStoreMaintenanceCommands, mounted by addCrmCommands; its store and src/crm/cli/store-file tests " +
  "drive them on a CRM program"
const SHARED_REPORTS = "cli-core's appDoctorCommand; its app-mcp-command test creates and shows a report"
const SHARED_COMPLETE = "cli-core's appCompleteCommand; its complete-command test drives every shell and word"
const SHARED_MEETINGS =
  "cli-core's addMeetingCommands; its meetings/cli tests drive every option, and src/calls/calls.test.ts runs sync, " +
  "list, show, transcript and people on b24's calls"
const SHARED_MODELS = "cli-core's modelCatalogueCommand; its tests download a model from a fake catalogue"
const SHARED_FILES =
  "cli-core's addCrmFileCommands; its crm/cli files tests drive every option, and src/crm/files.test.ts runs " +
  "files list for each kind of record and files download on b24's portal"
const LONG_RUNNING = `starts an HTTP server or a background process that runs until stopped; ${SHARED_MCP}`

export const UNTESTED: { command: string; option?: string; reason: string }[] = [
  {
    command: "setup",
    reason:
      "cli-core's setupCommand asks the flow's questions in a terminal; its setup-command tests drive that, and " +
      "src/setup/flow.test.ts runs this flow through setup apply and setup run apply",
  },
  { command: "files download", option: "--dir", reason: SHARED_FILES },
  { command: "files download", option: "--max-size", reason: SHARED_FILES },
  { command: "files sync", reason: SHARED_FILES },
  { command: "store info", reason: SHARED_STORE },
  { command: "store check", reason: SHARED_STORE },
  { command: "store migrate", reason: SHARED_STORE },
  { command: "store rebuild", reason: SHARED_STORE },
  { command: "store backup", reason: SHARED_STORE },
  { command: "store backup", option: "--encrypt", reason: SHARED_STORE },
  { command: "store restore", reason: SHARED_STORE },
  { command: "store decrypt", reason: SHARED_STORE },
  { command: "store decrypt", option: "--output", reason: SHARED_STORE },
  { command: "store repair", reason: SHARED_STORE },
  { command: "store repair", option: "--dry-run", reason: SHARED_STORE },
  { command: "store reset", reason: SHARED_STORE },
  { command: "store reset", option: "--no-backup", reason: SHARED_STORE },
  { command: "store reset", option: "--dry-run", reason: SHARED_STORE },
  { command: "store copies delete", reason: SHARED_STORE },
  { command: "store tables list", reason: SHARED_STORE },
  {
    command: "store apply",
    option: "--yes",
    reason: "cli-core 0.670.0 src/crm/cli/commands.test.ts removes the counted contacts only with --yes",
  },
  { command: "store recover", reason: SHARED_STORE },
  { command: "store recover run", reason: SHARED_STORE },
  { command: "doctor reports show", reason: SHARED_REPORTS },
  { command: "doctor reports create", reason: SHARED_REPORTS },
  { command: "doctor reports create", option: "--run", reason: SHARED_REPORTS },
  { command: "doctor reports create", option: "--output", reason: SHARED_REPORTS },
  { command: "complete", reason: SHARED_COMPLETE },
  ...[
    ...["--at", "--at-time", "--notify-on", "--deliver-to"].map((option) => ({ command: "schedule command", option })),
    { command: "schedule agent" },
    ...[
      "--model",
      "--max-cost",
      "--max-cost-per-day",
      "--every",
      "--at",
      "--at-time",
      "--notify-on",
      "--deliver-to",
    ].map((option) => ({ command: "schedule agent", option })),
    { command: "schedule run" },
    ...["--no-notify", "--deliver-to"].map((option) => ({ command: "schedule run", option })),
    { command: "schedule pause" },
    { command: "schedule resume" },
    { command: "schedule exec" },
    { command: "schedule agents list" },
  ].map((one) => ({ ...one, reason: SHARED_SCHEDULE })),
  ...["--port", "--public-url", "--profiles"].map((option) => ({
    command: "mcp serve",
    option,
    reason: LONG_RUNNING,
  })),
  ...[undefined, "--profiles"].map((option) => ({
    command: "mcp server status",
    ...(option ? { option } : {}),
    reason: LONG_RUNNING,
  })),
  { command: "mcp revoke", option: "--profiles", reason: SHARED_MCP },
  ...[undefined, "--permission", "--profiles"].map((option) => ({
    command: "mcp config",
    ...(option ? { option } : {}),
    reason: `prints the settings an agent pastes; ${SHARED_MCP}`,
  })),
  ...[undefined, "--allow-writes", "--permission"].map((option) => ({
    command: "mcp add",
    ...(option ? { option } : {}),
    reason: `writes Codex's or Claude Code's own MCP settings; ${SHARED_MCP}`,
  })),
  ...[undefined, "--permission"].map((option) => ({
    command: "mcp check",
    ...(option ? { option } : {}),
    reason: `starts the installed b24 as a child process, as the agent would; ${SHARED_MCP}`,
  })),
  {
    command: "",
    option: "--help-all",
    reason: "Commander answers before any command runs, so the trace never sees it; contracts/help.snap covers help",
  },
  {
    command: "",
    option: "--version",
    reason: "Commander answers before any command runs, so the trace never sees it; `pnpm version:check` checks it",
  },
  {
    command: "mcp server start",
    reason:
      "starts a detached `mcp serve --http` from the built entry; cli-core tests mcpServerCommand, and the background run was checked by hand against dist/",
  },
  {
    command: "mcp server start",
    option: "--port",
    reason:
      "starts a detached `mcp serve --http` from the built entry; cli-core tests mcpServerCommand, and the background run was checked by hand against dist/",
  },
  {
    command: "mcp server start",
    option: "--public-url",
    reason:
      "starts a detached `mcp serve --http` from the built entry; cli-core tests mcpServerCommand, and the background run was checked by hand against dist/",
  },
  {
    command: "mcp server stop",
    reason:
      "stops the detached server that `mcp server start` wrote a pid file for; cli-core tests mcpServerCommand, and no live scenario starts a server to stop",
  },
  { command: "meetings list", option: "--backend", reason: SHARED_MEETINGS },
  { command: "meetings list", option: "--limit", reason: SHARED_MEETINGS },
  { command: "meetings list", option: "--page", reason: SHARED_MEETINGS },
  { command: "meetings show", option: "--backend", reason: SHARED_MEETINGS },
  { command: "meetings transcript", option: "--history", reason: SHARED_MEETINGS },
  { command: "meetings export", reason: SHARED_MEETINGS },
  { command: "meetings export", option: "--format", reason: SHARED_MEETINGS },
  { command: "meetings export", option: "--transcript-id", reason: SHARED_MEETINGS },
  { command: "meetings export", option: "--output", reason: SHARED_MEETINGS },
  { command: "meetings people", option: "--limit", reason: SHARED_MEETINGS },
  { command: "meetings people", option: "--scan-limit", reason: SHARED_MEETINGS },
  { command: "meetings people", option: "--max-read-bytes", reason: SHARED_MEETINGS },
  { command: "meetings people", option: "--cursor", reason: SHARED_MEETINGS },
  { command: "meetings sync", option: "--lookback-days", reason: SHARED_MEETINGS },
  { command: "meetings repair", reason: SHARED_MEETINGS },
  { command: "meetings repair", option: "--yes", reason: SHARED_MEETINGS },
  {
    command: "meetings transcribe",
    option: "--model",
    reason: "picks the local speech model; src/calls/calls.test.ts runs transcribe on a fake engine that has none",
  },
  { command: "models download", reason: SHARED_MODELS },
  { command: "models download", option: "--offline", reason: SHARED_MODELS },
  { command: "models download", option: "--accept-terms", reason: SHARED_MODELS },
]
