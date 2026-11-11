import { readFileSync } from "node:fs"
import { join } from "node:path"
import { CliError, type KeyringStore, resolvePaths } from "@wirecat/cli-base"
import { annotate } from "@wirecat/cli-base/commands"
import {
  type AccountRemoval,
  accountRemoveCommand,
  LOCAL_READ,
  LOCAL_WRITE,
  ProfileTokenStore,
  profilesHere,
} from "@wirecat/cli-core/cli"
import type { AccountKey } from "@wirecat/cli-core/store"
import { Command } from "commander"
import { parseWebhook } from "../bitrix/webhook.js"
import { configuration } from "../config.js"
import { IDENTITY } from "../identity.js"
import { contextOf } from "../portal.js"
import { PROVIDER } from "../store.js"

const stateOf = (env: NodeJS.ProcessEnv) =>
  resolvePaths({ appName: IDENTITY.appName, prefix: IDENTITY.envPrefix, env }).state

/** What `session start` remembered: `<portal host>:<webhook user id>`, which outlives `session end`. */
const rememberedOf = (env: NodeJS.ProcessEnv, profile: string): { portal: string; userId: string } | undefined => {
  try {
    const { account } = JSON.parse(readFileSync(join(stateOf(env), "accounts", `${profile}.json`), "utf8"))
    const parts = typeof account === "string" ? /^(.+):(\d+)$/.exec(account) : null
    return parts?.[1] && parts[2] ? { portal: parts[1], userId: parts[2] } : undefined
  } catch {
    return undefined
  }
}

const tokensOf = (env: NodeJS.ProcessEnv, keyring: KeyringStore | undefined) =>
  new ProfileTokenStore({ app: IDENTITY, env, ...(keyring ? { keyring } : {}) })

/** The portal a profile's saved webhook reaches; one from `B24_TOKEN` is no profile's own. */
const savedPortalOf = (tokens: ProfileTokenStore, profile: string) => {
  try {
    const stored = tokens.read(profile)
    if (!stored || stored.source === "environment") return undefined
    const webhook = parseWebhook(stored.secret)
    return { portal: new URL(webhook.origin).host, userId: webhook.userId }
  } catch {
    return undefined
  }
}

/** The portal and webhook user of each profile here, from its saved webhook, else from what `session start` kept. */
export const portalsHere = (env: NodeJS.ProcessEnv, keyring: KeyringStore | undefined, { savedOnly = false } = {}) => {
  // biome-ignore lint/plugin/no-own-settings: this local read names no profile, so baseContext cannot give it
  const { configuredProfiles } = configuration.resolveSettings({}, { env, needsProfile: false })
  const tokens = tokensOf(env, keyring)
  return profilesHere(IDENTITY, configuredProfiles, env).flatMap((profile) => {
    const saved = savedPortalOf(tokens, profile)
    const found = saved ?? (savedOnly ? undefined : rememberedOf(env, profile))
    return found ? [{ profile, ...found }] : []
  })
}

const accountOf = (
  profile: string,
  env: NodeJS.ProcessEnv,
  keyring: KeyringStore | undefined,
): AccountKey | undefined => {
  const portal = (savedPortalOf(tokensOf(env, keyring), profile) ?? rememberedOf(env, profile))?.portal
  return portal ? { provider: PROVIDER.name, account: portal } : undefined
}

const removal: AccountRemoval = {
  // An incoming webhook cannot be revoked over REST; only the portal's own page deletes it.
  signOut: async (profile) => ({
    revoked: null,
    removed: [`the webhook address of ${profile} (the webhook itself stays in Bitrix24)`],
  }),
  account: (profile, { env, keyring }) => accountOf(profile, env, keyring),
  secrets: (profile, { env, keyring }) => [
    {
      credentials: {
        configDir: resolvePaths({ appName: IDENTITY.appName, prefix: IDENTITY.envPrefix, env }).config,
        service: IDENTITY.appName,
        envVar: `${IDENTITY.envPrefix}_TOKEN`,
        env,
        ...(keyring ? { keyring } : {}),
      },
      accounts: [`token:${profile}`],
    },
  ],
  stateFiles: (profile, { env }) => [join(stateOf(env), "crm", profile)],
}

/** The store keeps one account per portal, so deleting one profile's data deletes every profile's on that portal. */
const refuseSharedDelete = (command: Command) => {
  if (command.opts().deleteData !== true) return
  const { env, keyring, profile } = contextOf(command)
  const portals = portalsHere(env, keyring)
  const own = portals.find((one) => one.profile === profile)
  const sharing = own ? portals.filter((one) => one.profile !== profile && one.portal === own.portal) : []
  if (sharing.length === 0 || !own) return
  const names = sharing.map((one) => one.profile).join(", ")
  throw new CliError(
    "conflict",
    `${names} also read${sharing.length === 1 ? "s" : ""} ${own.portal}, and the store keeps one copy of a portal: ` +
      `--delete-data would delete their deals, leads, contacts and companies too. Use --keep-data, or remove ` +
      `${names} first`,
    { reason: "account-remove.portal-shared", profiles: sharing.map((one) => one.profile), portal: own.portal },
  )
}

export const accountCommand = (): Command =>
  annotate(new Command("account"), { effects: LOCAL_READ })
    .description("this profile on this computer")
    .addCommand(
      // An incoming webhook has no sign-out to call, so b24's removal never reaches the portal.
      annotate(accountRemoveCommand(IDENTITY, removal, { resolveSettings: configuration.resolveSettings }), {
        effects: LOCAL_WRITE,
      }).hook("preAction", (_, action) => refuseSharedDelete(action)),
    )
