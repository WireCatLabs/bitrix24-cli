import { CliError, isCliError } from "@wirecat/cli-base"
import type { CrmField, CrmItem, CrmKind, CrmOrganization, CrmRecords, CrmValue } from "@wirecat/cli-core"
import {
  type CrmCallContext,
  type CrmChanges,
  type CrmCondition,
  type CrmIdPage,
  type CrmLiveKind,
  type CrmSource,
  crmValues,
  crmWindowOf,
} from "@wirecat/cli-core/crm"
import type { BitrixCaller, BitrixTransport } from "../bitrix/transport.js"
import { type Role, roleOf } from "../whoami.js"
import { type ActivityOwners, ownersOf, readActivities } from "./activities.js"
import { isAdmin, clientsOf as namedClients } from "./clients.js"
import type { Condition } from "./conditions.js"
import { DEAL, fromBitrixDeal } from "./deal.js"
import { loadFields } from "./fields.js"
import { type ItemType, listedRows } from "./items.js"
import { fromBitrixLead, LEAD } from "./lead.js"
import { ORGANIZATION, toOrganization } from "./organization.js"
import { NO_MEMORY, type OwnMemory } from "./own-memory.js"
import { PERSON, toPerson } from "./person.js"
import { bitrixPipelines } from "./pipelines.js"
import { rest3Rows } from "./rows.js"
import { readStageHistory } from "./stage-history.js"
import { activeEmployees, portalDepartments, portalUsers } from "./user.js"
import { customFields, numericId, portalTime, type Raw } from "./values.js"

const { crmValuesOf, fieldOf, id, isRaw, text } = crmValues

/**
 * Re-read before the last cursor: rows the portal saved while the round ran, and this computer's clock running ahead
 * of the portal's. A row read twice is only saved twice.
 */
const OVERLAP_MS = 10 * 60_000
const OWNERS_KEPT_MS = 60 * 60_000
const PAGE = 500
/** `crm.mycompany.basic.list`'s default page; the docs name no larger one. */
const MY_PAGE = 50

const TYPES: Record<CrmKind, ItemType> = {
  deal: DEAL,
  lead: LEAD,
  person: PERSON,
  organization: ORGANIZATION,
}

/** A list answer without `items` is refused: read as an empty page, it would end the round and empty an id pass. */
const itemsOf = (result: unknown): Raw[] => {
  const items = (result as { items?: unknown })?.items
  if (!Array.isArray(items)) throw new CliError("invalid_response", "the portal answered a list without its items")
  return items as Raw[]
}

/**
 * The users whose deals a `mine` scope copies: the ones chosen in `unassigned` that core kept, else the signed-in user.
 * The owner's ruling (2026-11-12): a copy is the signed-in person's own by default; a chosen list, which leaves that
 * user out unless named, is for working on someone else's portal.
 */
const chosenOf = (scope: { self: string; also: readonly string[] }) => (scope.also.length ? scope.also : [scope.self])

/** The responsible users a `mine` scope keeps, as numbers for the portal's filter. */
const assigneesOf = (context?: CrmCallContext): number[] | null => {
  const scope = context?.scope
  if (scope?.mode !== "mine") return null
  // A malformed stored entry reads no deal in core; for clients it only narrows the list, never fails the round.
  return [...new Set(chosenOf(scope).map(Number))].filter(Number.isFinite)
}

/** Core keeps the webhook's own user in every `mine` scope; their rows stay out unless they are among the chosen. */
const unchosen = (context: CrmCallContext | undefined, raw: Raw) => {
  const scope = context?.scope
  return scope?.mode === "mine" && !chosenOf(scope).includes(scope.self) && String(raw.assignedById) === scope.self
}

/**
 * A contact in the copy that a round of changes saw is no longer the user's (given to a colleague, or off the user's
 * deals) is saved again with its new assignee and no phones or e-mails, so the next narrowing or `--rescan` removes it: cli-core
 * removes contacts only then, since they have no id pass. Until then it keeps the one phone and e-mail cli-core holds
 * beside the lists, which a save without them leaves.
 */
const givenAway = (raw: Raw): Raw => ({ ...raw, phone: [], email: [] })

type ClientKind = "person" | "organization"
const isClient = (kind: CrmKind): kind is ClientKind => kind === "person" || kind === "organization"

/**
 * A full round of clients under `mine` reads two lists: the ones assigned to the user, by id after `<last id>`, then
 * the clients of the user's deals and leads, `PAGE` ids at a time from `l<index>`.
 */
const LINKED = "l"

