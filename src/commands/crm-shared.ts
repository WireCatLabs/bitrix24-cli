import { CliError } from "@wirecat/cli-base"
import { metaOf } from "@wirecat/cli-base/commands"
import { outputFor } from "@wirecat/cli-core/cli"
import type { CrmRun } from "@wirecat/cli-core/crm/cli"
import { addCrmCommands } from "@wirecat/cli-core/crm/cli"
import type { AccountKey, MessageStore } from "@wirecat/cli-core/store"
import { Command } from "commander"
import { crmApiKeys } from "../api-keys.js"
import { parseWebhook } from "../bitrix/webhook.js"
import { permissions } from "../config.js"
import { BITRIX_WRITES } from "../crm/capabilities.js"
import { IDENTITY } from "../identity.js"
import { contextOf, signInWords, transportFor, webhookOf } from "../portal.js"

/**
 * A read finds the profile's account from the rows an earlier sync saved, so it never reads the sign-in; the first
 * read of a profile, a store that is missing or needs a migration, and every sync and write open it for writing and
 * save those rows, as gcal does.
 */
const storeFor = async (
  env: NodeJS.ProcessEnv,
  profile: string,
  readOnly: boolean,
  accountOf: () => AccountKey,
): Promise<{ store: MessageStore; account: AccountKey }> => {
  const { openB24Store } = await import("../store.js")
  if (readOnly) {
    const store = await openB24Store(env, { readOnly: true }).catch(() => undefined)
    if (store) {
      const saved = await store.accounts
        .profiles()
        .then((all) => all[IDENTITY.command]?.[profile])
        .catch(() => undefined)
      if (saved) return { store, account: { provider: saved.provider, account: saved.account } }
      await store.close()
    }
  }
  const account = accountOf()
  const store = await openB24Store(env)
  try {
    await store.accounts.saveAccount(account, { name: null })
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
  const [{ PROVIDER }, { bitrixCrmSource }, { bitrixCrmWriter }] = await Promise.all([
    import("../store.js"),
    import("../crm/source.js"),
    import("../crm/writer.js"),
  ])
  const accountOf = (): AccountKey => {
    const stored = tokens.read(profile)
    if (!stored)
      throw new CliError("authentication_error", `profile ${profile} is not signed in — run ${signInWords(profile)}`, {
        reason: "webhook.missing",
      })
    return { provider: PROVIDER.name, account: new URL(parseWebhook(stored.secret).origin).host }
  }
  const { store, account } = await storeFor(env, profile, readOnly, accountOf)
  let transport: ReturnType<typeof transportFor> | undefined
  const portal = () => (transport ??= transportFor(command, webhookOf(command)))
  let source: ReturnType<typeof bitrixCrmSource> | undefined
  const crm = () => (source ??= bitrixCrmSource(portal))
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
      // contextOf, not resolveSettings: it carries the levels `mcp serve --permission` tightened (SEC-140). The portal
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

/**
 * cli-core 0.594's CRM commands open no run of their own (`crm/cli/index.ts:189`), so a sync or a write would not be
 * recorded, have no `--timeout`, and cut no write in flight (BUG-551). Each command that reaches the portal is run
 * inside core's run here, through commander's `createCommand` hook, until core does it.
 */
class InRun extends Command {
  override createCommand(name?: string): Command {
    return new InRun(name)
  }

  override action(fn: (this: Command, ...args: unknown[]) => void | Promise<void>): this {
    return super.action(function (this: Command, ...args: unknown[]) {
      const remote = metaOf(this).effects?.remote
      if (remote === undefined || remote === "none") return fn.apply(this, args)
      return contextOf(this).run(async () => {
        await fn.apply(this, args)
      })
    })
  }
}

/** cli-core's shared CRM commands over the portal: `sync`, `store status`, `deals`, `leads`, `pipelines`, `stages`. */
export const crmSharedCommands = (): Command[] => {
  const holder = new InRun(IDENTITY.command)
  addCrmCommands(holder, { app: IDENTITY, open: openProfile, writes: BITRIX_WRITES })
  return [...holder.commands]
}
