import { REST3_FIELDS } from "../crm/rest3-fields.js"
import { fakePortal, methodNotFound, ok, type PortalCall, type Reply } from "./fake-portal.js"

type Raw = Record<string, unknown>
type Type = keyof typeof REST3_FIELDS

const TYPES: readonly Type[] = ["deal", "lead", "contact", "company"]
const ENTITY_TYPES: Record<number, Type> = { 1: "lead", 2: "deal", 3: "contact", 4: "company" }

/** A custom field as `crm.<type>.field.list` and `crm.<type>.userfield.list` describe it; synthetic, never a portal's. */
interface CustomField {
  code: string
  title: string
  type: "string" | "enumeration"
  multiple?: boolean
  options?: { ID: string; VALUE: string }[]
}

const CUSTOM: Record<Type, CustomField[]> = {
  deal: [
    { code: "UF_CRM_SOURCE", title: "Source", type: "enumeration", options: [{ ID: "41", VALUE: "Website" }] },
    { code: "UF_CRM_NOTE", title: "Note", type: "string" },
    {
      code: "UF_CRM_TAGS",
      title: "Tags",
      type: "enumeration",
      multiple: true,
      options: [
        { ID: "61", VALUE: "Hot" },
        { ID: "62", VALUE: "Repeat" },
      ],
    },
  ],
  lead: [{ code: "UF_CRM_NOTE", title: "Note", type: "string" }],
  contact: [
    {
      code: "UF_CRM_CHANNEL",
      title: "Channel",
      type: "enumeration",
      multiple: true,
      options: [
        { ID: "51", VALUE: "Phone" },
        { ID: "52", VALUE: "Fair" },
      ],
    },
  ],
  company: [],
}

interface Status {
  ENTITY_ID: string
  STATUS_ID: string
  NAME: string
  SORT: number
  SEMANTICS: "P" | "S" | "F"
}

const STATUSES: Status[] = [
  { ENTITY_ID: "DEAL_STAGE", STATUS_ID: "NEW", NAME: "New", SORT: 10, SEMANTICS: "P" },
  { ENTITY_ID: "DEAL_STAGE", STATUS_ID: "PREPARATION", NAME: "Quote sent", SORT: 20, SEMANTICS: "P" },
  { ENTITY_ID: "DEAL_STAGE", STATUS_ID: "WON", NAME: "Won", SORT: 30, SEMANTICS: "S" },
  { ENTITY_ID: "DEAL_STAGE", STATUS_ID: "LOSE", NAME: "Lost", SORT: 40, SEMANTICS: "F" },
  { ENTITY_ID: "DEAL_STAGE", STATUS_ID: "APOLOGY", NAME: "Analysis of failure", SORT: 50, SEMANTICS: "F" },
  { ENTITY_ID: "DEAL_STAGE_1", STATUS_ID: "C1:NEW", NAME: "New", SORT: 10, SEMANTICS: "P" },
  { ENTITY_ID: "DEAL_STAGE_1", STATUS_ID: "C1:WON", NAME: "Won", SORT: 20, SEMANTICS: "S" },
  { ENTITY_ID: "STATUS", STATUS_ID: "NEW", NAME: "Unprocessed", SORT: 10, SEMANTICS: "P" },
  { ENTITY_ID: "STATUS", STATUS_ID: "IN_PROCESS", NAME: "In progress", SORT: 20, SEMANTICS: "P" },
  { ENTITY_ID: "STATUS", STATUS_ID: "CONVERTED", NAME: "Good lead", SORT: 30, SEMANTICS: "S" },
  { ENTITY_ID: "STATUS", STATUS_ID: "JUNK", NAME: "Junk", SORT: 40, SEMANTICS: "F" },
  // Another directory in the same list, which a stage list must leave out.
  { ENTITY_ID: "SOURCE", STATUS_ID: "WEB", NAME: "Website", SORT: 10, SEMANTICS: "P" },
]

