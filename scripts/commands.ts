import { resolve } from "node:path"
import { writeArtifacts } from "@wirecat/cli-base/codegen"
import { COMMANDS_PAGE_LABELS, commandsPage, describeOptions, describeProgram } from "@wirecat/cli-base/commands"
import { commandHelpMarkdown } from "@wirecat/cli-core/cli"
import { IDENTITY } from "../dist/identity.js"
import { createProgram } from "../dist/program.js"

const root = resolve(import.meta.dirname, "..")
const program = createProgram()
const page = commandsPage({
  cli: IDENTITY.command,
  commands: describeProgram(program),
  options: describeOptions(program),
  labels: COMMANDS_PAGE_LABELS.en,
  details: (command) => commandHelpMarkdown(program, command.path),
  text: {
    banner: "<!-- Generated from the command tree by pnpm generate. Do not edit. -->",
    title: "Commands",
    intro: `Look up any \`${IDENTITY.command}\` command: what it does, its arguments and options, what it answers and
how it can fail. Every entry is generated from the program itself, so it matches that release of \`${IDENTITY.command}\`.

You or your agent find the exact words for a task here, such as the query fields of \`deals list\` or the options
of \`deals move\`. For the same list as JSON, an agent runs \`${IDENTITY.command} commands --json\`.

**The first word is the profile**, a name you choose: \`${IDENTITY.command} work config show\`. \`${IDENTITY.envPrefix}_PROFILE\`
does the same for a whole shell session. No profile is assumed: a command that uses an account stops without one and
lists the profiles on this computer.

**On this page:**

1. [Options for every command](#options-for-every-command)
2. [The commands](#${IDENTITY.command}-commands), one section for each group, from \`commands\` to \`runs\`
3. [Exit codes](#exit-codes)`,
    globalHeading: "Options for every command",
    globalIntro: "",
    mutates: "**Changes something in the service.**",
    mutatesLocal: "**Changes something on this computer only.**",
    exitHeading: "Exit codes",
    exitIntro: "Branch on the code, not on the text: the text can change, the code does not.",
    outro: "",
  },
})
const check = process.argv.includes("--check")
const stale = writeArtifacts([{ path: "docs/commands.md", content: page.replace(/\n{3,}/g, "\n\n") }], { root, check })
if (check && stale.length) {
  process.stderr.write("docs/commands.md is stale; run pnpm generate\n")
  process.exitCode = 1
}
