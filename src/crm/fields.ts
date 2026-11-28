import { isCliError } from "@wirecat/cli-base"
import { type CrmField, crmValues } from "@wirecat/cli-core"
import type { BitrixCaller } from "../bitrix/transport.js"
import type { ItemType } from "./items.js"
import { rowsOf } from "./rows.js"
import { isCustom, type Raw, yes } from "./values.js"

const { rawsOf, text } = crmValues

/**
 * The portal's custom fields of one type, in two calls that need only read rights: REST 3.0's `field.list` has the
 * title and whether a list can filter by it, and REST 2's `userfield.list` the real type and a list field's options,
 * which `field.list` shows only as `int` (apidocs crm.<type>.field.custom.enum.list).
 *
 * None sets `CrmField.holds`: a phone or an e-mail is one of the standard `crm_multifield` fields, which `phones` and
 * `emails` carry, and no custom field type holds one (apidocs crm.userfield.types, data-types#crm_multifield).
 */
export const loadFields = async (portal: BitrixCaller, type: ItemType["type"]): Promise<CrmField[]> => {
  const described = await portal
    .call(`crm.${type}.field.list`, { select: ["name", "title", "type", "multiple", "filterable"] })
    .catch((error: unknown) => {
      // A portal that refuses the titles still lists its fields through userfield.list: they answer without a label.
      if (isCliError(error) && error.code === "permission_error") return null
      throw error
    })
  const custom = rowsOf((await portal.call(`crm.${type}.userfield.list`, { order: { SORT: "ASC" } })).result)
  const own = new Map(custom.map((field) => [String(field.FIELD_NAME), field]))
  const rows: Raw[] = described
    ? rowsOf(described.result)
    : custom.map((field) => ({ name: field.FIELD_NAME, multiple: field.MULTIPLE }))
  return rows
    .filter((field) => isCustom(String(field.name)))
    .map((field) => {
      const code = String(field.name)
      const user = own.get(code)
      const options = Array.isArray(user?.LIST)
        ? rawsOf(user.LIST).flatMap((option) => {
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
