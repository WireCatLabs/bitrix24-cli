import { CliError, isCliError } from "@wirecat/cli-base"
import type { CrmField, CrmItem, CrmKind, CrmOrganization, CrmPerson, CrmRecords } from "@wirecat/cli-core"
import type { CrmCallContext, CrmChanges, CrmIdPage, CrmSource } from "@wirecat/cli-core/crm"
import type { BitrixCaller, BitrixTransport } from "../bitrix/transport.js"
import { type Role, roleOf } from "../whoami.js"
import { DEAL } from "./deal.js"
import { loadFields, metadataOf } from "./fields.js"
import type { ItemType } from "./items.js"
import { LEAD } from "./lead.js"
import { ORGANIZATION } from "./organization.js"
import { NO_MEMORY, type OwnMemory } from "./own-memory.js"
import { PERSON } from "./person.js"
import { bitrixPipelines } from "./pipelines.js"
import { activeEmployees, portalDepartments, portalUsers } from "./user.js"
import {
  contacts,
  customFields,
  fieldOf,
  fullName,
  id,
  ids,
  isRaw,
  type Metadata,
  portalTime,
  type Raw,
  text,
} from "./values.js"
import { rest3Rows } from "./walk.js"

/**
 * Re-read before the last cursor: rows the portal saved while the round ran, and this computer's clock running ahead
 * of the portal's. A row read twice is only saved twice.
 */
const OVERLAP_MS = 10 * 60_000
const PAGE = 500
/** `crm.mycompany.basic.list`'s default page; the docs name no larger one. */
const MY_PAGE = 50

