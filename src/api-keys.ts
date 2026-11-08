import { CliError } from "@wirecat/cli-base"
import type { DealKind } from "@wirecat/cli-core"
import type { CrmVerb } from "@wirecat/cli-core/crm"
import type { Level } from "@wirecat/cli-core/sends"
import { type Effect, KNOWN_METHODS, methodOf } from "./bitrix/methods.js"
import { type Body, foldCode, isRecord, jsonNumber } from "./body.js"

export const apiKey = (method: string): string => `api.${method}`

/**
 * Families whose writes reach people, publish, or start the portal's own automation: messages and notifications (im,
 * imopenlines, imbot, imconnector's Open Lines; read-only for now, NEED-2278 A), Live Feed posts, SMS and mail
 * services, telephony, workflows, CRM activities (an e-mail activity sends the mail), tasks (the assignee is told),
 * invitations (`user.add` mails one), public file links, event handlers that send portal data to a URL, and `batch`,
 * which can hold any of them. Denied until the owner allows them, reads too: they hold messages, e-mails and tasks.
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
const READ_FAMILIES = [
  "crm",
  "catalog",
  "user",
  "department",
  "profile",
  "methods",
  "method",
  "scope",
  "server.time",
  "app.info",
]

const inFamily = (families: readonly string[], method: string) =>
  families.some((family) => method === family || method.startsWith(`${family}.`))

/** Bitrix24 takes a method in any letter case and with a `.json` suffix; one name keeps the keys from being dodged. */
export const normalMethod = (raw: string): string => raw.toLowerCase().replace(/\.json$/, "")

/** A field in any letter case, with or without underscores: `parseBody` has refused a body that spells one twice. */
export const fieldOf = (record: Body, name: string): unknown => {
  const wanted = foldCode(name)
  const found = Object.keys(record).find((one) => foldCode(one) === wanted)
  return found === undefined ? undefined : record[found]
}

export const fieldsOf = (body: Body): Record<string, unknown> => {
  const fields = fieldOf(body, "fields")
  return isRecord(fields) ? fields : {}
}

