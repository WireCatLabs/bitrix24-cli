import { outputFor } from "@wirecat/cli-core/cli"
import type { CrmRun } from "@wirecat/cli-core/crm/cli"
import { addCrmCommands, openCrmStore } from "@wirecat/cli-core/crm/cli"
import type { AccountKey } from "@wirecat/cli-core/store"
import { Command } from "commander"
import { crmApiKeys } from "../api-keys.js"
import { permissions } from "../config.js"
import { BITRIX_WRITES } from "../crm/capabilities.js"
import { IDENTITY } from "../identity.js"
import { contextOf, signInOf, storedSignIn, transportFor } from "../portal.js"

/** The selected profile's portal for one command; cli-core closes the store before the answer prints. */
const openProfile = async (command: Command, { readOnly }: { readOnly: boolean }): Promise<CrmRun> => {
  const { env, profile } = contextOf(command)
  const [{ openB24Store, PROVIDER }, { bitrixCrmSource }, { bitrixCrmWriter }, { ownMemoryAt, ownMemoryFile }] =
    await Promise.all([
      import("../store.js"),
      import("../crm/source.js"),
      import("../crm/writer.js"),
      import("../crm/own-memory.js"),
    ])
  const accountOf = (): AccountKey => {
    return { provider: PROVIDER.name, account: new URL(storedSignIn(command).origin).host }
  }
  const { store, account } = await openCrmStore({
    app: IDENTITY,
    env,
    profile,
    readOnly,
    provider: PROVIDER.name,
    open: openB24Store,
    account: accountOf,
  })
  let transport: ReturnType<typeof transportFor> | undefined
  const portal = () => (transport ??= transportFor(command, signInOf(command)))
  let source: ReturnType<typeof bitrixCrmSource> | undefined
  const asked = async () => {
    const { crmSettingKey } = await import("@wirecat/cli-core/store")
    const scope = await store.crm.scope(account)
    return {
      mode: scope.mode,
      setting: crmSettingKey(account, "scope"),
      chosen: crmSettingKey(account, "unassigned"),
    }
  }
  const crm = () => (source ??= bitrixCrmSource(portal, Date.now, ownMemoryAt(ownMemoryFile(env, profile)), asked))
  return {
    profile,
    account,
    store,
    env,
    locked: Boolean(env[`${IDENTITY.envPrefix}_PROFILE_LOCK`]),
    source: crm,
    writes: () => ({
      writer: bitrixCrmWriter(portal, crm()),
      app: IDENTITY,
      env,
      self: signInOf(command).userId,
      warn: outputFor(command).renderer.warn,
      alsoChecks: crmApiKeys,
      // contextOf, not resolveSettings: it carries the levels `mcp serve --permission` tightened.
      settings: () => ({ ...contextOf(command).settings, permissionDefaults: permissions.defaults }),
    }),
    close: () => store.close(),
  }
}

/** cli-core's shared CRM commands over the portal: `sync`, `store status`, `deals`, `leads`, `pipelines`, `stages`. */
export const crmSharedCommands = (): Command[] => {
  const holder = new Command(IDENTITY.command)
  addCrmCommands(holder, { app: IDENTITY, open: openProfile, writes: BITRIX_WRITES })
  return [...holder.commands]
}
