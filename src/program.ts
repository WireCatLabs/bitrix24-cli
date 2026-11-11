import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { resolvePaths } from "@wirecat/cli-base"
import {
  appDoctorCommand,
  appMcpCommand,
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
  skillCommand,
  upgradeCommand,
} from "@wirecat/cli-core/cli"
import { appUpdate } from "@wirecat/cli-core/update"
import type { Command } from "commander"
import { apiCommand } from "./commands/api.js"
import { crmCommands } from "./commands/crm.js"
import { crmSharedCommands } from "./commands/crm-shared.js"
import { addWrites } from "./commands/crm-writes.js"
import { scheduleCommand } from "./commands/schedule.js"
import { sessionCommand } from "./commands/session.js"
import { configuration } from "./config.js"
import { placeInSections } from "./help-sections.js"
import { IDENTITY, PACKAGE, SKILL } from "./identity.js"

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
    ],
    permissionExample: "deals.delete=deny",
    skill: SKILL,
    signedIn: (profile, env, keyring) =>
      new ProfileTokenStore({ app: IDENTITY, env, ...(keyring ? { keyring } : {}) }).signedIn(profile),
  })

export const definition = (): ProgramDefinition => ({
  app: IDENTITY,
  configure: placeInSections,
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
    ...crmCommands().map(addWrites),
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
    runsCommand(IDENTITY),
  ],
})

export const createProgram = (options?: ProgramOptions): Command => createSharedProgram(definition(), options)

export const run = (argv: string[], options?: RunOptions): Promise<number> => runShared(argv, definition(), options)
