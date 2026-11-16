import type { CrmDepartment, CrmUser } from "@wirecat/cli-core"
import { crmValues } from "@wirecat/cli-core/crm"
import type { BitrixCaller } from "../bitrix/transport.js"
import { rest2Rows } from "./rows.js"
import { fullName, type Raw, yes } from "./values.js"

const { id, ids, text } = crmValues

/** REST 2's upper-case user fields (https://apidocs.bitrix24.com/api-reference/user/user-fields.html). */
export const toCrmUser = (raw: Raw): CrmUser => ({
  externalId: id(raw.ID) ?? "",
  name: fullName(raw.NAME, raw.LAST_NAME),
  position: text(raw.WORK_POSITION),
  active: yes(raw.ACTIVE),
  // A field the webhook's scope lacks is left out of the answer (apidocs user-scope): unknown, not empty.
  ...("EMAIL" in raw ? { email: text(raw.EMAIL) } : {}),
  ...(Array.isArray(raw.UF_DEPARTMENT) ? { departments: ids(raw.UF_DEPARTMENT) } : {}),
})

const userRows = (portal: BitrixCaller, filter: Record<string, unknown>) =>
  rest2Rows(portal, "user.get", { FILTER: filter, sort: "ID", order: "ASC" })

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
