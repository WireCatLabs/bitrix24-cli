import { annotate, overrideSharedContract } from "@wirecat/cli-base/commands"
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

/**
 * cli-core's `schedule`, kept off MCP as gcal keeps it: a timer an agent installed would go on reading the portal
 * after the agent is gone. The read-only lock and `mcp.authority` already refuse installing one.
 */
export const scheduleCommand = (): Command =>
  overrideSharedContract(
    scheduleCommandFor({ app: IDENTITY, context: contextOf }),
    "b24 keeps schedule off MCP: a timer goes on reaching the portal after the agent that installed it",
    (command) => annotate(command, { mcp: false }),
  )