const TYPES: Record<CrmKind, Pick<ItemType<unknown>, "type" | "select">> = {
  deal: DEAL,
  lead: LEAD,
  person: PERSON,
  organization: ORGANIZATION,
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

/** A list answer without `items` is refused: read as an empty page, it would end the round and empty an id pass. */
const listedRows = (result: unknown): Raw[] => {
  const items = (result as { items?: unknown })?.items
  if (!Array.isArray(items)) throw new CliError("invalid_response", "the portal answered a list without its items")
  return items as Raw[]
}

/**
 * The responsible users a `mine` scope keeps, as numbers for the portal's filter; core has checked and normalised
 * them. A Bitrix24 deal or lead always has one, the creator by default, so the portal has no unassigned items.
 */
const assigneesOf = (context?: CrmCallContext): number[] | null => {
  const scope = context?.scope
  if (scope?.mode !== "mine") return null
  // A malformed stored entry reads no deal in core; for clients it only narrows the list, never fails the round.
  return [...new Set([scope.self, ...scope.also].map(Number))].filter(Number.isFinite)
}

type ClientKind = "person" | "organization"
const isClient = (kind: CrmKind): kind is ClientKind => kind === "person" || kind === "organization"

/**
 * A full round of clients under `mine` reads two lists: the ones assigned to the user, by id after `<last id>`, then
 * the clients of the user's deals and leads, `PAGE` ids at a time from `l<index>`.
 */
const LINKED = "l"

const MAPPERS: { [K in CrmKind]: (raw: Raw, metadata?: Metadata) => CrmRecords[K] } = {
  deal: DEAL.map,
  lead: LEAD.map,
  person: (raw) => toPerson(raw),
  organization: toOrganization,
}

/** `<last id>@<when the round started>`: keyset paging by id, so a row changed mid-round never shifts the rest. */
const pageOf = (page: string | undefined, now: number) => {
  const [at, started] = (page ?? "").split("@")
  const linked = at?.startsWith(LINKED) ? Number(at.slice(LINKED.length)) || 0 : null
  return { after: linked === null ? Number(at) || 0 : 0, linked, started: Number(started) || now }
}

export interface BitrixCrmSource extends CrmSource {
  /** One deal or lead as the portal holds it now, custom fields included: what a write answers. */
  item(kind: "deal" | "lead", externalId: string): Promise<CrmItem>
  /** The portal's custom fields of a kind, read once per source. */
  fields(kind: CrmKind, context?: CrmCallContext): Promise<CrmField[]>
}

/**
 * The portal's CRM for core's sync: REST 3.0 lists by id with `updatedTime` for changes, since a webhook gets no
 * event feed, and a list of every id to find deletions. A `mine` scope limits a full round by `assignedById`.
 */
export const bitrixCrmSource = (
  portal: () => BitrixTransport,
  now: () => number = Date.now,
  own: OwnMemory = NO_MEMORY,
  /** The stored `scope` setting and its key: `all` is an administrator's, and a sync for anyone else is refused. */
  asked: () => Promise<{ mode: "mine" | "all"; setting: string }> = async () => ({ mode: "mine", setting: "scope" }),
): BitrixCrmSource => {
  /** The portal for one call of core's: core paid for its first request, each further one is spent from the budget. */
  const metered = (context?: CrmCallContext): BitrixCaller => {
    let paid = false
    return {
      call: (method, params, options) => {
        if (paid) context?.spend()
        paid = true
        return portal().call(method, params, options)
      },
    }
  }
  let role: Promise<Role> | undefined
  const roleNow = () => (role ??= roleOf(portal(), portal().userId))
  const loaded = new Map<CrmKind, Promise<CrmField[]>>()
  const fields = (kind: CrmKind, caller: BitrixCaller = portal()) => {
    let found = loaded.get(kind)
    if (!found) {
      // A webhook without the rights to read field definitions still syncs its records, with no definitions. Any
      // other failure fails the sync rather than mark every stored definition deleted over a passing fault.
      found = loadFields(caller, TYPES[kind].type).catch((error: unknown) => {
        if (isCliError(error) && error.code === "permission_error") return []
        throw error
      })
      loaded.set(kind, found)
    }
    return found
  }
  // core's CrmPerson has no metadata, so a contact's values are not read; its definitions still are, for `fields list`.
  const custom = async (kind: CrmKind, caller: BitrixCaller) => (kind === "person" ? [] : await fields(kind, caller))
  const mapped = <K extends CrmKind>(kind: K, raw: Raw, defined: readonly CrmField[]): CrmRecords[K] => {
    const values = customFields(raw)
    return MAPPERS[kind](raw, Object.keys(values).length ? metadataOf(values, defined) : undefined)
  }
  const list = (caller: BitrixCaller, kind: CrmKind, select: readonly string[], filter: unknown[]) =>
    caller.call(`crm.${TYPES[kind].type}.list`, {
      select,
      filter,
      order: { id: "ASC" },
      pagination: { limit: PAGE, offset: 0 },
    })
  /**
   * The account's own companies, which `crm.company.list` never returns. `basic.list` needs no CRM admin right, but
   * filters only by `=` and `in`, so it is read whole by offset, at the end of every round of companies. A portal that
   * refuses it, or lacks it, still syncs its client companies and their deletions; its own companies are a gap.
   */
  const ownCompanies = async (caller: BitrixCaller, context?: CrmCallContext): Promise<CrmOrganization[] | null> => {
    let rows: Raw[]
    try {
      rows = (
        await rest3Rows(caller, "crm.mycompany.basic.list", { select: ["id", "title"], order: { id: "ASC" } }, MY_PAGE)
      ).items
    } catch (error) {
      if (!isCliError(error) || (error.code !== "permission_error" && error.code !== "not_found")) throw error
      const scope = error.details?.scope
      context?.gap({
        kind: "organization",
        message:
          `the portal did not list its own companies (${error.code}): users are nobody's employees, and the own ` +
          "companies stored before are kept, never taken for deleted",
        ...(typeof scope === "string" ? { scope } : {}),
      })
      return null
    }
    const found = rows.flatMap((raw) => {
      const externalId = id(raw.id)
      return externalId ? [{ externalId, name: text(raw.title) ?? "", own: true }] : []
    })
    own.write(found.map(({ externalId }) => externalId))
    return found
  }
  /** REST 3.0 gives a lead no field for the deal it became; the deal names its lead in `leadId` (apidocs fields-deal). */
  const dealsOf = async (caller: BitrixCaller, leads: readonly string[]): Promise<Map<string, string>> => {
    const found = new Map<string, string>()
    if (!leads.length) return found
    const { items } = await rest3Rows(
      caller,
      "crm.deal.list",
      { select: ["id", "leadId"], filter: [["leadId", "in", leads.map(Number)]], order: { id: "ASC" } },
      PAGE,
    )
    for (const raw of items) {
      const lead = id(raw.leadId)
      const deal = id(raw.id)
      if (lead && deal && !found.has(lead)) found.set(lead, deal)
    }
    return found
  }
  /**
   * The clients a `mine` scope may copy besides the ones assigned to the user: the contacts and companies named on the
   * user's deals and leads. Contacts or companies that are no one's client stay on the portal, so a copy is never the
   * whole client base. Read once per round of a kind.
   */
  const rounds = new Map<string, Promise<Record<ClientKind, Set<string>>>>()
  const clientsOf = (caller: BitrixCaller, assignees: readonly number[], started: number) => {
    const key = `${assignees.join(",")}@${started}`
    let found = rounds.get(key)
    if (!found) {
      found = (async () => {
        const clients = { person: new Set<string>(), organization: new Set<string>() }
        for (const type of [DEAL.type, LEAD.type]) {
          const { items } = await rest3Rows(
            caller,
            `crm.${type}.list`,
            {
              select: ["id", "companyId", "contactId", "contactsId"],
              filter: [["assignedById", "in", assignees]],
              order: { id: "ASC" },
            },
            PAGE,
          )
          for (const raw of items) {
            for (const one of [id(raw.contactId), ...ids(raw.contactsId)]) if (one) clients.person.add(one)
            const company = id(raw.companyId)
            if (company) clients.organization.add(company)
          }
        }
        return clients
      })()
      rounds.set(key, found)
    }
    return found
  }
  const mineOnly = (raw: Raw, assignees: readonly number[], linked: Set<string>) =>
    assignees.includes(Number(raw.assignedById)) || linked.has(id(raw.id) ?? "")
  /** What a page gets beyond its rows: each lead its deal, and the last page of companies the own ones. */
  const completed: {
    [K in CrmKind]: (
      items: CrmRecords[K][],
      caller: BitrixCaller,
      ended: boolean,
      context?: CrmCallContext,
    ) => Promise<CrmRecords[K][]>
  } = {
    deal: async (items) => items,
    person: async (items) => items,
    lead: async (leads, caller) => {
      const deals = await dealsOf(
        caller,
        leads.map(({ externalId }) => externalId),
      )
      return leads.map((lead) => {
        const deal = deals.get(lead.externalId)
        return deal ? { ...lead, deal } : lead
      })
    },
    organization: async (items, caller, ended, context) =>
      ended ? [...items, ...((await ownCompanies(caller, context)) ?? [])] : items,
  }

  return {
    provider: "bitrix24",
    traits: { kinds: ["organization", "person", "deal", "lead"], removedInChanges: false },
    // Checked on every sync, not when the setting is made: an administrator who stops being one stops copying all.
    async self() {
      const self = portal().userId
      const { mode, setting } = await asked()
      if (mode !== "all") return self
      if ((await roleNow()).as === "admin") return self
      throw new CliError(
        "configuration_error",
        `${setting} is all, and user ${self} is no Bitrix24 administrator: only an administrator copies the whole ` +
          `CRM. "config set ${setting} mine" copies your own deals and leads, the unassigned ones, and their clients`,
        { setting, reason: "bitrix.scope-all-admin-only" },
      )
    },
    // The owner's rule: an employee counts as nobody's only a dismissed user or one who is no employee (extranet,
    // e-mail, bot); a manager may name anyone. Asked at every sync, so someone rehired leaves the list.
    async unassigned(users) {
      if ((await roleNow()).manager) return { kept: [...users] }
      let active: Set<string>
      try {
        active = await activeEmployees(portal())
      } catch (error) {
        if (!isCliError(error) || error.code !== "permission_error") throw error
        return {
          kept: [],
          message: "the webhook lacks the user scope, so none can be told apart from a working employee",
        }
      }
      return {
        kept: users.filter((user) => !active.has(user)),
        message:
          "a working employee of the portal; only a Bitrix24 administrator or a department head may count one as " +
          "nobody's, anyone else only a dismissed user or one who is not an employee",
      }
    },
    pipelines: (kind, context) => bitrixPipelines(metered(context), kind),
    async changes<K extends CrmKind>(
      kind: K,
      cursor: string | null,
      page?: string,
      context?: CrmCallContext,
    ): Promise<CrmChanges<CrmRecords[K]>> {
      const since = cursor === null ? null : Date.parse(cursor)
      if (since !== null && Number.isNaN(since)) return { reset: true }
      const caller = metered(context)
      const { after, linked, started } = pageOf(page, now())
      const assignees = assigneesOf(context)
      const clients = assignees && isClient(kind) ? (await clientsOf(caller, assignees, started))[kind] : null
      const defined = await custom(kind, caller)
      const select = [...TYPES[kind].select, ...defined.map(({ code }) => code)]
      const finish = async (rows: Raw[], ended: boolean) =>
        completed[kind](
          rows.map((raw) => mapped(kind, raw, defined)),
          caller,
          ended,
          context,
        )
      if (linked !== null && clients) {
        const chunk = [...clients].slice(linked, linked + PAGE)
        const rows = chunk.length
          ? listedRows((await list(caller, kind, select, [["id", "in", chunk.map(Number)]])).result)
          : []
        const ended = linked + PAGE >= clients.size
        const items = await finish(rows, ended)
        return ended
          ? { items, cursor: new Date(started).toISOString() }
          : { items, nextPage: `${LINKED}${linked + PAGE}@${started}` }
      }
      // A round of changes reads every assignee's deals, so core sees a deal given away; clients are kept here.
      const filter = [
        ...(after ? [["id", ">", after]] : []),
        ...(since === null
          ? assignees
            ? [["assignedById", "in", assignees]]
            : []
          : [["updatedTime", ">=", portalTime(since - OVERLAP_MS)]]),
      ]
      const rows = listedRows((await list(caller, kind, select, filter)).result)
      const last = id(rows.at(-1)?.id)
      const kept =
        clients && assignees && since !== null ? rows.filter((raw) => mineOnly(raw, assignees, clients)) : rows
      // An empty page ends the round, not a short one: a portal that caps pages below PAGE still lists every row.
      // Every round ends with the named clients: a deal given to the user brings a client whose row did not change.
      if (last === null && clients) return { items: await finish(kept, false), nextPage: `${LINKED}0@${started}` }
      const items = await finish(kept, last === null)
      return last !== null
        ? { items, nextPage: `${last}@${started}` }
        : { items, cursor: new Date(started).toISOString() }
    },
    // Under mine only the user's own and their clients: core marks deleted what the pass leaves out of the copy.
    async ids(kind, page, context): Promise<CrmIdPage> {
      const caller = metered(context)
      const after = Number(page) || 0
      const assignees = assigneesOf(context)
      const filter = [...(after ? [["id", ">", after]] : []), ...(assignees ? [["assignedById", "in", assignees]] : [])]
      const rows = listedRows((await list(caller, kind, ["id"], filter)).result)
      const listed = rows.map((raw) => id(raw.id)).filter((one): one is string => one !== null)
      const last = listed.at(-1)
      if (last !== undefined) return { ids: listed, nextPage: last }
      if (kind !== "organization") return { ids: listed }
      const linked = assignees ? [...(await clientsOf(caller, assignees, now())).organization] : []
      // The id pass marks deleted whatever this list leaves out: refused, the own companies last listed stand in (WC-DATA-7).
      return { ids: [...linked, ...((await ownCompanies(caller))?.map(({ externalId }) => externalId) ?? own.read())] }
    },
    async item(kind, externalId) {
      const defined = await custom(kind, portal())
      const answer = await portal().call(`crm.${TYPES[kind].type}.get`, {
        id: Number(externalId),
        select: [...TYPES[kind].select, ...defined.map(({ code }) => code)],
      })
      const raw = fieldOf(answer.result, "item")
      if (!isRaw(raw)) throw new CliError("not_found", `the portal has no ${kind} ${externalId}`)
      return mapped(kind, raw, defined)
    },
    fields: (kind, context) => fields(kind, metered(context)),
    async users(context) {
      const users = await portalUsers(metered(context))
      // user.get leaves out a field the scope does not cover, without an error (apidocs user-scope).
      if (users.length && users.every((user) => !("email" in user)))
        context?.gap({
          kind: "users",
          scope: "user_basic",
          message: "user_basic scope missing: employees have no e-mail, so they won't join their mail identity",
        })
      return users
    },
    departments: (context) => portalDepartments(metered(context)),
  }
}
