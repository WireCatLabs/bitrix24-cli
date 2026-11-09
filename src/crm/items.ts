import { CliError, isCliError } from "@wirecat/cli-base"
import { foldName } from "@wirecat/cli-core"
import type { BitrixTransport } from "../bitrix/transport.js"
import { type Condition, needsRest2, rest2Filter, rest3Filter } from "./conditions.js"
import { type Field, loadFields, metadataOf } from "./fields.js"
import { customFields, fieldOf, isRaw, type Metadata, type Raw } from "./values.js"
import { rest2Rows, rest3Rows, type Window } from "./walk.js"

/** A CRM object REST 3.0 serves as `crm.<type>.*`, and REST 2 as `crm.item.*` with its `entityTypeId`. */
export interface ItemType<T> {
  type: "deal" | "lead" | "contact" | "company"
  entityTypeId: number
  /** What a person calls one, in a message: `deal`, `person`. */
  word: string
  select: readonly string[]
  /** The fields a free word in a list query, or a name in `show`, is matched against. */
  words: readonly string[]
  nameOf: (item: T) => string | null
  map: (raw: Raw, metadata?: Metadata) => T
}

const REST3_PAGE = 1000

/** Newest first; REST 3.0 adds `id` itself for stable pages. */
const ORDER = { id: "DESC" }

/** Custom fields a list selects beside its own, with the definitions that label them. */
export interface Custom {
  codes: readonly string[]
  fields: readonly Field[]
}

export const listItems = async <T>(
  portal: BitrixTransport,
  type: ItemType<T>,
  conditions: readonly Condition[],
  window: Window,
  custom: Custom = { codes: [], fields: [] },
) => {
  const select = [...type.select, ...custom.codes]
  const { items, has_more } = needsRest2(conditions)
    ? await rest2Rows(
        portal,
        "crm.item.list",
        {
          entityTypeId: type.entityTypeId,
          select,
          filter: rest2Filter(conditions, { [type.words[0] ?? "title"]: type.words }),
          order: ORDER,
          useOriginalUfNames: "Y",
        },
        window,
      )
    : await rest3Rows(
        portal,
        `crm.${type.type}.list`,
        { select, filter: rest3Filter(conditions), order: ORDER },
        REST3_PAGE,
        window,
      )
  return { items: items.map((raw) => type.map(raw, metadataIn(raw, custom))), has_more }
}

const metadataIn = (raw: Raw, { codes, fields }: Custom): Metadata | undefined => {
  const values = Object.entries(customFields(raw)).filter(([code]) => codes.includes(code))
  return values.length ? metadataOf(Object.fromEntries(values), fields) : undefined
}

/** One item, with the portal's custom fields, which REST 3.0 returns only when each is named in `select`. */
export const getItem = async <T>(portal: BitrixTransport, type: ItemType<T>, id: string): Promise<T> => {
  const answer = await portal.call(`crm.${type.type}.get`, { id: Number(id), select: type.select })
  const item = fieldOf(answer.result, "item")
  if (!isRaw(item)) throw new CliError("not_found", `there is no ${type.word} ${id}`)
  const full = await portal.call("crm.item.get", {
    entityTypeId: type.entityTypeId,
    id: Number(id),
    useOriginalUfNames: "Y",
  })
  const custom = customFields(fieldOf(full.result, "item"))
  if (!Object.keys(custom).length) return type.map(item)
  return type.map(item, metadataOf(custom, await fieldsOrNone(portal, type.type)))
}

/** A webhook without the rights to read field definitions still shows the record, with codes for labels. */
const fieldsOrNone = async (portal: BitrixTransport, type: ItemType<unknown>["type"]): Promise<Field[]> => {
  try {
    return await loadFields(portal, type)
  } catch (error) {
    if (isCliError(error) && error.code === "permission_error") return []
    throw error
  }
}

const folded = (value: string | null) => foldName(value?.trim() ?? "")

/**
 * An id as it is, or a name matched whole against the portal's substring search; two matches are refused with both,
 * never guessed (as cli-core's `pickPerson` refuses).
 */
export const resolveItem = async <T extends { id: string }>(
  portal: BitrixTransport,
  type: ItemType<T>,
  reference: string,
): Promise<string> => {
  if (/^[1-9]\d*$/.test(reference)) return reference
  const word = type.words[0] ?? "title"
  const found = await listItems(portal, type, [{ field: word, op: "like", value: reference.trim() }], {
    offset: 0,
    limit: 20,
  })
  const exact = found.items.filter((item) => folded(type.nameOf(item)) === folded(reference))
  const candidates = (exact.length ? exact : found.items).map((item) => ({ id: item.id, name: type.nameOf(item) }))
  if (exact.length === 1 && exact[0]) return exact[0].id
  if (exact.length > 1)
    throw new CliError("validation_error", `${exact.length} ${type.word} records have that name; name one by its id`, {
      reason: `${type.word}.ambiguous`,
      candidates,
    })
  throw new CliError(
    "not_found",
    `no ${type.word} has exactly that name${candidates.length ? "; close ones are in candidates" : ""}`,
    {
      reason: `${type.word}.not-found`,
      candidates,
    },
  )
}