const MAPPERS: { [K in CrmKind]: (raw: Raw, metadata?: Record<string, CrmValue>) => CrmRecords[K] } = {
  deal: fromBitrixDeal,
  lead: fromBitrixLead,
  person: toPerson,
  organization: toOrganization,
}

/** The shared names a live list filters by, in REST 3.0's (apidocs fields-contact, fields-company). */
export const LIVE_FIELDS: Record<CrmLiveKind, Readonly<Record<string, string>>> = {
  person: { assigned_to: "assignedById", created_at: "createdTime", updated_at: "updatedTime" },
  organization: { type: "typeId", assigned_to: "assignedById", created_at: "createdTime", updated_at: "updatedTime" },
}
const TIMES = new Set(["created_at", "updated_at"])
/** `field.list` types a list field as `int`, and REST 3.0 checks a value's type against the field's. */
const NUMBERS = new Set(["integer", "double"])

const typed = (field: CrmField, value: string | number): string | number => {
  const number = Number(value)
  const numeric = field.options !== undefined || NUMBERS.has(field.type)
  return numeric && String(value).trim() !== "" && Number.isFinite(number) ? number : value
}

/** core's conditions in Bitrix24's names and value types: an id and an option as a number, a time as the portal's. */
const liveConditions = (kind: CrmLiveKind, conditions: readonly CrmCondition[], defined: readonly CrmField[]) =>
  conditions.map(({ field, op, value }): Condition => {
    const each = (convert: (one: string | number) => string | number): Condition["value"] =>
      Array.isArray(value) ? value.map(convert) : convert(value)
    const own = LIVE_FIELDS[kind][field]
    if (own === undefined) {
      const custom = defined.find((one) => one.code === field)
      if (!custom)
        throw new CliError("validation_error", `the portal cannot filter by ${field}`, {
          reason: "query.unsupported-field",
        })
      return { field, op, value: each((one) => typed(custom, one)) }
    }
    if (TIMES.has(field)) return { field: own, op, value: each((one) => portalTime(Number(one))) }
    if (field === "assigned_to") return { field: own, op, value: each((one) => numericId(String(one), field)) }
    return { field: own, op, value }
  })

