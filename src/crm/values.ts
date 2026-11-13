import { CliError } from "@wirecat/cli-base"
import { isoTime } from "@wirecat/cli-base/standards"
import type { StageOutcome } from "@wirecat/cli-core"
import * as v from "valibot"

export type Raw = Record<string, unknown>

export const isRaw = (value: unknown): value is Raw =>
  typeof value === "object" && value !== null && !Array.isArray(value)

export const fieldOf = (value: unknown, key: string): unknown => (isRaw(value) ? value[key] : undefined)

export const rawsOf = (value: unknown): Raw[] => (Array.isArray(value) ? value.filter(isRaw) : [])

/** Bitrix24's stage semantics: `S` success, `F` failure, anything else still in progress (apidocs crm.status.fields). */
export const outcomeOf = (semantics: unknown): StageOutcome =>
  semantics === "S" ? "won" : semantics === "F" ? "lost" : "open"

export const text = (value: unknown): string | null => {
  if (typeof value !== "string" && typeof value !== "number") return null
  const trimmed = String(value).trim()
  return trimmed === "" ? null : trimmed
}

export const id = (value: unknown): string | null => {
  const found = text(value)
  return found === null || found === "0" ? null : found
}

/** `Number("anna")` is NaN, which goes out as null: Bitrix24 may then read the call as having no id at all. */
export const numericId = (value: string, what: string): number => {
  if (!/^(0|[1-9][0-9]*)$/.test(value))
    throw new CliError("validation_error", `${what} takes a number, such as 7`, { reason: "id.invalid", sent: false })
  return Number(value)
}

export const ids = (value: unknown): string[] =>
  Array.isArray(value) ? value.map(id).filter((one): one is string => one !== null) : []

export const number = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null
  const found = Number(value)
  return Number.isFinite(found) ? found : null
}

/** Bitrix24 answers with the portal's offset; every answer here is UTC (WC-OUT-13). */
export const time = (value: unknown): string | null => {
  const found = text(value)
  if (found === null) return null
  const parsed = new Date(found)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

/** Epoch milliseconds, as core's CRM copy keeps times. */
export const epoch = (value: unknown): number | null => {
  const found = time(value)
  return found === null ? null : Date.parse(found)
}

/**
 * Money as a decimal string in its currency, both or neither. Bitrix24 gives every deal a currency and `0` for no
 * amount, so `0` is no amount. REST 2 sends the amount as a string, kept as sent; REST 3.0 as a number, whose
 * shortest form is the one the portal wrote, where `toFixed` would add the double's error from about 1e10.
 */
export const amountOf = (value: unknown, currency: unknown): { amount: string | null; currency: string | null } => {
  const found = number(value)
  const code = text(currency)?.toUpperCase() ?? null
  if (found === null || found <= 0 || code === null) return { amount: null, currency: null }
  return { amount: typeof value === "string" ? value.trim() : String(found), currency: code }
}

export const yes = (value: unknown): boolean => value === true || value === "Y" || value === "1" || value === 1

/** A portal import can leave `null` or `null #<id>` in a name field: 101,876 contacts on one live portal. */
const PLACEHOLDER = /(?:^|\s)null(?:\s+#\d+)?(?=\s|$)/gi

export const fullName = (...parts: unknown[]): string | null =>
  parts
    .map((part) => text(text(part)?.replace(PLACEHOLDER, "")))
    .filter((part): part is string => part !== null)
    .join(" ") || null

export interface Contact {
  type: string | null
  value: string
}

/** REST 3.0 `phone` and `email`: `[{ valueTypeId, value }]`. */
export const contacts = (value: unknown): Contact[] =>
  Array.isArray(value)
    ? value.flatMap((one) => {
        const found = text(fieldOf(one, "value"))
        return found === null ? [] : [{ type: text(fieldOf(one, "valueTypeId"))?.toLowerCase() ?? null, value: found }]
      })
    : []

const CUSTOM = /^(UF_CRM_|ufCrm)/

/** A portal's own field, not its read-only `_data` twin. */
export const isCustom = (name: string) => CUSTOM.test(name) && !name.endsWith("_data")

const empty = (value: unknown) => value === null || value === "" || (Array.isArray(value) && value.length === 0)

/**
 * The portal's own fields that hold a value, as it names them: their meaning is the portal owner's, so they stay
 * unmapped. `false` and `0` stay, since a yes/no field saying no is an answer.
 */
export const customFields = (raw: unknown): Record<string, unknown> =>
  isRaw(raw) ? Object.fromEntries(Object.entries(raw).filter(([key, value]) => isCustom(key) && !empty(value))) : {}

export const contactSchema = v.strictObject({ type: v.nullable(v.string()), value: v.string() })
export const nullableTime = v.nullable(isoTime)
/**
 * A custom field's value with its title on the portal; `label` is null when the portal did not give one. A list
 * field's value is its option's label, and `option_id` the option's id (both arrays for a multiple field).
 */
export const metadataSchema = v.optional(
  v.record(
    v.string(),
    v.strictObject({
      label: v.nullable(v.string()),
      value: v.unknown(),
      option_id: v.optional(v.union([v.string(), v.array(v.string())])),
    }),
  ),
)
export type Metadata = NonNullable<v.InferOutput<typeof metadataSchema>>

/**
 * A filter's time as REST 3.0 takes it, whole seconds with an offset: a live portal refused a filter with
 * `toISOString()`'s milliseconds and `Z` (REQUESTVALIDATIONEXCEPTION, 2026-11-07).
 */
export const portalTime = (ms: number) =>
  new Date(Math.floor(ms / 1000) * 1000).toISOString().replace(".000Z", "+00:00")
