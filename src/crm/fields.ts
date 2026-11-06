import { CliError } from "@wirecat/cli-base"
import * as v from "valibot"
import type { BitrixTransport } from "../bitrix/transport.js"
import type { ItemType } from "./items.js"
import { isCustom, type Metadata, type Raw, text, yes } from "./values.js"

export const fieldSchema = v.strictObject({
  code: v.string(),
  label: v.nullable(v.string()),
  type: v.string(),
  multiple: v.boolean(),
  filterable: v.boolean(),
  /** A list field's options; absent on any other field. */
  options: v.optional(v.array(v.strictObject({ id: v.string(), label: v.string() }))),
})

/** One of the portal's own fields on deals, leads, contacts or companies. */
export type Field = v.InferOutput<typeof fieldSchema>

const rows = (result: unknown): Raw[] => {
  const items = Array.isArray(result) ? result : (result as { items?: unknown })?.items
  return Array.isArray(items) ? (items as Raw[]) : []
}

/**
 * The portal's custom fields of one type, in two calls that need only read rights: REST 3.0's `field.list` has the
 * title and whether a list can filter by it, and REST 2's `userfield.list` the real type and a list field's options,
 * which `field.list` shows only as `int` (apidocs crm.<type>.field.custom.enum.list).
 */
export const loadFields = async (portal: BitrixTransport, type: ItemType<unknown>["type"]): Promise<Field[]> => {
  const described = await portal.call(`crm.${type}.field.list`, {
    select: ["name", "title", "type", "multiple", "filterable"],
  })
  const custom = await portal.call(`crm.${type}.userfield.list`, { order: { SORT: "ASC" } })
  const own = new Map(rows(custom.result).map((field) => [String(field.FIELD_NAME), field]))
  return rows(described.result)
    .filter((field) => isCustom(String(field.name)))
    .map((field) => {
      const code = String(field.name)
      const user = own.get(code)
      const options = Array.isArray(user?.LIST)
        ? (user.LIST as Raw[]).flatMap((option) => {
            const id = text(option.ID)
            return id === null ? [] : [{ id, label: text(option.VALUE) ?? id }]
          })
        : undefined
      return {
        code,
        label: text(field.title),
        type: text(user?.USER_TYPE_ID) ?? text(field.type) ?? "string",
        multiple: yes(field.multiple),
        filterable: yes(field.filterable),
        ...(options ? { options } : {}),
      }
    })
}

const optionLabel = (field: Field, id: unknown) =>
  field.options?.find((option) => option.id === String(id))?.label ?? String(id)

/** Custom values as `{ label, value }`, a list field's option ids turned into their labels. */
export const metadataOf = (custom: Record<string, unknown>, fields: readonly Field[]): Metadata => {
  const byCode = new Map(fields.map((field) => [field.code, field]))
  return Object.fromEntries(
    Object.entries(custom).map(([code, value]) => {
      const field = byCode.get(code)
      const label = field?.label ?? null
      if (!field?.options) return [code, { label, value }]
      if (Array.isArray(value))
        return [
          code,
          { label, value: value.map((one) => optionLabel(field, one)), option_id: value.map((one) => String(one)) },
        ]
      return [code, { label, value: optionLabel(field, value), option_id: String(value) }]
    }),
  )
}

/** Case, spaces and underscores aside: `lead_source` and `Lead source` are one name. */
const folded = (name: string) =>
  name
    .trim()
    .toLocaleLowerCase()
    .replace(/[\s_]+/g, " ")

const named = (field: Field) => ({ code: field.code, label: field.label })

/** No field by that name: the fields whose code or label holds it, or is held in it, as candidates. */
export const unknownField = (fields: readonly Field[], name: string) => {
  const want = folded(name)
  const close = fields.filter((field) =>
    [field.code, field.label ?? ""].some((one) => {
      const other = folded(one)
      return other !== "" && (other.includes(want) || want.includes(other))
    }),
  )
  return new CliError(
    "validation_error",
    `no custom field is named ${name}${close.length ? "; close ones are in candidates" : ""} — \`fields list\` lists them`,
    { reason: "field.unknown", candidates: close.map(named) },
  )
}

/**
 * A custom field by its code, or by its whole label; two fields with that label are refused with both, never
 * guessed (as `resolveItem` refuses two records).
 */
export const findField = (fields: readonly Field[], name: string): Field => {
  const want = folded(name)
  const byCode = fields.find((field) => folded(field.code) === want)
  if (byCode) return byCode
  const labelled = fields.filter((field) => field.label !== null && folded(field.label) === want)
  if (labelled.length === 1 && labelled[0]) return labelled[0]
  if (labelled.length > 1)
    throw new CliError(
      "validation_error",
      `${labelled.length} custom fields are labelled ${name}; name one by its code`,
      {
        reason: "field.ambiguous",
        candidates: labelled.map(named),
      },
    )
  throw unknownField(fields, name)
}

/** A list field's option by its id or its whole label. */
export const optionOf = (field: Field, value: string): string => {
  if (!field.options) return value
  const want = folded(value)
  const found =
    field.options.find((option) => option.id === value.trim()) ??
    field.options.find((option) => folded(option.label) === want)
  if (!found)
    throw new CliError("validation_error", `${field.label ?? field.code} has no option ${value}`, {
      reason: "field.unknown-option",
      field: field.code,
      allowed: field.options,
    })
  return found.id
}

/** `--field` as typed, split at the first `=`. */
export const fieldPairsOf = (typed: readonly string[]): [string, string][] =>
  typed.map((one) => {
    const at = one.indexOf("=")
    if (at <= 0 || one.slice(0, at).trim() === "")
      throw new CliError("validation_error", `--field takes <key>=<value>; got ${one}`, { param: "--field" })
    return [one.slice(0, at), one.slice(at + 1)]
  })

/**
 * The custom values to write, by code, as typed: a list field's options as their ids, numbers as `field.list` types
 * them (`int`), and a multiple field's values as an array.
 */
export const customValues = (fields: readonly Field[], pairs: readonly [string, string][]): Raw => {
  const values = new Map<Field, (string | number)[]>()
  for (const [name, value] of pairs) {
    const field = findField(fields, name)
    values.set(field, [...(values.get(field) ?? []), field.options ? Number(optionOf(field, value)) : value])
  }
  return Object.fromEntries(
    [...values].map(([field, all]) => {
      if (field.multiple) return [field.code, all]
      if (all.length > 1)
        throw new CliError("validation_error", `${field.label ?? field.code} holds one value; give --field once`, {
          param: "--field",
          field: field.code,
        })
      return [field.code, all[0]]
    }),
  )
}
