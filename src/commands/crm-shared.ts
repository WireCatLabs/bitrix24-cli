import { isCliError } from "@wirecat/cli-base"
import type { CrmKind } from "@wirecat/cli-core"
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

/** The sign-in's own portal user, read offline from its entry; a profile with none reads none of the copy's deals. */
const ownUser = (command: Command): string | null => {
  try {
    return storedSignIn(command).userId || null
  } catch (error) {
    if (isCliError(error) && error.code === "authentication_error") return null
    throw error
  }
}

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
  // Only a sync copies: every other command reads `self` too (a non-admin's own clients), and must answer under `all`.
  const scope = command.name() === "sync" ? asked : undefined
  const copy = {
    fields: (kind: CrmKind) => store.crm.fields(account, kind),
    contacts: async (externalIds: readonly string[]) => {
      const { crmIdentityId } = await import("@wirecat/cli-core/store")
      const held = new Set<string>()
      for (const externalId of externalIds)
        if (await store.people.personOf({ provider: PROVIDER.name, id: crmIdentityId(account, externalId) }))
          held.add(externalId)
      return held
    },
    remove: async (externalId: string) => (await store.crm.removeContact(account, externalId)).contacts > 0,
  }
  const crm = () =>
    (source ??= bitrixCrmSource(portal, Date.now, ownMemoryAt(ownMemoryFile(env, profile)), scope, copy))
  return {
    profile,
    account,
    user: ownUser(command),
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

/**
 * cli-core's shared CRM commands over the portal: `sync`, `store`, `deals`, `leads`, `pipelines`, `stages`, `fields`,
 * `search all`, `people`, `organizations` and `users` read live, and `files` of deals, leads, contacts and companies.
 */
export const crmSharedCommands = (): Command[] => {
  const holder = new Command(IDENTITY.command)
  addCrmCommands(holder, {
    app: IDENTITY,
    open: openProfile,
    writes: BITRIX_WRITES,
    live: ["person", "organization", "user"],
    files: true,
  })
  return [...holder.commands]
}
