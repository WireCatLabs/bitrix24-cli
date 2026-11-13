import { baseContext, scheduleCommandFor } from "@wirecat/cli-core/cli"
import type { Command } from "commander"
import { configuration } from "../config.js"
import { IDENTITY } from "../identity.js"

const contextOf = (command: Command, resolving?: { needsProfile?: boolean }) => {
  const base = baseContext(command, (flags, options) =>
    configuration.resolveSettings(flags, { ...options, ...resolving }),
  )
  return { ...base, profile: base.settings.profile }
}

export const scheduleCommand = (): Command => scheduleCommandFor({ app: IDENTITY, context: contextOf })
