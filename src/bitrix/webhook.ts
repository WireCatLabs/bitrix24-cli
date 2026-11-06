import { CliError } from "@wirecat/cli-base"

/** An incoming webhook: the portal, the employee it acts as, and the secret that is the whole sign-in. */
export interface Webhook {
  origin: string
  userId: string
  secret: string
}

const PATH = /^\/rest\/(?:api\/)?(\d+)\/([A-Za-z0-9_-]+)(?:\/.*)?$/

/**
 * Takes the address as Bitrix24 shows it, `https://<portal>/rest/<user>/<secret>/`, with or without a method or the
 * REST 3.0 `api/` segment pasted after it. The text is never quoted back: the secret is part of it.
 */
export const parseWebhook = (raw: string): Webhook => {
  const refused = (why: string) =>
    new CliError("validation_error", `that is not a Bitrix24 incoming webhook address: ${why}`, {
      reason: "webhook.malformed",
    })
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    throw refused("it is not a URL")
  }
  if (url.protocol !== "https:") throw refused("it must start with https://")
  if (url.username || url.password || url.search || url.hash) throw refused("it carries more than the address")
  const path = PATH.exec(url.pathname)
  if (!path?.[1] || !path[2]) throw refused("its path is not /rest/<user id>/<secret>/")
  return { origin: url.origin, userId: path[1], secret: path[2] }
}

/** REST 2 lives at `/rest/`, REST 3.0 at `/rest/api/`; both take the same user and secret. */
export const methodUrl = (webhook: Webhook, api: 2 | 3, method: string): string =>
  `${webhook.origin}/rest/${api === 3 ? "api/" : ""}${webhook.userId}/${webhook.secret}/${method}`
