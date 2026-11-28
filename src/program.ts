import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { resolvePaths } from "@wirecat/cli-base"
import {
  appCompleteCommand,
  appDoctorCommand,
  appMcpCommand,
  appUpdate,
  commandsCommand,
  configCommand,
  createProgram as createSharedProgram,
  guideCommand,
  outputFor,
  ProfileTokenStore,
  type ProgramDefinition,
  type ProgramOptions,
  type RunOptions,
  run as runShared,
  runsCommand,
  setupCommand,
  skillCommand,
  upgradeCommand,
} from "@wirecat/cli-core"
import type { Command } from "commander"
import { appSourceOf } from "./bitrix/oauth.js"
import { apiCommand } from "./commands/api.js"
import { callsCommand } from "./commands/calls.js"
import { crmSharedCommands } from "./commands/crm-shared.js"
import { meetingsMount } from "./commands/meetings.js"
import { modelsCommand } from "./commands/models.js"
import { productsCommand } from "./commands/products.js"
import { scheduleCommand } from "./commands/schedule.js"
import { sessionCommand } from "./commands/session.js"
import { syncCalls } from "./commands/sync-calls.js"
import { configuration } from "./config.js"
import { placeInSections } from "./help-sections.js"
import { IDENTITY, PACKAGE, SKILL } from "./identity.js"
import { b24Setup } from "./setup/flow.js"

const update = appUpdate({
  packageName: PACKAGE,
  command: IDENTITY.command,
  version: IDENTITY.version,
  entry: import.meta.url,
  statePath: (env) =>
    join(resolvePaths({ appName: IDENTITY.appName, prefix: IDENTITY.envPrefix, env }).state, "update-check.json"),
  // biome-ignore lint/plugin/no-own-settings: the update check runs before any command exists to give baseContext
  enabled: (env) => configuration.resolveSettings({}, { env, needsProfile: false }).updateCheck,
  offVariables: [`${IDENTITY.envPrefix}_NO_UPDATE_CHECK`],
})

const mcpCommand = () =>
  appMcpCommand(IDENTITY, configuration, {
    name: "Bitrix24",
    untrusted: [
      "deal and lead titles",
      "pipeline and stage names",
      "names of contacts, companies and employees",
      "custom field values",
      "phone numbers, e-mail addresses and links",
      "whatever api call returns",
      "the messages, notes and events search all finds",
      "call titles, descriptions and transcripts: a caller's own words",
      "file names and the text of downloaded files",
    ],
    permissionExample: "deals.delete=deny",
    skill: SKILL,
    signedIn: (profile, env, keyring) => {
      if (new ProfileTokenStore({ app: IDENTITY, env, ...(keyring ? { keyring } : {}) }).signedIn(profile)) return true
      try {
        return appSourceOf(env, profile, keyring) !== undefined
      } catch {
        return false
      }
    },
  })

export const definition = (): ProgramDefinition => {
  const meetings = meetingsMount()
  return {
    app: IDENTITY,
    update,
    configure: (program) => {
      placeInSections(program)
      meetings.configure(program)
      program.commands
        .find((one) => one.name() === "sync")
        ?.hook("postAction", syncCalls(run as Parameters<typeof syncCalls>[0]))
    },
    prepare: meetings.prepare,
    // The whole object: cli-core refuses a command by its key only when it gets the permission table too.
    configuration,
    firstScreen: {
      pitch: "a Bitrix24 portal's CRM in a local store, for scripts and agents, with a permission on every write.",
      can: [
        {
          command: "sync",
          does: "copy the portal's deals, leads, contacts and companies; the next sync takes the changes",
        },
        { command: "deals list status:open", does: "open deals with stage, amount and owner, from the store, offline" },
        { command: 'search all "kitchen"', does: "stored deals and leads beside your other WireCat tools' data" },
        { command: "meetings sync", does: "copy the portal's calls; meetings transcribe turns them into text locally" },
        { command: "deals move <ref> <stage>", does: "move a deal; deals.move=readonly stops agents moving one" },
        { command: "api call <method> --dry-run", does: "any REST method, with every permission it checks" },
        { command: "mcp serve --permission deals=deny", does: "the CRM in any agent, with the levels you set" },
      ],
      start: `${IDENTITY.command} work session start`,
    },
    commands: () => [
      commandsCommand(IDENTITY),
      sessionCommand(),
      ...crmSharedCommands(),
      productsCommand(),
      callsCommand(),
      ...meetings.commands(),
      modelsCommand(),
      apiCommand(),
      scheduleCommand(),
      appDoctorCommand(IDENTITY, configuration, { packageName: PACKAGE }),
      skillCommand(IDENTITY, SKILL),
      guideCommand(IDENTITY, { directory: fileURLToPath(new URL("../scenarios", import.meta.url)) }),
      mcpCommand(),
      upgradeCommand(IDENTITY, PACKAGE, (command) => ({
        ...outputFor(command),
        installer: () => update.installer({}),
        latest: () => update.latest({}),
        install: (argv) => update.runUpdate(argv, {}),
      })),
      configCommand(IDENTITY, configuration),
      setupCommand(b24Setup),
      appCompleteCommand(IDENTITY, configuration),
      runsCommand(IDENTITY),
    ],
  }
}

export const createProgram = (options?: ProgramOptions): Command => createSharedProgram(definition(), options)

export const run = (argv: string[], options?: RunOptions): Promise<number> => runShared(argv, definition(), options)