const CATEGORIES = [
  { id: 0, name: "Example sales", sort: 100, isDefault: "Y" },
  { id: 1, name: "Example partners", sort: 200, isDefault: "N" },
]

/** REST 3.0's answer to a name it does not know: the whole call is refused (seen live 2026-11-06). */
const unknown = (name: string): Reply => ({
  status: 400,
  body: { error: { code: "BITRIX_REST_V3_EXCEPTION_UNKNOWNDTOPROPERTYEXCEPTION", message: `Unknown field ${name}` } },
})
const missing = (): Reply => ({
  status: 400,
  body: { error: { code: "BITRIX_REST_V3_EXCEPTION_ENTITYNOTFOUNDEXCEPTION", message: "Not found" } },
})
const invalid = (message: string): Reply => ({
  status: 400,
  body: { error: { code: "BITRIX_REST_V3_EXCEPTION_VALIDATIONEXCEPTION", message } },
})

/** What a live portal answered a time with milliseconds or `Z` in a filter (2026-11-07). */
const refusedValue = (): Reply => ({
  status: 400,
  body: { error: { code: "BITRIX_REST_V3_EXCEPTION_VALIDATION_REQUESTVALIDATIONEXCEPTION", message: "Invalid value" } },
})

const OPERATORS = new Set(["=", "!=", ">", ">=", "<", "<=", "in"])

const compare = (left: unknown, op: string, right: unknown) => {
  if (op === "in") return Array.isArray(right) && right.map(String).includes(String(left))
  const time = typeof right === "string" && /^\d{4}-\d{2}-\d{2}T/.test(right)
  const a = time ? Date.parse(String(left)) : typeof right === "number" ? Number(left) : String(left)
  const b = time ? Date.parse(right) : right
  if (op === "=") return a === b
  if (op === "!=") return a !== b
  if (op === ">") return (a as number) > (b as number)
  if (op === ">=") return (a as number) >= (b as number)
  if (op === "<") return (a as number) < (b as number)
  return (a as number) <= (b as number)
}

/** What a filter on a contact's `companiesId` gets (apidocs fields-contact: "currently returns INTERNAL_SERVER_ERROR"). */
const brokenFilter = (): Reply => ({
  status: 500,
  body: { error: { code: "INTERNAL_SERVER_ERROR", message: "Internal server error" } },
})

/** The scope each method needs, from the top of its page in the API reference. */
type Scope = "crm" | "user" | "department"
/** `user.admin` is in scope `basic`, which every webhook has (apidocs user-admin). */
const scopeOf = (method: string): Scope | null =>
  method === "user.admin"
    ? null
    : method.startsWith("user.")
      ? "user"
      : method.startsWith("department.")
        ? "department"
        : "crm"
/** REST 3.0 serves the CRM objects by type, but not their REST 2 `userfield` lists (apidocs rest-v3). */
const apiOf = (method: string): 2 | 3 =>
  /^crm\.(deal|lead|contact|company|mycompany)\./.test(method) && !/\.userfield\./.test(method) ? 3 : 2

/** A webhook without the method's scope: REST 2 answers 401, REST 3.0 403 (apidocs error-codes, rest-v3). */
const noScope = (api: 2 | 3): Reply =>
  api === 3
    ? {
        status: 403,
        body: { error: { code: "BITRIX_REST_V3_EXCEPTION_INSUFFICIENTSCOPEEXCEPTION", message: "Insufficient scope" } },
      }
    : {
        status: 401,
        body: {
          error: "insufficient_scope",
          error_description: "The request requires higher privileges than provided by the webhook token",
        },
      }

/** A REST 3.0 call the webhook's employee has no right to (apidocs rest-v3: HTTP 403). */
const accessDenied = (): Reply => ({
  status: 403,
  body: { error: { code: "BITRIX_REST_V3_EXCEPTION_ACCESSDENIEDEXCEPTION", message: "Access denied" } },
})

