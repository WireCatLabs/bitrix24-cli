import { join } from "node:path"
import { type KeyringStore, resolvePaths } from "@wirecat/cli-base"
import {
  appDoctorCommand,
  appMcpCommand,
  commandsCommand,
  configCommand,
  createProgram as createSharedProgram,
  environmentOf,
  outputFor,
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
import { fieldsCommand } from "./commands/fields.js"
import { sessionCommand } from "./commands/session.js"
import { configuration } from "./config.js"
import { IDENTITY, PACKAGE, SKILL } from "./identity.js"
import { tokens } from "./token.js"

const update = appUpdate({
  packageName: PACKAGE,
  command: IDENTITY.command,
  version: IDENTITY.version,
  entry: import.meta.url,
  statePath: (env) =>
    join(resolvePaths({ appName: IDENTITY.appName, prefix: IDENTITY.envPrefix, env }).state, "update-check.json"),
  enabled: (env) => configuration.resolveSettings({}, { env, needsProfile: false }).updateCheck,
  offVariables: [`${IDENTITY.envPrefix}_NO_UPDATE_CHECK`],
})

const mcpCommand = () => {
  // cli-core asks `signedIn` with no keyring; the run's own one, a test's `memoryKeyring()`, is taken here, as gcal does.
  let keyring: KeyringStore | undefined
  const mcp = appMcpCommand(IDENTITY, configuration, {
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
    signedIn: (profile, env) => {
      try {
        return tokens(env, keyring).read(profile) !== undefined
      } catch {
        // A keyring that cannot be read fails the server's tools as well.
        return false
      }
    },
  })
  return mcp.hook("preAction", (_mcp, action) => {
    keyring = environmentOf(action).keyring
  })
}

export const definition = (): ProgramDefinition => ({
  app: IDENTITY,
  // The whole object: cli-core refuses a command by its key only when it gets the permission table too.
  configuration,
  commands: () => [
    commandsCommand(IDENTITY),
    sessionCommand(),
    ...crmSharedCommands(),
    ...crmCommands().map(addWrites),
    fieldsCommand(),
    apiCommand(),
    appDoctorCommand(IDENTITY, configuration, { packageName: PACKAGE }),
    skillCommand(IDENTITY, SKILL),
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
