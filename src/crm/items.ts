import { CliError, isCliError } from "@wirecat/cli-base"
import type { BitrixTransport } from "../bitrix/transport.js"
import { type Condition, needsRest2, rest2Filter, rest3Filter } from "./conditions.js"
import { customFields, type Metadata, type Raw, text } from "./values.js"
import { type Window, walk } from "./walk.js"

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
const REST2_PAGE = 50

const itemsOf = (result: unknown): Raw[] => {
  const items = (result as { items?: unknown })?.items
  return Array.isArray(items) ? (items as Raw[]) : []
}

/** Newest first; REST 3.0 adds `id` itself for stable pages. */
const ORDER = { id: "DESC" }

export const listItems = async <T>(
  portal: BitrixTransport,
  type: ItemType<T>,
  conditions: readonly Condition[],
  window: Window,
) => {
  const { items, has_more } = needsRest2(conditions)
    ? await walk(window, REST2_PAGE, async (start) => {
        const answer = await portal.call("crm.item.list", {
          entityTypeId: type.entityTypeId,
          select: type.select,
          filter: rest2Filter(conditions, { [type.words[0] ?? "title"]: type.words }),
          order: ORDER,
          start,
        })
        return { rows: itemsOf(answer.result), more: answer.next !== undefined }
      })
    : await walk(window, REST3_PAGE, async (offset, limit) => {
        const rows = itemsOf(
          (
            await portal.call(`crm.${type.type}.list`, {
              select: type.select,
              filter: rest3Filter(conditions),
              order: ORDER,
              pagination: { limit, offset },
            })
          ).result,
        )
        return { rows, more: rows.length === limit }
      })
  return { items: items.map((raw) => type.map(raw)), has_more }
}

/** One item, with the portal's custom fields, which REST 3.0 returns only when each is named in `select`. */
export const getItem = async <T>(portal: BitrixTransport, type: ItemType<T>, id: string): Promise<T> => {
  const answer = await portal.call(`crm.${type.type}.get`, { id: Number(id), select: type.select })
  const item = (answer.result as { item?: Raw })?.item
  if (!item) throw new CliError("not_found", `there is no ${type.word} ${id}`)
  const full = await portal.call("crm.item.get", {
    entityTypeId: type.entityTypeId,
    id: Number(id),
    useOriginalUfNames: "Y",
  })
  const custom = customFields((full.result as { item?: Raw })?.item)
  if (!Object.keys(custom).length) return type.map(item)
  const labels = await labelsOf(portal, type.type)
  return type.map(
    item,
    Object.fromEntries(
      Object.entries(custom).map(([code, value]) => [code, { label: labels.get(code) ?? null, value }]),
    ),
  )
}

/**
 * Titles by field code. `field.list` needs only read rights, where `field.custom.list` answers empty without the right
 * to edit CRM settings. Labels are extra, so a failed call leaves them out rather than failing `show`.
 */
const labelsOf = async (
  portal: BitrixTransport,
  type: ItemType<unknown>["type"],
): Promise<Map<string, string | null>> => {
  try {
    const answer = await portal.call(`crm.${type}.field.list`, { select: ["name", "title"] })
    return new Map(itemsOf(answer.result).map((field) => [String(field.name), text(field.title)]))
  } catch (error) {
    if (isCliError(error) && error.code === "cancelled") throw error
    return new Map()
  }
}

const folded = (value: string | null) => value?.trim().toLocaleLowerCase() ?? ""

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