/** `crm.mycompany.basic.list` takes these and nothing else (apidocs crm-my-company-basic-list-rest-v3). */
const MY_SELECT = ["id", "title", "email", "phone", "requisites", "bankRequisites"]
const MY_FILTER = ["id", "title", "email.value", "phone.value"]
const MY_ORDER = ["id", "title"]

/** Portal time, with its own offset as Bitrix24 gives it. */
const portalTime = (ms: number) => new Date(ms + 3 * 3_600_000).toISOString().replace(/\.\d+Z$/, "+03:00")

/**
 * A portal's CRM held in memory, answering REST 3.0 `crm.<type>.*` and the REST 2 directories as the API reference
 * shows them, and refusing what the real one refuses: a name REST 3.0 does not document and a stage of another
 * pipeline. Like the live portal (2026-11-07), it ignores `Idempotency-Key`: a repeated write is made again. Never
 * real portal data.
 */
export const fakeCrm = (more: Parameters<typeof fakePortal>[0] = {}) => {
  const rows: Record<Type, Map<number, Raw>> = {
    deal: new Map(),
    lead: new Map(),
    contact: new Map(),
    company: new Map(),
  }
  let nextId = 100
  let clock = Date.UTC(2026, 0, 1)
  const tick = () => {
    clock += 1_000
    return portalTime(clock)
  }
  let lose = false
  let writes = 0
  const mine = new Map<number, Raw>()
  /** `user.get` and `department.get` rows, in the REST 2 shape: upper-case names, ids as strings. */
  const users = new Map<string, Raw>([
    [
      "7",
      {
        ID: "7",
        ACTIVE: true,
        NAME: "Example",
        LAST_NAME: "Owner",
        EMAIL: "owner@example.test",
        WORK_POSITION: "",
        UF_DEPARTMENT: [1],
        USER_TYPE: "employee",
      },
    ],
  ])
  const departments = new Map<string, Raw>([["1", { ID: "1", NAME: "Example company", SORT: 500, UF_HEAD: "7" }]])
  const withheld = new Set<Scope | "user_basic">()
  const denied = new Set<string>()

  const known = (type: Type, name: string) =>
    REST3_FIELDS[type].includes(name) || CUSTOM[type].some((field) => field.code === name)
  const firstUnknown = (type: Type, names: readonly string[]) => names.find((name) => !known(type, name))
  const stagesOf = (type: Type, row: Raw) =>
    STATUSES.filter((one) =>
      type === "lead"
        ? one.ENTITY_ID === "STATUS"
        : one.ENTITY_ID === (Number(row.categoryId ?? 0) === 0 ? "DEAL_STAGE" : `DEAL_STAGE_${row.categoryId}`),
    )

  /** The stage's semantics kept beside it, as REST 3.0 answers `stageSemanticId`. */
  const settle = (type: Type, row: Raw): Reply | undefined => {
    if (type !== "deal" && type !== "lead") return undefined
    const stages = stagesOf(type, row)
    if (stages.length === 0) return invalid(`no pipeline ${String(row.categoryId)}`)
    if (row.stageId === undefined) row.stageId = stages[0]?.STATUS_ID
    const stage = stages.find((one) => one.STATUS_ID === row.stageId)
    if (!stage) return invalid(`stage ${String(row.stageId)} is not in this pipeline`)
    row.stageSemanticId = stage.SEMANTICS
    return undefined
  }

  const selected = (row: Raw, select: readonly string[]) =>
    Object.fromEntries(select.filter((name) => name in row).map((name) => [name, row[name]]))

  /** One REST 3.0 write, counted, and lost on demand after it is made. */
  const writing = (act: () => Reply): Reply => {
    writes += 1
    const reply = act()
    if (lose) {
      lose = false
      return new TypeError("fetch failed: the connection was reset")
    }
    return reply
  }

  const methods: Record<string, (call: PortalCall) => Reply> = {}
  for (const type of TYPES) {
    methods[`crm.${type}.list`] = ({ body }) => {
      const select = (body.select ?? []) as string[]
      const filter = body.filter ?? []
      if (!Array.isArray(select) || select.length === 0) return invalid("select is required")
      if (!Array.isArray(filter)) return invalid("filter is an array of conditions")
      const bad = firstUnknown(type, [...select, ...(filter as unknown[][]).map((one) => String(one[0]))])
      if (bad) return unknown(bad)
      if (type === "contact" && (filter as unknown[][]).some((one) => one[0] === "companiesId")) return brokenFilter()
      if ((filter as unknown[][]).some((one) => !OPERATORS.has(String(one[1])))) return invalid("unknown operator")
      if (
        (filter as unknown[][]).some(
          (one) => typeof one[2] === "string" && /^\d{4}-\d{2}-\d{2}T.*(\.\d|Z$)/.test(one[2]),
        )
      )
        return refusedValue()
      const order = (body.order ?? {}) as Record<string, string>
      const badOrder = firstUnknown(type, Object.keys(order))
      if (badOrder) return unknown(badOrder)
      const { limit = 50, offset = 0 } = (body.pagination ?? {}) as { limit?: number; offset?: number }
      const found = [...rows[type].values()]
        .filter((row) =>
          (filter as unknown[][]).every(([field, op, value]) => compare(row[String(field)], String(op), value)),
        )
        .sort((a, b) => (Number(a.id) - Number(b.id)) * (order.id === "DESC" ? -1 : 1))
        .slice(offset, offset + Math.min(limit, 50))
      return ok({ items: found.map((row) => selected(row, select)) })
    }
    methods[`crm.${type}.get`] = ({ body }) => {
      const select = (body.select ?? []) as string[]
      const bad = firstUnknown(type, select)
      if (bad) return unknown(bad)
      const row = rows[type].get(Number(body.id))
      return row ? ok({ item: selected(row, select) }) : missing()
    }
    methods[`crm.${type}.add`] = (call) =>
      writing(() => {
        const fields = (call.body.fields ?? {}) as Raw
        const bad = firstUnknown(type, Object.keys(fields))
        if (bad) return unknown(bad)
        const at = tick()
        const row: Raw = { assignedById: 7, ...fields, id: nextId++, createdTime: at, updatedTime: at }
        const refused = settle(type, row)
        if (refused) return refused
        rows[type].set(Number(row.id), row)
        return ok({ id: row.id })
      })
    methods[`crm.${type}.update`] = (call) =>
      writing(() => {
        const fields = (call.body.fields ?? {}) as Raw
        const bad = firstUnknown(type, Object.keys(fields))
        if (bad) return unknown(bad)
        const row = rows[type].get(Number(call.body.id))
        if (!row) return missing()
        const next = { ...row, ...fields, updatedTime: tick() }
        const refused = settle(type, next)
        if (refused) return refused
        rows[type].set(Number(row.id), next)
        return ok({ result: true })
      })
    methods[`crm.${type}.delete`] = (call) =>
      writing(() => (rows[type].delete(Number(call.body.id)) ? ok({ result: true }) : missing()))
    methods[`crm.${type}.field.list`] = () =>
      ok({
        items: CUSTOM[type].map((field) => ({
          name: field.code,
          title: field.title,
          type: field.type === "enumeration" ? "int" : "string",
          multiple: field.multiple === true,
          filterable: true,
        })),
      })
    methods[`crm.${type}.userfield.list`] = () =>
      ok(
        CUSTOM[type].map((field) => ({
          FIELD_NAME: field.code,
          USER_TYPE_ID: field.type,
          ...(field.options ? { LIST: field.options } : {}),
        })),
      )
  }
  methods["crm.mycompany.basic.list"] = ({ body }) => {
    const select = (body.select ?? ["id", "title"]) as string[]
    const filter = (body.filter ?? []) as unknown[][]
    const bad =
      select.find((name) => !MY_SELECT.includes(name)) ??
      Object.keys(body.order ?? {}).find((name) => !MY_ORDER.includes(name))
    if (bad) return unknown(bad)
    if (
      filter.some(
        (one) => !MY_FILTER.includes(String(one[0])) || (one.length === 3 && one[1] !== "=" && one[1] !== "in"),
      )
    )
      return {
        status: 400,
        body: { error: { code: "BITRIX_REST_V3_EXCEPTION_INVALIDFILTEREXCEPTION", message: "Invalid filter" } },
      }
    const { limit = 50, offset = 0 } = (body.pagination ?? {}) as { limit?: number; offset?: number }
    const found = [...mine.values()]
      .filter((row) => filter.every(([field, op, value]) => compare(row[String(field)], String(op), value)))
      .sort((a, b) => Number(a.id) - Number(b.id))
      .slice(offset, offset + limit)
    return ok({ items: found.map((row) => selected(row, select)) })
  }
  /** REST 2 pages by 2 here, so a reader that stops at the first page loses rows. */
  const paged = (all: Raw[], start: number) =>
    ok(
      all.slice(start, start + 2),
      start + 2 < all.length ? { next: start + 2, total: all.length } : { total: all.length },
    )
  // REST 2's item read, which `show` asks for the custom fields: here the row's own `UF_` fields.
  methods["crm.item.get"] = ({ body }) => {
    const kind = ENTITY_TYPES[Number(body.entityTypeId)]
    const row = kind ? rows[kind].get(Number(body.id)) : undefined
    return row
      ? ok({ item: Object.fromEntries(Object.entries(row).filter(([key]) => key.startsWith("UF_"))) })
      : missing()
  }
  methods["user.get"] = ({ body }) => {
    const filter = (body.FILTER ?? {}) as Record<string, unknown>
    const all = [...users.values()]
      .filter(
        (row) =>
          (filter.ID === undefined || String(filter.ID) === row.ID) &&
          (filter.USER_TYPE === undefined || filter.USER_TYPE === row.USER_TYPE) &&
          (filter.ACTIVE !== true || row.ACTIVE === true),
      )
      .map((row) =>
        withheld.has("user_basic") ? Object.fromEntries(Object.entries(row).filter(([key]) => key !== "EMAIL")) : row,
      )
    return paged(all, Number(body.start ?? 0))
  }
  let admin = false
  methods["user.admin"] = () => ok(admin)
  // department.get filters by its upper-case fields given at the top level (apidocs department-get).
  methods["department.get"] = ({ body }) =>
    paged(
      [...departments.values()].filter((row) => body.UF_HEAD === undefined || String(body.UF_HEAD) === row.UF_HEAD),
      Number(body.start ?? 0),
    )
  methods["crm.category.list"] = () => ok({ categories: CATEGORIES })
  methods["crm.status.list"] = ({ body }) => {
    const directory = (body.filter as { ENTITY_ID?: string } | undefined)?.ENTITY_ID
    const start = Number(body.start ?? 0)
    const all = STATUSES.filter((one) => directory === undefined || one.ENTITY_ID === directory)
    // REST 2 pages by 2 here, so a reader that stops at the first page loses stages.
    const page = all.slice(start, start + 2)
    return ok(page, start + 2 < all.length ? { next: start + 2, total: all.length } : { total: all.length })
  }

  const answers = { ...methods, ...more }
  const answerOf = (name: string, call: PortalCall): Reply => {
    const entry = answers[name]
    if (typeof entry === "function") return entry(call)
    if (Array.isArray(entry)) return entry.shift() ?? { status: 500, body: { error: "EXHAUSTED" } }
    return entry as Reply
  }
  // A test's own answers go through the same version and scope checks as the fake's.
  const guarded = Object.fromEntries(
    Object.keys(answers).map((name) => [
      name,
      (call: PortalCall): Reply => {
        if (call.api !== apiOf(name)) return methodNotFound(call.api, name)
        const scope = scopeOf(name)
        if (scope && withheld.has(scope)) return noScope(call.api)
        return denied.has(name) ? accessDenied() : answerOf(name, call)
      },
    ]),
  )
  const portal = fakePortal(guarded)
  return {
    ...portal,
    /** Puts a row as the portal would hold it; `updatedTime` moves on, and the read-only main links follow the lists. */
    put(type: Type, fields: Raw): number {
      const at = tick()
      const row: Raw = { assignedById: 7, createdTime: at, ...fields, id: fields.id ?? nextId++, updatedTime: at }
      if (type === "contact" && Array.isArray(row.companiesId)) row.companyId = row.companiesId[0] ?? null
      if ((type === "deal" || type === "lead") && Array.isArray(row.contactsId))
        row.contactId = row.contactsId[0] ?? null
      const refused = settle(type, row)
      if (refused) throw new Error(`fake portal refused a row: ${JSON.stringify(refused)}`)
      rows[type].set(Number(row.id), row)
      return Number(row.id)
    },
    /** One of the account's own companies, which only `crm.mycompany.*` lists. */
    putMine(fields: Raw): number {
      const id = Number(fields.id ?? nextId++)
      mine.set(id, { ...fields, id })
      return id
    },
    putUser: (fields: Raw) => users.set(String(fields.ID), { ACTIVE: true, USER_TYPE: "employee", ...fields }),
    putDepartment: (fields: Raw) => departments.set(String(fields.ID), { SORT: 500, ...fields }),
    /** Whether `user.admin` answers true for the webhook's user. */
    setAdmin: (value: boolean) => {
      admin = value
    },
    /** The webhook loses a scope; `user_basic` leaves `user.get` without `EMAIL`, as a `user_brief` webhook gets. */
    withhold: (scope: Scope | "user_basic") => withheld.add(scope),
    /** The webhook's employee loses the right to one REST 3.0 method; `allow` gives it back. */
    deny: (method: string) => denied.add(method),
    allow: (method: string) => denied.delete(method),
    row: (type: Type, id: number) => rows[type].get(id),
    /** Sets the portal's clock, so a row put after a sync is newer than its cursor. */
    setClock: (ms: number) => {
      clock = ms
    },
    remove: (type: Type, id: number) => rows[type].delete(id),
    loseNextAnswer: () => {
      lose = true
    },
    writes: () => writes,
  }
}

