import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { isCliError } from "@wirecat/cli-base"
import { outputFor, readOnlyLockOf } from "@wirecat/cli-core/cli"
import type { CrmRun } from "@wirecat/cli-core/crm/cli"
import { addCrmCommands } from "@wirecat/cli-core/crm/cli"
import type { AccountKey, MessageStore } from "@wirecat/cli-core/store"
import { Command } from "commander"
import { crmApiKeys } from "../api-keys.js"
import { parseWebhook } from "../bitrix/webhook.js"
import { permissions } from "../config.js"
import { BITRIX_WRITES } from "../crm/capabilities.js"
import { IDENTITY } from "../identity.js"
import { contextOf, transportFor, webhookOf } from "../portal.js"

/**
 * A read finds the profile's account from the rows an earlier sync saved, so it never reads the sign-in; the first
 * read of a profile, a store that is missing or needs a migration, and every sync and write open it for writing and
 * save those rows, as gcal does. Under `B24_READ_ONLY` a read with no store or no saved profile reads an empty store
 * in a temporary folder instead, so the lock creates no `wirecat.db`; a sync still writes, as cli-core lets a fetch
 * through.
 */
const storeFor = async (
  env: NodeJS.ProcessEnv,
  profile: string,
  readOnly: boolean,
  accountOf: () => AccountKey,
): Promise<{ store: MessageStore; account: AccountKey }> => {
  const { openB24Store, PROVIDER } = await import("../store.js")
  const locked = readOnly && readOnlyLockOf(IDENTITY, env) !== undefined
  if (readOnly) {
    const store = await openB24Store(env, { readOnly: true }).catch((error: unknown) => {
      if (locked && !(isCliError(error) && error.code === "not_found")) throw error
      return undefined
    })
    if (store) {
      const saved = await store.accounts
        .profiles()
        .then((all) => all[IDENTITY.command]?.[profile])
        .catch(() => undefined)
      if (saved) return { store, account: { provider: saved.provider, account: saved.account } }
      await store.close()
    }
  }
  if (locked) {
    const folder = mkdtempSync(join(tmpdir(), "b24-empty-"))
    const removing = () => rmSync(folder, { recursive: true, force: true })
    try {
      const empty = await withProfile({ ...env, MESSAGING_STORE: join(folder, "wirecat.db") }, profile, {
        provider: PROVIDER.name,
        account: profile,
      })
      const close = empty.store.close.bind(empty.store)
      empty.store.close = () => close().finally(removing)
      return empty
    } catch (error) {
      removing()
      throw error
    }
  }
  return withProfile(env, profile, accountOf())
}

const withProfile = async (env: NodeJS.ProcessEnv, profile: string, account: AccountKey) => {
  const { openB24Store } = await import("../store.js")
  const store = await openB24Store(env)
  try {
    // A CRM is the owner's work; an account already stored keeps the scope the owner gave it.
    await store.accounts.saveAccount(account, { name: null, scope: "work" })
    await store.accounts.saveProfile(IDENTITY.command, profile, account)
    return { store, account }
  } catch (error) {
    await store.close()
    throw error
  }
}

/** The selected profile's portal for one command; cli-core closes the store before the answer prints. */
const openProfile = async (command: Command, { readOnly }: { readOnly: boolean }): Promise<CrmRun> => {
  const { env, profile, tokens } = contextOf(command)
  const [{ PROVIDER }, { bitrixCrmSource }, { bitrixCrmWriter }, { ownMemoryAt, ownMemoryFile }] = await Promise.all([
    import("../store.js"),
    import("../crm/source.js"),
    import("../crm/writer.js"),
    import("../crm/own-memory.js"),
  ])
  const accountOf = (): AccountKey => {
    return { provider: PROVIDER.name, account: new URL(parseWebhook(tokens.need(profile)).origin).host }
  }
  const { store, account } = await storeFor(env, profile, readOnly, accountOf)
  let transport: ReturnType<typeof transportFor> | undefined
  const portal = () => (transport ??= transportFor(command, webhookOf(command)))
  let source: ReturnType<typeof bitrixCrmSource> | undefined
  const asked = async () => {
    const { crmSettingKey } = await import("@wirecat/cli-core/store")
    const scope = await store.crm.scope(account)
    return {
      mode: scope.mode,
      also: scope.mode === "mine" ? scope.also : [],
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
      self: webhookOf(command).userId,
      warn: outputFor(command).renderer.warn,
      alsoChecks: crmApiKeys,
      // contextOf, not resolveSettings: it carries the levels `mcp serve --permission` tightened. The portal
      // limits its own rate; the guard is here for the levels and the journal, not a send limit.
      settings: () => ({
        ...contextOf(command).settings,
        sendsPerHour: Number.MAX_SAFE_INTEGER,
        permissionDefaults: permissions.defaults,
      }),
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
