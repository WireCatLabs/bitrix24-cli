import type { Level } from "@wirecat/cli-core/sends"
import { type Effect, KNOWN_METHODS, methodOf } from "./bitrix/methods.js"

export const apiKey = (method: string): string => `api.${method}`

/**
 * Families whose writes reach people or start the portal's own automation: messages and notifications (im,
 * imopenlines, imbot; read-only for now, NEED-2278 A), SMS and mail services, telephony, workflows, CRM activities
 * (an e-mail activity sends the mail), tasks (the assignee is told), invitations (`user.add` mails one), and `batch`,
 * which can hold any of them. Denied until the owner allows them.
 */
export const DENIED_FAMILIES = [
  "im",
  "imopenlines",
  "imbot",
  "messageservice",
  "mailservice",
  "telephony",
  "voximplant",
  "bizproc",
  "crm.automation",
  "crm.activity",
  "tasks",
  "task",
  "user.add",
  "batch",
]

const deniedFamily = (method: string) =>
  DENIED_FAMILIES.some((family) => method === family || method.startsWith(`${family}.`))

/** A method's default, as WC-PERM-22 has it: a read and an ordinary change allowed, a delete asked. */
export const apiDefault = (method: string, effect: Effect = methodOf(method).effect): Level => {
  if (effect !== "read" && deniedFamily(method)) return "deny"
  return effect === "destructive" ? "ask" : "allow"
}

const NOUNS: Record<string, string> = { deal: "deals", lead: "leads", contact: "people", company: "organizations" }
const ACTIONS: Record<string, string> = { add: "create", update: "update", delete: "delete" }

/**
 * The command key a raw call does the same as, so `api call crm.deal.update` cannot get round `deals.update: deny`
 * (gcal-cli's `WRITE_METHODS`). An update that sets a stage is a move too.
 */
export const commandKeysOf = (method: string, body: Record<string, unknown> = {}): string[] => {
  const [, type, action] = /^crm\.(deal|lead|contact|company)\.(add|update|delete)$/.exec(method) ?? []
  if (!type || !action) return []
  const noun = NOUNS[type]
  const keys = [`${noun}.${ACTIONS[action]}`]
  const fields = (body.fields ?? {}) as Record<string, unknown>
  if (action === "update" && fields.stageId !== undefined && (type === "deal" || type === "lead"))
    keys.push(`${noun}.move`)
  return keys
}

/** The keys `permissions` may name for `api`: the known methods and the denied families. */
export const API_KEYS = [...KNOWN_METHODS.map((one) => apiKey(one.name)), ...DENIED_FAMILIES.map(apiKey)]

export const API_DEFAULTS: Record<string, Level> = {
  ...Object.fromEntries(
    KNOWN_METHODS.filter((one) => apiDefault(one.name, one.effect) !== "allow").map((one) => [
      apiKey(one.name),
      apiDefault(one.name, one.effect),
    ]),
  ),
  ...Object.fromEntries(DENIED_FAMILIES.map((family) => [apiKey(family), "deny" as Level])),
}
