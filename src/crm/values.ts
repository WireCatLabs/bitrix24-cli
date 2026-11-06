import { isoTime } from "@wirecat/cli-base/standards"
import * as v from "valibot"

export type Raw = Record<string, unknown>

export const OUTCOMES = ["open", "won", "lost"] as const
export type Outcome = (typeof OUTCOMES)[number]

/** Bitrix24's stage semantics: `S` success, `F` failure, anything else still in progress (apidocs crm.status.fields). */
export const outcomeOf = (semantics: unknown): Outcome =>
  semantics === "S" ? "won" : semantics === "F" ? "lost" : "open"
export const semanticsOf = (outcome: string): string => (outcome === "won" ? "S" : outcome === "lost" ? "F" : "P")

export const text = (value: unknown): string | null => {
  if (typeof value !== "string" && typeof value !== "number") return null
  const trimmed = String(value).trim()
  return trimmed === "" ? null : trimmed
}

export const id = (value: unknown): string | null => {
  const found = text(value)
  return found === null || found === "0" ? null : found
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

export const yes = (value: unknown): boolean => value === true || value === "Y" || value === "1" || value === 1

export const fullName = (...parts: unknown[]): string | null =>
  parts
    .map(text)
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
        const found = text((one as Raw)?.value)
        return found === null ? [] : [{ type: text((one as Raw)?.valueTypeId)?.toLowerCase() ?? null, value: found }]
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
export const customFields = (raw: Raw | undefined): Record<string, unknown> =>
  Object.fromEntries(Object.entries(raw ?? {}).filter(([key, value]) => isCustom(key) && !empty(value)))

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
