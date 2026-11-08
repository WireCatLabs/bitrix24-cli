import { CliError, isCliError } from "@wirecat/cli-base"
import type { CrmField, CrmItem, CrmKind, CrmOrganization, CrmPerson, CrmRecords } from "@wirecat/cli-core"
import type { CrmCallContext, CrmChanges, CrmIdPage, CrmSource } from "@wirecat/cli-core/crm"
import type { BitrixTransport } from "../bitrix/transport.js"
import { DEAL } from "./deal.js"
import { loadFields, metadataOf } from "./fields.js"
import type { ItemType } from "./items.js"
import { LEAD } from "./lead.js"
import { ORGANIZATION } from "./organization.js"
import { PERSON } from "./person.js"
import { bitrixPipelines } from "./pipelines.js"
import { contacts, customFields, fullName, id, type Metadata, portalTime, type Raw, text } from "./values.js"

/**
 * Re-read before the last cursor: rows the portal saved while the round ran, and this computer's clock running ahead
 * of the portal's. A row read twice is only saved twice.
 */
const OVERLAP_MS = 10 * 60_000
const PAGE = 500

const TYPES: Record<CrmKind, ItemType<unknown>> = {
  deal: DEAL as ItemType<unknown>,
  lead: LEAD as ItemType<unknown>,
  person: PERSON as ItemType<unknown>,
  organization: ORGANIZATION as ItemType<unknown>,
}

const toPerson = (raw: Raw): CrmPerson => ({
  externalId: id(raw.id) ?? "",
  name: fullName(raw.name, raw.secondName, raw.lastName),
  email: contacts(raw.email)[0]?.value ?? null,
  phone: contacts(raw.phone)[0]?.value ?? null,
})

const toOrganization = (raw: Raw, metadata?: Metadata): CrmOrganization => ({
  externalId: id(raw.id) ?? "",
  name: text(raw.title) ?? "",
  url: text(raw.url),
  ...(metadata ? { metadata } : {}),
})

/** A list answer without `items` is refused: read as an empty page, it would end the round and empty an id pass. */
const rowsOf = (result: unknown): Raw[] => {
  const items = (result as { items?: unknown })?.items
  if (!Array.isArray(items)) throw new CliError("invalid_response", "the portal answered a list without its items")
  return items as Raw[]
}

/**
 * The responsible users a `mine` scope keeps, as numbers for the portal's filter; core has checked and normalised
 * them. A Bitrix24 deal or lead always has one, the creator by default, so the portal has no unassigned items.
 */
const assigneesOf = (kind: CrmKind, context?: CrmCallContext): number[] | null => {
  const scope = context?.scope
  if (scope?.mode !== "mine" || (kind !== "deal" && kind !== "lead")) return null
  return [...new Set([scope.self, ...scope.also].map(Number))]
}

/** `<last id>@<when the round started>`: keyset paging by id, so a row changed mid-round never shifts the rest. */
const pageOf = (page: string | undefined, now: number) => {
  const [after, started] = (page ?? "").split("@")
  return { after: Number(after) || 0, started: Number(started) || now }
}

export interface BitrixCrmSource extends CrmSource {
  /** One deal or lead as the portal holds it now, custom fields included: what a write answers. */
  item(kind: "deal" | "lead", externalId: string): Promise<CrmItem>
  /** The portal's custom fields of a kind, read once per source. */
  fields(kind: CrmKind): Promise<CrmField[]>
}

/**
 * The portal's CRM for core's sync: REST 3.0 lists by id with `updatedTime` for changes, since a webhook gets no
 * event feed, and a list of every id to find deletions. A `mine` scope limits a full round by `assignedById`.
 */
export const bitrixCrmSource = (portal: () => BitrixTransport, now: () => number = Date.now): BitrixCrmSource => {
  const loaded = new Map<CrmKind, Promise<CrmField[]>>()
  const fields = (kind: CrmKind) => {
    let found = loaded.get(kind)
    if (!found) {
      // A webhook without the rights to read field definitions still syncs its records, with no definitions. Any
      // other failure fails the sync rather than mark every stored definition deleted over a passing fault.
      found = loadFields(portal(), TYPES[kind].type).catch((error: unknown) => {
        if (isCliError(error) && error.code === "permission_error") return []
        throw error
      })
      loaded.set(kind, found)
    }
    return found
  }
  // core's CrmPerson has no metadata, so a contact's values are not read; its definitions still are, for `fields list`.
  const custom = async (kind: CrmKind) => (kind === "person" ? [] : await fields(kind))
  const mapped = (kind: CrmKind, raw: Raw, defined: readonly CrmField[]): unknown => {
    const values = customFields(raw)
    const metadata = Object.keys(values).length ? metadataOf(values, defined) : undefined
    if (kind === "person") return toPerson(raw)
    if (kind === "organization") return toOrganization(raw, metadata)
    return TYPES[kind].map(raw, metadata)
  }
  const list = (kind: CrmKind, select: readonly string[], filter: unknown[]) =>
    portal().call(`crm.${TYPES[kind].type}.list`, {
      select,
      filter,
      order: { id: "ASC" },
      pagination: { limit: PAGE, offset: 0 },
    })

  return {
    provider: "bitrix24",
    traits: { kinds: ["organization", "person", "deal", "lead"], removedInChanges: false },
    self: () => portal().userId,
    pipelines: (kind) => bitrixPipelines(portal(), kind),
    async changes<K extends CrmKind>(kind: K, cursor: string | null, page?: string, context?: CrmCallContext) {
      const since = cursor === null ? null : Date.parse(cursor)
      if (since !== null && Number.isNaN(since)) return { reset: true } as CrmChanges<CrmRecords[K]>
      const { after, started } = pageOf(page, now())
      const assignees = assigneesOf(kind, context)
      const defined = await custom(kind)
      // Only a full round is filtered: a round of changes reads every assignee's, so core sees a deal given away.
      const filter = [
        ...(after ? [["id", ">", after]] : []),
        ...(since === null
          ? assignees
            ? [["assignedById", "in", assignees]]
            : []
          : [["updatedTime", ">=", portalTime(since - OVERLAP_MS)]]),
      ]
      const rows = rowsOf(
        (await list(kind, [...TYPES[kind].select, ...defined.map(({ code }) => code)], filter)).result,
      )
      const items = rows.map((raw) => mapped(kind, raw, defined)) as CrmRecords[K][]
      const last = id(rows.at(-1)?.id)
      // An empty page ends the round, not a short one: a portal that caps pages below PAGE still lists every row.
      if (last !== null) return { items, nextPage: `${last}@${started}` }
      return { items, cursor: new Date(started).toISOString() }
    },
    // Every id, whatever the scope: core narrows from the stored assignees, so the pass finds only real deletions.
    async ids(kind, page): Promise<CrmIdPage> {
      const after = Number(page) || 0
      const rows = rowsOf((await list(kind, ["id"], after ? [["id", ">", after]] : [])).result)
      const ids = rows.map((raw) => id(raw.id)).filter((one): one is string => one !== null)
      const last = ids.at(-1)
      return last === undefined ? { ids } : { ids, nextPage: last }
    },
    async item(kind, externalId) {
      const defined = await custom(kind)
      const answer = await portal().call(`crm.${TYPES[kind].type}.get`, {
        id: Number(externalId),
        select: [...TYPES[kind].select, ...defined.map(({ code }) => code)],
      })
      const raw = (answer.result as { item?: Raw })?.item
      if (!raw) throw new CliError("not_found", `the portal has no ${kind} ${externalId}`)
      return mapped(kind, raw, defined) as CrmItem
    },
    fields,
  }
}
