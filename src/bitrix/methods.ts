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
const REST3_TYPES = /^crm\.(deal|lead|contact|company|quote|smartinvoice|smartprocess\d+)\./
/** `crm.<type>.userfield.*` is REST 2 only; REST 3.0's own is `crm.<type>.field.custom.*`. */
const REST2_ONLY = /^crm\.[a-z]+\.userfield\./

const READ_ACTIONS = new Set(["list", "get", "fields", "current", "search", "aggregate", "admin", "access"])
/** Reads whose names end in no read action. */
const READ_METHODS = new Set(["profile", "methods", "scope", "server.time", "app.info"])

const effectOf = (name: string): Effect => {
  const action = name.slice(name.lastIndexOf(".") + 1)
  if (action === "delete" || action === "deletefieldvalue") return "destructive"
  if (READ_ACTIONS.has(action) || READ_METHODS.has(name) || name.endsWith(".field.list")) return "read"
  return "write"
}

const scopeOf = (name: string) => {
  const first = name.slice(0, name.indexOf("."))
  return first === "crm" || first === "user" || first === "catalog" || first === "task" ? first : "basic"
}

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
  ...["user.current", "user.get", "user.admin"].map(methodOf),
]
