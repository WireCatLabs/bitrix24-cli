import { metaOf } from "@wirecat/cli-base/commands"
import { type HelpSection, inSection } from "@wirecat/cli-core/cli"
import type { Command } from "commander"

const SECTIONS: Record<string, HelpSection> = {
  session: "setup",
  sync: "automate",
  changes: "read",
  pipelines: "read",
  stages: "read",
  fields: "read",
  products: "read",
  users: "read",
  api: "read",
  meetings: "read",
  files: "read",
  events: "read",
  models: "setup",
  calls: "write",
}

const SPLIT = new Set(["deals", "leads", "people", "organizations"])

/** A CRM kind mixes reads and writes, so `commands` lists each of its subcommands under Read or Write. */
export const placeInSections = (program: Command) => {
  for (const command of program.commands) {
    const section = SECTIONS[command.name()]
    if (section) inSection(command, section)
    // The calls' and the files' syncs sit beside the CRM's: all are what a timer runs.
    if (command.name() === "meetings" || command.name() === "files")
      for (const child of command.commands) if (child.name() === "sync") inSection(child, "automate")
    if (SPLIT.has(command.name()))
      for (const child of command.commands)
        inSection(child, metaOf(child).effects?.remote === "write" ? "write" : "read")
  }
}