/** The employee a write assigns the record to, by any spelling of `assignedById`. */
export const assigneeOf = (fields: Body): string | undefined => {
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

const refused = (message: string) =>
  new CliError("validation_error", message, { param: "--body", reason: "body.invalid", sent: false })

/** `"02"`, `" 2"` or `"2.0"` would name no type here while the portal may read them as deals: only digits pass. */
const entityTypeOf = (body: Body): string | undefined => {
  const given = fieldOf(body, "entityTypeId")
  if (given === undefined) return undefined
  const digits =
    jsonNumber(given) ?? (typeof given === "string" ? given : typeof given === "number" ? String(given) : "")
  if (!/^(0|[1-9][0-9]*)$/.test(digits)) throw refused("entityTypeId takes the type's number, such as 2 for deals")
  return digits
}

/** What `api call` sends, checked once: the body `parseBody` gave, its `fields` an object and its type a number. */
export const checkCall = (method: string, body: Body): void => {
  entityTypeOf(body)
  const fields = fieldOf(body, "fields")
  if (fields !== undefined && !isRecord(fields)) throw refused("fields takes a JSON object of field names and values")
  if (/^crm\.item\.(add|update|delete|get|list|fields)$/.test(method) && fieldOf(body, "entityTypeId") === undefined)
    throw refused(`${method} needs entityTypeId, the record type's number`)
}

const typeOf = (method: string, body: Body) => {
  const named = /^crm\.(deal|lead|contact|company)\.(.+)$/.exec(method)
  if (named?.[1] && named[2]) return { type: named[1], action: named[2] }
  const item = /^crm\.item\.(.+)$/.exec(method)
  const type = ENTITY_TYPES[entityTypeOf(body) ?? ""]
  return item?.[1] && type ? { type, action: item[1] } : undefined
}

/** The CRM type and action a raw write does, whether named `crm.deal.update` or `crm.item.update` with its type id. */
const crmWriteOf = (method: string, body: Body) => {
  const found = typeOf(method, body)
  return found && Object.hasOwn(ACTIONS, found.action) ? found : undefined
}

/** The command a raw read reads the same as; any other read of a type, such as its product rows, is its list. */
const readKeysOf = (method: string, body: Body): string[] => {
  const crm = typeOf(method, body)
  if (crm) {
    const noun = NOUNS[crm.type]
    if (crm.action === "get") return [`${noun}.show`]
    return /^(fields$|field\.|userfield\.)/.test(crm.action) ? ["fields.list"] : [`${noun}.list`]
  }
  // `crm.item.productrow.*` names its record by ownerType in the filter, not entityTypeId (apidocs).
  if (method.startsWith("crm.item.") && fieldOf(body, "entityTypeId") === undefined)
    return Object.values(NOUNS).map((noun) => `${noun}.list`)
  const product = /^(?:crm|catalog)\.product\.(.+)$/.exec(method)
  if (product) return [product[1] === "get" ? "products.show" : "products.list"]
  // `users list` and `users show` both read through user.get.
  if (method === "user.get" || method === "user.search") return ["users.list", "users.show"]
  // The org chart says who works with whom, as the user list does; own companies are organizations.
  if (method.startsWith("department.")) return ["users.list"]
  if (method.startsWith("crm.mycompany.")) return ["organizations.list"]
  if (method.startsWith("crm.category.")) return ["pipelines.list"]
  if (method.startsWith("crm.status.")) return ["stages.list"]
  return []
}

/**
 * The command keys a raw call does the same as, so `api call` cannot get round `deals: deny` (gcal-cli's
 * `WRITE_METHODS`, WC-PERM-22). A create or update that sets a stage is a move too.
 */
export const commandKeysOf = (method: string, body: Body = {}): string[] => {
  if (methodOf(method).effect === "read") return readKeysOf(method, body)
  const write = crmWriteOf(method, body)
  if (!write) return []
  const noun = NOUNS[write.type]
  const keys = [`${noun}.${ACTIONS[write.action]}`]
  // Without a lookup a stage may be a won or lost one, so both the move and the close key are checked.
  if (write.action !== "delete" && setsStage(write.type, fieldsOf(body))) keys.push(`${noun}.move`, `${noun}.close`)
  return keys
}

/**
 * A method's default, as WC-PERM-22 has it, from an allow list: the reads `b24` makes and the CRM writes the command
 * keys govern are allowed, a delete and anything else asks, and the families that reach people are denied, reads too.
 */
export const apiDefault = (method: string, effect: Effect = methodOf(method).effect, body: Body = {}): Level => {
  if (inFamily(DENIED_FAMILIES, method)) return "deny"
  if (effect === "destructive") return "ask"
  if (effect === "read") return inFamily(READ_FAMILIES, method) ? "allow" : "ask"
  return crmWriteOf(method, body) ? "allow" : "ask"
}

/** The built-in levels with this call's own key, which the static table cannot list for every method. */
export const callDefaults = (
  method: string,
  effect: Effect,
  body: Body,
  defaults: Readonly<Record<string, Level>>,
): Record<string, Level> => ({ ...defaults, [apiKey(method)]: apiDefault(method, effect, body) })

const METHODS: Record<CrmVerb, string> = {
  create: "add",
  update: "update",
  move: "update",
  close: "update",
  remove: "delete",
}

/**
 * The `api.*` key a deal's or lead's write sends its request under, so `api.crm.deal.update: deny` holds on `deals
 * update` too: core's `CrmWrites.alsoChecks` and, through `crmAlsoChecks`, its `--dry-run`.
 */
export const crmApiKeys = (kind: DealKind, verb: CrmVerb): string[] => [apiKey(`crm.${kind}.${METHODS[verb]}`)]

const OWN_WRITES: Record<string, string> = { people: "contact", organizations: "company" }

/** The same for b24's own `people` and `organizations` writes, by command path. */
export const apiKeysOf = (path: readonly string[]): string[] => {
  const [noun, command, ...rest] = path
  const type = OWN_WRITES[noun ?? ""]
  const method = command === "create" ? "add" : command === "update" ? "update" : undefined
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
