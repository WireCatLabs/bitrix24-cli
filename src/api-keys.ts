import type { Level } from "@wirecat/cli-core/sends"
import { type Effect, KNOWN_METHODS, methodOf } from "./bitrix/methods.js"

export const apiKey = (method: string): string => `api.${method}`

/**
 * Families whose writes reach people, publish, or start the portal's own automation: messages and notifications (im,
 * imopenlines, imbot, imconnector's Open Lines; read-only for now, NEED-2278 A), Live Feed posts, SMS and mail
 * services, telephony, workflows, CRM activities (an e-mail activity sends the mail), tasks (the assignee is told),
 * invitations (`user.add` mails one), public file links, event handlers that send portal data to a URL, and `batch`,
 * which can hold any of them. Denied until the owner allows them.
 */
export const DENIED_FAMILIES = [
  "im",
  "imopenlines",
  "imbot",
  "imconnector",
  "log.blogpost",
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
  "disk.file.getexternallink",
  "disk.folder.getexternallink",
  "event.bind",
  "batch",
]

/** The families `b24` reads itself: a read outside them asks, since it may hold what the owner keeps from agents. */
const READ_FAMILIES = ["crm", "catalog", "user", "profile", "methods", "method", "scope", "server.time", "app.info"]

const inFamily = (families: readonly string[], method: string) =>
  families.some((family) => method === family || method.startsWith(`${family}.`))

/** Bitrix24 takes a method in any letter case and with a `.json` suffix; one name keeps the keys from being dodged. */
export const normalMethod = (raw: string): string => raw.toLowerCase().replace(/\.json$/, "")

/** A field in any letter case, with or without underscores: Bitrix24 takes both `stageId` and `STAGE_ID`. */
export const fieldOf = (record: Record<string, unknown>, name: string): unknown => {
  const wanted = name.toLowerCase()
  const found = Object.keys(record).find((one) => one.replaceAll("_", "").toLowerCase() === wanted)
  return found === undefined ? undefined : record[found]
}

export const fieldsOf = (body: Record<string, unknown>): Record<string, unknown> => {
  const fields = fieldOf(body, "fields")
  return typeof fields === "object" && fields !== null ? (fields as Record<string, unknown>) : {}
}

/** The employee a write assigns the record to, by any spelling of `assignedById`. */
export const assigneeOf = (fields: Record<string, unknown>): string | undefined => {
  const found = fieldOf(fields, "assignedById")
  return found === undefined || found === null ? undefined : String(found)
}

/** Whether a write changes a deal's or a lead's stage: `stageId`, or a lead's REST 2 `STATUS_ID`. */
export const setsStage = (type: string, fields: Record<string, unknown>): boolean =>
  (type === "deal" || type === "lead") &&
  (fieldOf(fields, "stageId") !== undefined || (type === "lead" && fieldOf(fields, "statusId") !== undefined))

const NOUNS: Record<string, string> = { deal: "deals", lead: "leads", contact: "people", company: "organizations" }
const ACTIONS: Record<string, string> = { add: "create", update: "update", delete: "delete" }
/** `crm.item.*`'s `entityTypeId` for the four types the commands cover (apidocs "crm.item.add"). */
const ENTITY_TYPES: Record<string, string> = { "1": "lead", "2": "deal", "3": "contact", "4": "company" }

/** The CRM type and action a raw write does, whether named `crm.deal.update` or `crm.item.update` with its type id. */
const crmWriteOf = (method: string, body: Record<string, unknown>) => {
  const named = /^crm\.(deal|lead|contact|company)\.(add|update|delete)$/.exec(method)
  if (named?.[1] && named[2]) return { type: named[1], action: named[2] }
  const item = /^crm\.item\.(add|update|delete)$/.exec(method)
  const type = ENTITY_TYPES[String(fieldOf(body, "entityTypeId"))]
  return item?.[1] && type ? { type, action: item[1] } : undefined
}

/**
 * The command keys a raw call does the same as, so `api call` cannot get round `deals.update: deny` (gcal-cli's
 * `WRITE_METHODS`). A create or update that sets a stage is a move too.
 */
export const commandKeysOf = (method: string, body: Record<string, unknown> = {}): string[] => {
  const write = crmWriteOf(method, body)
  if (!write) return []
  const noun = NOUNS[write.type]
  const keys = [`${noun}.${ACTIONS[write.action]}`]
  if (write.action !== "delete" && setsStage(write.type, fieldsOf(body))) keys.push(`${noun}.move`)
  return keys
}

/** The command keys a CRM write command checks beside its own: `.move` when its fields set a stage. */
export const stageKeysOf = (noun: string, fields: Record<string, unknown>): string[] => {
  const type = Object.keys(NOUNS).find((one) => NOUNS[one] === noun) ?? ""
  return setsStage(type, fields) ? [`${noun}.move`] : []
}

/**
 * A method's default, as WC-PERM-22 has it, from an allow list: the reads `b24` makes and the CRM writes the command
 * keys govern are allowed, a delete and anything else asks, and the families that reach people are denied.
 */
export const apiDefault = (
  method: string,
  effect: Effect = methodOf(method).effect,
  body: Record<string, unknown> = {},
): Level => {
  if (effect !== "read" && inFamily(DENIED_FAMILIES, method)) return "deny"
  if (effect === "destructive") return "ask"
  if (effect === "read") return inFamily(READ_FAMILIES, method) ? "allow" : "ask"
  return crmWriteOf(method, body) ? "allow" : "ask"
}

/** The built-in levels with this call's own key, which the static table cannot list for every method. */
export const callDefaults = (
  method: string,
  effect: Effect,
  body: Record<string, unknown>,
  defaults: Readonly<Record<string, Level>>,
): Record<string, Level> => ({ ...defaults, [apiKey(method)]: apiDefault(method, effect, body) })

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