/** A record the webhook's employee may not open is one this sign-in cannot see: `get` answers null. */
const unseen = (error: unknown) =>
  isCliError(error) &&
  (error.code === "not_found" || (error.code === "permission_error" && error.details.reason === "bitrix.access-denied"))

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
  /** The stored `scope` setting, its key and the chosen users' key: a sync under `all` is refused. */
  asked: () => Promise<{
    mode: "mine" | "all"
    setting: string
    chosen: string
  }> = async () => ({
    mode: "mine",
    setting: "scope",
    chosen: "unassigned",
  }),
  copy: {
    /** The definitions the last sync stored: a live read uses them, and reads the portal's only before the first sync. */
    fields?: (kind: CrmKind) => Promise<CrmField[]>
    /** Which of these contacts the copy holds. */
    contacts?: (externalIds: readonly string[]) => Promise<ReadonlySet<string>>
  } = {},
): BitrixCrmSource => {
  let role: Promise<Role> | undefined
  const roleNow = () => (role ??= roleOf(portal(), portal().userId))
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
  const known = async (kind: CrmKind, caller: BitrixCaller) => {
    const found = (await copy.fields?.(kind)) ?? []
    return found.length ? found : await fields(kind, caller)
  }
  // The copy keeps no contact's custom values, so a sync reads none; a live read and a write's answer do.
  const custom = async (kind: CrmKind, caller: BitrixCaller) => (kind === "person" ? [] : await fields(kind, caller))
  const mapped = <K extends CrmKind>(kind: K, raw: Raw, defined: readonly CrmField[]): CrmRecords[K] => {
    const values = customFields(raw)
    return MAPPERS[kind](raw, Object.keys(values).length ? crmValuesOf(values, defined) : undefined)
  }
  const selectOf = (kind: CrmKind, defined: readonly CrmField[]) => [
    ...TYPES[kind].select,
    ...defined.map(({ code }) => code),
  ]
  let clients: ReturnType<typeof namedClients> | undefined
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
   * whole client base. With `since`, only those on the deals and leads changed since then.
   *
   * Reading them lists every deal and lead of the users: a hundred requests on a large portal. The rounds of contacts
   * and companies start minutes apart, so the second reuses the first's list; a deal given to the user in between
   * still brings its client, as a changed deal, at the next sync.
   */
  const lists = new Map<string, { at: number; found: Promise<Record<ClientKind, Set<string>>> }>()
  const clientsOf = (caller: BitrixCaller, assignees: readonly number[], started: number, since?: number) => {
    const key = since === undefined ? assignees.join(",") : `${assignees.join(",")}>${since}`
    const kept = lists.get(key)
    if (kept && Math.abs(started - kept.at) < OVERLAP_MS) return kept.found
    const found = namedClients(
      caller,
      assignees,
      since === undefined ? undefined : portalTime(since - OVERLAP_MS),
    ).then(({ contact, company }) => ({ person: contact, organization: company }))
    lists.set(key, { at: started, found })
    return found
  }
  /** The deals and leads whose activities a round reads, listed once for all its pages. */
  const owned = new Map<string, { at: number; found: Promise<ActivityOwners> }>()
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
    // The owner's ruling (2026-11-10): a copy is never the whole portal, an administrator's included; another
    // client is found by a live read of the portal. A stored `all` fails the sync until the owner sets `mine`.
    async self() {
      const self = portal().userId
      const { mode, setting, chosen } = await asked()
      if (mode === "mine") return self
      throw new CliError(
        "configuration_error",
        `${setting} is all, and b24 never copies the whole CRM: "config set ${setting} mine" copies the deals and ` +
          `leads of the users you choose in ${chosen}, and their clients. Find any other client on ` +
          'the portal with "people list" or "organizations list"',
        { setting, reason: "bitrix.scope-all-refused" },
      )
    },
    // The owner chooses whose deals the copy holds. An administrator may choose anyone; anyone else themselves, a
    // dismissed user or one who is no employee (extranet, e-mail, bot), so no one takes a colleague's clients that way.
    // Asked at every sync.
    async unassigned(users) {
      const self = portal().userId
      if ((await roleNow()).as === "admin") return { kept: [...users] }
      let active: Set<string>
      try {
        active = await activeEmployees(portal())
      } catch (error) {
        if (!isCliError(error) || error.code !== "permission_error") throw error
        return {
          kept: users.filter((user) => Number(user) === Number(self)),
          message: "the webhook lacks the user scope, so none can be told apart from a working colleague",
        }
      }
      return {
        kept: users.filter((user) => Number(user) === Number(self) || !active.has(user)),
        message:
          "a working colleague; only a Bitrix24 administrator may choose one, anyone else themselves, a dismissed user " +
          "or a non-employee",
      }
    },
    pipelines: (kind, context) => bitrixPipelines(metered(context), kind),
    stageHistory: (kind, since, after, context) => readStageHistory(metered(context), kind, since, after, context),
    // `<page>@<when the round started>`, as `changes` does: a round spread over runs must end with its first page's
    // time, or the next round's `since` skips what changed while it ran.
    async activities(since, page, context) {
      const caller = metered(context)
      const [at, begun] = (page ?? "").split("@")
      const started = Number(begun) || now()
      const assignees = assigneesOf(context)
      const owners = assignees
        ? () => {
            const key = assignees.join(",")
            const kept = owned.get(key)
            // A list renewed mid-round would shift the groups the page cursor counts, so it lasts a long round.
            if (kept && Math.abs(started - kept.at) < OWNERS_KEPT_MS) return kept.found
            const found = ownersOf(caller, assignees)
            found.catch(() => owned.delete(key))
            owned.set(key, { at: started, found })
            return found
          }
        : undefined
      const read = await readActivities(caller, started, since, at || undefined, context, owners)
      return read.hasMore ? { ...read, nextCursor: `${read.nextCursor}@${started}` } : read
    },
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
      if (assignees?.length === 0) {
        // Every chosen id is malformed: nothing to read, and no `in []` to send. Every round of companies still ends
        // with the account's own ones.
        const items = await completed[kind]([], caller, true, context)
        return { items, hasMore: false, cursor: new Date(started).toISOString() }
      }
      const clients = assignees && isClient(kind) ? (await clientsOf(caller, assignees, started))[kind] : null
      // A client whose row did not change is already in the copy unless a changed deal or lead now names it.
      const named =
        assignees && isClient(kind) && since !== null
          ? (await clientsOf(caller, assignees, started, since))[kind]
          : clients
      const defined = await custom(kind, caller)
      const select = [...TYPES[kind].select, ...defined.map(({ code }) => code)]
      const finish = async (rows: Raw[], ended: boolean) =>
        completed[kind](
          rows.map((raw) => mapped(kind, raw, defined)),
          caller,
          ended,
          context,
        )
      if (linked !== null && named) {
        const chunk = [...named].slice(linked, linked + PAGE)
        const rows = chunk.length
          ? itemsOf((await list(caller, kind, select, [["id", "in", chunk.map(Number)]])).result)
          : []
        const ended = linked + PAGE >= named.size
        const items = await finish(rows, ended)
        return ended
          ? { items, hasMore: false, cursor: new Date(started).toISOString() }
          : { items, hasMore: true, nextCursor: `${LINKED}${linked + PAGE}@${started}` }
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
      const rows = itemsOf((await list(caller, kind, select, filter)).result)
      const last = id(rows.at(-1)?.id)
      const narrowed = clients && assignees && since !== null
      const kept = narrowed
        ? rows.filter((raw) => mineOnly(raw, assignees, clients))
        : rows.filter((raw) => !unchosen(context, raw))
      if (narrowed && kind === "person") {
        const gone = rows.filter((raw) => !mineOnly(raw, assignees, clients))
        const held = gone.length ? await copy.contacts?.(gone.map((raw) => id(raw.id) ?? "")) : undefined
        for (const raw of gone) if (held?.has(id(raw.id) ?? "")) kept.push(givenAway(raw))
      }
      // An empty page ends the round, not a short one: a portal that caps pages below PAGE still lists every row.
      // Every round ends with the named clients: a deal given to the user brings a client whose row did not change.
      if (last === null && clients)
        return { items: await finish(kept, false), hasMore: true, nextCursor: `${LINKED}0@${started}` }
      const items = await finish(kept, last === null)
      return last !== null
        ? { items, hasMore: true, nextCursor: `${last}@${started}` }
        : { items, hasMore: false, cursor: new Date(started).toISOString() }
    },
    // Under mine only the user's own and their clients: core marks deleted what the pass leaves out of the copy.
    async ids(kind, page, context): Promise<CrmIdPage> {
      const caller = metered(context)
      const after = Number(page) || 0
      const assignees = assigneesOf(context)
      if (assignees?.length === 0)
        return {
          hasMore: false,
          items:
            kind === "organization"
              ? ((await ownCompanies(caller))?.map(({ externalId }) => externalId) ?? own.read())
              : [],
        }
      const filter = [...(after ? [["id", ">", after]] : []), ...(assignees ? [["assignedById", "in", assignees]] : [])]
      const rows = itemsOf((await list(caller, kind, ["id"], filter)).result)
      const listed = rows.map((raw) => id(raw.id)).filter((one): one is string => one !== null)
      const last = listed.at(-1)
      if (last !== undefined) return { items: listed, hasMore: true, nextCursor: last }
      if (kind !== "organization") return { items: listed, hasMore: false }
      const linked = assignees ? [...(await clientsOf(caller, assignees, now())).organization] : []
      // The id pass marks deleted whatever this list leaves out: refused, the own companies last listed stand in (WC-DATA-7).
      return {
        hasMore: false,
        items: [...linked, ...((await ownCompanies(caller))?.map(({ externalId }) => externalId) ?? own.read())],
      }
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
    async list(kind, query, context) {
      const caller = metered(context)
      const defined = await known(kind, caller)
      const type = TYPES[kind]
      const conditions: Condition[] = [
        ...liveConditions(kind, query.conditions, defined),
        ...(query.text ? [{ field: type.words[0] ?? "title", op: "like" as const, value: query.text }] : []),
      ]
      const { items, hasMore } = await listedRows(caller, type, conditions, crmWindowOf(query), selectOf(kind, defined))
      return { items: items.map((raw) => mapped(kind, raw, defined)), hasMore }
    },
    async get(kind, externalId, context) {
      if (!/^[1-9]\d*$/.test(externalId)) return null
      const caller = metered(context)
      const defined = await known(kind, caller)
      let answer: Awaited<ReturnType<BitrixCaller["call"]>>
      try {
        answer = await caller.call(`crm.${TYPES[kind].type}.get`, {
          id: Number(externalId),
          select: selectOf(kind, defined),
        })
      } catch (error) {
        if (unseen(error)) return null
        throw error
      }
      const raw = fieldOf(answer.result, "item")
      return isRaw(raw) ? mapped(kind, raw, defined) : null
    },
    isAdmin: () => isAdmin(portal()),
    // A client on any of the user's deals or leads, listed once per source: a hundred requests on a large portal.
    async ownClients(kind, externalIds) {
      clients ??= namedClients(portal(), [Number(portal().userId)])
      const found = (await clients)[kind === "person" ? "contact" : "company"]
      return new Set(externalIds.filter((one) => found.has(one)))
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
