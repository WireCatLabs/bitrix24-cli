import type { KeyringStore } from "@wirecat/cli-base"
import { ProfileTokenStore, recalledAccount } from "@wirecat/cli-core/cli"
import type { CrmAccountOptions } from "@wirecat/cli-core/crm/cli"
import { parseWebhook } from "../bitrix/webhook.js"
import { configuration } from "../config.js"
import { IDENTITY } from "../identity.js"
import { PROVIDER } from "../store.js"

/** What `session start` remembered: `<portal host>:<webhook user id>`, which outlives `session end`. */
const rememberedOf = (profile: string, env: NodeJS.ProcessEnv) => {
  const parts = /^(.+):(\d+)$/.exec(recalledAccount(IDENTITY, PROVIDER.name, profile, env)?.account ?? "")
  return parts?.[1] && parts[2] ? { account: parts[1], user: parts[2] } : undefined
}

/** The portal and user of a profile's saved webhook; one from `B24_TOKEN` is no profile's own. */
const savedOf = (profile: string, env: NodeJS.ProcessEnv, keyring: KeyringStore | undefined) => {
  const stored = new ProfileTokenStore({ app: IDENTITY, env, ...(keyring ? { keyring } : {}), warn: () => {} }).read(
    profile,
  )
  if (!stored || stored.source === "environment") return undefined
  const webhook = parseWebhook(stored.secret)
  return { account: new URL(webhook.origin).host, user: webhook.userId }
}

/** The store names a Bitrix24 account by its portal host, and one portal has a webhook user per employee. */
export const B24_ACCOUNT: CrmAccountOptions = {
  provider: PROVIDER.name,
  service: "Bitrix24",
  held: (profile, { env, keyring }) => {
    const remembered = rememberedOf(profile, env)
    try {
      const saved = savedOf(profile, env, keyring)
      if (saved) return { ...saved, signedIn: true }
    } catch (error) {
      // Nothing else tells which portal's copy --delete-data would delete.
      if (!remembered) throw error
    }
    return remembered && { ...remembered, signedIn: false }
  },
  signedOut: (profile) =>
    `the webhook address or application sign-in of ${profile} (the webhook or application itself stays in Bitrix24)`,
  resolveSettings: configuration.resolveSettings,
}
