export type RestVersion = 2 | 3
export type Effect = "read" | "write" | "destructive"

export interface Method {
  name: string
  api: RestVersion
  effect: Effect
  scope: string
}

/**
 * The CRM objects REST 3.0 serves (`crm.<type>.<action>`, apidocs "REST 3.0 items", 2026-11-05). Pipelines, lead
 * stages, products and users stay on REST 2: lead stages have no REST 3.0 method yet, and one path for all stages
 * keeps the outcome rule in one place.
 */
const REST3_TYPES = /^crm\.(deal|lead|contact|company|mycompany|quote|smartinvoice|smartprocess\d+)\./
/** `crm.<type>.userfield.*` is REST 2 only; REST 3.0's own is `crm.<type>.field.custom.*`. */
const REST2_ONLY = /^crm\.[a-z]+\.userfield\./

const READ_ACTIONS = new Set(["list", "get", "fields", "current", "search", "aggregate", "admin", "access"])
/** Reads whose names end in no read action. */
const READ_METHODS = new Set(["profile", "methods", "scope", "server.time", "app.info"])

/** `markdeleted` moves a Drive file or folder to the bin (apidocs disk.file.markdeleted). */
const DESTRUCTIVE = new Set(["delete", "deletefieldvalue", "markdeleted"])

const effectOf = (name: string): Effect => {
  const action = name.slice(name.lastIndexOf(".") + 1)
  if (DESTRUCTIVE.has(action)) return "destructive"
  if (READ_ACTIONS.has(action) || READ_METHODS.has(name) || name.endsWith(".field.list")) return "read"
  return "write"
}

/**
 * A method's first word to its scope, as each method's page in apidocs.bitrix24.com names it (2026-11-09). The two
 * differ (`tasks.task.add` is in `task`), so a word not listed here gives `unknown`, never a guess.
 */
const SCOPES = new Map([
  ["crm", "crm"],
  ["user", "user"],
  ["catalog", "catalog"],
  ["task", "task"],
  ["tasks", "task"],
  ["department", "department"],
  ["im", "im"],
  ["calendar", "calendar"],
])
/** In scope `basic` (apidocs common/users: user-admin, user-access; common/system). */
const BASIC = new Set(["user.admin", "user.access", ...READ_METHODS])

export const scopeOf = (name: string): string =>
  BASIC.has(name) ? "basic" : (SCOPES.get(name.slice(0, name.indexOf("."))) ?? "unknown")

/** Which REST version answers a method, what it does, and its scope; unknown methods go to REST 2, the older API. */
export const methodOf = (name: string): Method => ({
  name,
  api: REST3_TYPES.test(name) && !REST2_ONLY.test(name) ? 3 : 2,
  effect: effectOf(name),
  scope: scopeOf(name),
})

/** Methods `b24`'s own commands call; `api list` starts from them. */
export const KNOWN_METHODS: readonly Method[] = [
  ...["deal", "lead", "contact", "company"].flatMap((type) =>
    ["list", "get", "add", "update", "delete", "field.list", "userfield.list"].map((action) =>
      methodOf(`crm.${type}.${action}`),
    ),
  ),
  ...["crm.item.list", "crm.category.list", "crm.status.list", "crm.product.list", "crm.product.get"].map(methodOf),
  ...["user.current", "user.get", "user.admin", "department.get", "crm.mycompany.basic.list"].map(methodOf),
]
