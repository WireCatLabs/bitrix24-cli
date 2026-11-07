import { CliError, isCliError } from "@wirecat/cli-base"
import type { CrmField, CrmItem, CrmKind, CrmOrganization, CrmPerson, CrmRecords } from "@wirecat/cli-core"
import type { CrmChanges, CrmIdPage, CrmSource } from "@wirecat/cli-core/crm"
import type { BitrixTransport } from "../bitrix/transport.js"
import { DEAL } from "./deal.js"
import { loadFields, metadataOf } from "./fields.js"
import type { ItemType } from "./items.js"
import { LEAD } from "./lead.js"
import { ORGANIZATION } from "./organization.js"
import { PERSON } from "./person.js"
import { bitrixPipelines } from "./pipelines.js"
import { portalDepartments, portalUsers } from "./user.js"
import { contacts, customFields, fullName, id, ids, type Metadata, portalTime, type Raw, text } from "./values.js"
import { walk } from "./walk.js"

/**
 * Re-read before the last cursor: rows the portal saved while the round ran, and this computer's clock running ahead
 * of the portal's. A row read twice is only saved twice.
 */
const OVERLAP_MS = 10 * 60_000
const PAGE = 500
/** `crm.mycompany.basic.list`'s default page; the docs name no larger one. */
const MY_PAGE = 50

const TYPES: Record<CrmKind, ItemType<unknown>> = {
  deal: DEAL as ItemType<unknown>,
  lead: LEAD as ItemType<unknown>,
  person: PERSON as ItemType<unknown>,
  organization: ORGANIZATION as ItemType<unknown>,
}

/** `companiesId` lists the contact's companies, the primary one first (apidocs fields-contact). */
const toPerson = (raw: Raw): CrmPerson => ({
  externalId: id(raw.id) ?? "",
  name: fullName(raw.name, raw.secondName, raw.lastName),
  email: contacts(raw.email)[0]?.value ?? null,
  phone: contacts(raw.phone)[0]?.value ?? null,
  position: text(raw.post),
  ...(Array.isArray(raw.companiesId)
    ? { organizations: ids(raw.companiesId).map((externalId, at) => ({ externalId, primary: at === 0 })) }
    : {}),
})

const toOrganization = (raw: Raw, metadata?: Metadata): CrmOrganization => ({
  externalId: id(raw.id) ?? "",
  name: text(raw.title) ?? "",
  url: text(raw.url),
  type: text(raw.typeId),
  ...(metadata ? { metadata } : {}),
})

const rowsOf = (result: unknown): Raw[] => {
  const items = (result as { items?: unknown })?.items
  return Array.isArray(items) ? (items as Raw[]) : []
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
 * event feed, and a list of every id to find deletions.
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
  /**
   * The account's own companies, which `crm.company.list` never returns. `basic.list` needs no CRM admin right, but
   * filters only by `=` and `in`, so it is read whole by offset, at the end of every round of companies.
   */
  const ownCompanies = async (): Promise<CrmOrganization[]> => {
    const { items } = await walk({ offset: 0 }, MY_PAGE, async (offset, limit) => {
      const answer = await portal().call("crm.mycompany.basic.list", {
        select: ["id", "title"],
        order: { id: "ASC" },
        pagination: { limit, offset },
      })
      const rows = rowsOf(answer.result)
      return { rows, more: rows.length === limit }
    })
    return items.flatMap((raw) => {
      const externalId = id(raw.id)
      return externalId ? [{ externalId, name: text(raw.title) ?? "", own: true }] : []
    })
  }
  /** REST 3.0 gives a lead no field for the deal it became; the deal names its lead in `leadId` (apidocs fields-deal). */
  const dealsOf = async (leads: readonly string[]): Promise<Map<string, string>> => {
    const found = new Map<string, string>()
    if (!leads.length) return found
    const { items } = await walk({ offset: 0 }, PAGE, async (offset, limit) => {
      const answer = await portal().call("crm.deal.list", {
        select: ["id", "leadId"],
        filter: [["leadId", "in", leads.map(Number)]],
        order: { id: "ASC" },
        pagination: { limit, offset },
      })
      const rows = rowsOf(answer.result)
      return { rows, more: rows.length === limit }
    })
    for (const raw of items) {
      const lead = id(raw.leadId)
      const deal = id(raw.id)
      if (lead && deal && !found.has(lead)) found.set(lead, deal)
    }
    return found
  }

  return {
    provider: "bitrix24",
    traits: { kinds: ["organization", "person", "deal", "lead"], removedInChanges: false },
    pipelines: (kind) => bitrixPipelines(portal(), kind),
    async changes<K extends CrmKind>(kind: K, cursor: string | null, page?: string) {
      const since = cursor === null ? null : Date.parse(cursor)
      if (since !== null && Number.isNaN(since)) return { reset: true } as CrmChanges<CrmRecords[K]>
      const { after, started } = pageOf(page, now())
      const defined = await custom(kind)
      const filter = [
        ...(after ? [["id", ">", after]] : []),
        ...(since === null ? [] : [["updatedTime", ">=", portalTime(since - OVERLAP_MS)]]),
      ]
      const rows = rowsOf(
        (await list(kind, [...TYPES[kind].select, ...defined.map(({ code }) => code)], filter)).result,
      )
      let items = rows.map((raw) => mapped(kind, raw, defined)) as CrmRecords[K][]
      if (kind === "lead") {
        const deals = await dealsOf((items as CrmItem[]).map(({ externalId }) => externalId))
        items = (items as CrmItem[]).map((lead) => {
          const deal = deals.get(lead.externalId)
          return deal ? { ...lead, deal } : lead
        }) as CrmRecords[K][]
      }
      const last = id(rows.at(-1)?.id)
      // An empty page ends the round, not a short one: a portal that caps pages below PAGE still lists every row.
      if (last !== null) return { items, nextPage: `${last}@${started}` }
      if (kind === "organization") items = [...items, ...((await ownCompanies()) as CrmRecords[K][])]
      return { items, cursor: new Date(started).toISOString() }
    },
    async ids(kind, page): Promise<CrmIdPage> {
      const after = Number(page) || 0
      const rows = rowsOf((await list(kind, ["id"], after ? [["id", ">", after]] : [])).result)
      const listed = rows.map((raw) => id(raw.id)).filter((one): one is string => one !== null)
      const last = listed.at(-1)
      if (last !== undefined) return { ids: listed, nextPage: last }
      // The id pass marks deleted whatever this list leaves out, so the own companies are in it too.
      if (kind === "organization") return { ids: (await ownCompanies()).map(({ externalId }) => externalId) }
      return { ids: listed }
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
    users: () => portalUsers(portal()),
    departments: () => portalDepartments(portal()),
  }
}
