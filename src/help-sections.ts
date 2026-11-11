import { metaOf } from "@wirecat/cli-base/commands"
import { type HelpSection, inSection } from "@wirecat/cli-core/cli"
import type { Command } from "commander"

const SECTIONS: Record<string, HelpSection> = {
  session: "setup",
  sync: "automate",
  pipelines: "read",
  stages: "read",
  fields: "read",
  products: "read",
  users: "read",
  api: "read",
}

const SPLIT = new Set(["deals", "leads", "people", "organizations"])

/** A CRM kind mixes reads and writes, so `commands` lists each of its subcommands under Read or Write. */
export const placeInSections = (program: Command) => {
  for (const command of program.commands) {
    const section = SECTIONS[command.name()]
    if (section) inSection(command, section)
    if (SPLIT.has(command.name()))
      for (const child of command.commands)
        inSection(child, metaOf(child).effects?.remote === "write" ? "write" : "read")
  }
}
