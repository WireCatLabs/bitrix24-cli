import { CliError } from "@wirecat/cli-base"
import type { CrmField } from "@wirecat/cli-core"
import { fieldNamed, optionOf } from "@wirecat/cli-core/crm"
import type { BitrixCaller } from "../bitrix/transport.js"
import type { ItemType } from "./items.js"
import { isCustom, type Metadata, type Raw, text, yes } from "./values.js"

/** One of the portal's own fields on deals, leads, contacts or companies. */
export type Field = CrmField

const rows = (result: unknown): Raw[] => {
  const items = Array.isArray(result) ? result : (result as { items?: unknown })?.items
  return Array.isArray(items) ? (items as Raw[]) : []
}

/**
 * The portal's custom fields of one type, in two calls that need only read rights: REST 3.0's `field.list` has the
 * title and whether a list can filter by it, and REST 2's `userfield.list` the real type and a list field's options,
 * which `field.list` shows only as `int` (apidocs crm.<type>.field.custom.enum.list).
 */
export const loadFields = async (portal: BitrixCaller, type: ItemType<unknown>["type"]): Promise<Field[]> => {
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

/**
 * The custom values to write, by code, as typed: a list field's options as their ids, numbers as `field.list` types
 * them (`int`), and a multiple field's values as an array.
 */
export const customValues = (fields: readonly Field[], pairs: readonly [string, string][]): Raw => {
  const values = new Map<Field, (string | number)[]>()
  for (const [name, value] of pairs) {
    const field = fieldNamed(fields, name)
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
