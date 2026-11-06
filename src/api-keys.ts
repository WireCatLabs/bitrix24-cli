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

const METHODS_OF_COMMANDS: Record<string, string> = { create: "add", update: "update", move: "update" }

/**
 * The other way round: the `api.*` key a CRM write command's own request checks, so `api.crm.deal.update: deny` holds
 * on `deals update` too. Both the run and its `--dry-run` preview read it.
 */
export const apiKeysOf = (path: readonly string[]): string[] => {
  const [noun, command, ...rest] = path
  const type = Object.keys(NOUNS).find((one) => NOUNS[one] === noun)
  const method = METHODS_OF_COMMANDS[command ?? ""]
  return type && method && rest.length === 0 ? [apiKey(`crm.${type}.${method}`)] : []
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
