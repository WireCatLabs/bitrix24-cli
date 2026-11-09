import { CliError } from "@wirecat/cli-base"
import type { CrmDepartment, CrmUser } from "@wirecat/cli-core"
import * as v from "valibot"
import type { BitrixCaller } from "../bitrix/transport.js"
import { type Condition, rest2Filter } from "./conditions.js"
import { fullName, id, ids, numericId, type Raw, rawsOf, text, yes } from "./values.js"
import { rest2Rows, type Window } from "./walk.js"

/** An employee of the portal: who a record is assigned to. */
export const userSchema = v.strictObject({
  id: v.string(),
  name: v.nullable(v.string()),
  email: v.nullable(v.string()),
  position: v.nullable(v.string()),
  active: v.boolean(),
  department_ids: v.array(v.string()),
})

export type User = v.InferOutput<typeof userSchema>

export const USER_FIELDS = {
  name: { field: "NAME_SEARCH", kind: "text" },
  active: { field: "ACTIVE", kind: "text" },
} as const

/** REST 2's upper-case user fields (https://apidocs.bitrix24.com/api-reference/user/user-fields.html). */
export const fromBitrixUser = (raw: Raw): User => ({
  id: id(raw.ID) ?? "",
  name: fullName(raw.NAME, raw.LAST_NAME),
  email: text(raw.EMAIL),
  position: text(raw.WORK_POSITION),
  active: yes(raw.ACTIVE),
  department_ids: ids(raw.UF_DEPARTMENT),
})

/**
 * `user.get` filters by whole values: `=NAME_SEARCH` is its own search over the name fields
 * (https://apidocs.bitrix24.com/api-reference/user/user-get.html).
 */
const userFilter = (conditions: readonly Condition[]) => {
  const filter = rest2Filter(conditions)
  const renamed: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(filter))
    renamed[key.replace(/^=/, "")] = key === "=ACTIVE" ? value === "true" : value
  return renamed
}

const userRows = (portal: BitrixCaller, filter: Record<string, unknown>, window?: Window) =>
  rest2Rows(portal, "user.get", { FILTER: filter, sort: "ID", order: "ASC" }, window)

export const listUsers = async (portal: BitrixCaller, conditions: readonly Condition[], window: Window) => {
  const { items, has_more } = await userRows(portal, userFilter(conditions), window)
  return { items: items.map(fromBitrixUser), has_more }
}

export const getUser = async (portal: BitrixCaller, reference: string): Promise<User> => {
  const answer = await portal.call("user.get", { FILTER: { ID: numericId(reference, "a user's id") } })
  const found = rawsOf(answer.result)[0]
  if (!found) throw new CliError("not_found", `there is no user ${reference}`)
  return fromBitrixUser(found)
}

export const toCrmUser = (raw: Raw): CrmUser => {
  const user = fromBitrixUser(raw)
  return {
    externalId: user.id,
    name: user.name,
    position: user.position,
    active: user.active,
    // A field the webhook's scope lacks is left out of the answer (apidocs user-scope): unknown, not empty.
    ...("EMAIL" in raw ? { email: user.email } : {}),
    ...(Array.isArray(raw.UF_DEPARTMENT) ? { departments: user.department_ids } : {}),
  }
}

/** Every employee, those who left too, so core can withdraw what a departed one held. */
export const portalUsers = async (portal: BitrixCaller): Promise<CrmUser[]> =>
  (await userRows(portal, { USER_TYPE: "employee" })).items.map(toCrmUser).filter(({ externalId }) => externalId !== "")

/** The ids of the portal's working employees: `ACTIVE` leaves out the dismissed (apidocs user-get). */
export const activeEmployees = async (portal: BitrixCaller): Promise<Set<string>> =>
  new Set(
    (await userRows(portal, { USER_TYPE: "employee", ACTIVE: true })).items
      .map((raw) => id(raw.ID))
      .filter((one): one is string => one !== null),
  )

export const portalDepartments = async (portal: BitrixCaller): Promise<CrmDepartment[]> =>
  (await rest2Rows(portal, "department.get", { sort: "ID", order: "ASC" })).items.flatMap((raw) => {
    const externalId = id(raw.ID)
    return externalId
      ? [{ externalId, name: text(raw.NAME) ?? externalId, parent: id(raw.PARENT), head: id(raw.UF_HEAD) }]
      : []
  })