/** A portal with one of each kind on it, every deal and lead in a listed stage. */
export const seededCrm = (more: Parameters<typeof fakePortal>[0] = {}) => {
  const crm = fakeCrm(more)
  crm.putMine({ id: 1, title: "Example own company" })
  const company = crm.put("company", { title: "Example Ltd" })
  const contact = crm.put("contact", {
    name: "Anna",
    lastName: "Example",
    email: [{ valueTypeId: "WORK", value: "anna@example.com" }],
  })
  crm.put("deal", {
    title: "Example kitchen",
    categoryId: 0,
    stageId: "PREPARATION",
    opportunity: 15000.5,
    currencyId: "EUR",
    companyId: company,
    contactsId: [contact],
    closeTime: "2026-12-01T00:00:00+03:00",
    UF_CRM_SOURCE: 41,
  })
  crm.put("deal", {
    title: "Example partner deal",
    categoryId: 1,
    stageId: "C1:NEW",
    opportunity: 0,
    currencyId: "RUB",
  })
  crm.put("lead", {
    title: "Example website form",
    stageId: "IN_PROCESS",
    opportunity: 300,
    currencyId: "USD",
    name: "Ivan",
    secondName: "",
    lastName: "Example",
    companyTitle: "Example Ltd",
  })
  return crm
}
