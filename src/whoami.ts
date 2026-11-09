import { isCliError } from "@wirecat/cli-base"
import type { BitrixCaller, BitrixTransport } from "./bitrix/transport.js"
import { fieldOf, rawsOf } from "./crm/values.js"

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "")

/** Who may copy every deal and lead: a portal administrator, or the head of a department. */
export interface Role {
  manager: boolean
  /** Why: `admin`, `head`, or `employee`; `employee` also when the webhook may not read departments. */
  as: "admin" | "head" | "employee"
  /** Set when the role was read without the `department` scope, so a head reads as an employee. */
  missing?: "department"
}

/**
 * REST has no method that reads a user's CRM access level, so a manager is who the portal itself names: `user.admin`
 * (apidocs user-admin) or `department.get` filtered by `UF_HEAD` (apidocs department-get). Unknown is an employee.
 */
export const roleOf = async (portal: BitrixCaller, userId: string): Promise<Role> => {
  if ((await portal.call("user.admin")).result === true) return { manager: true, as: "admin" }
  try {
    const headed = rawsOf((await portal.call("department.get", { UF_HEAD: Number(userId) })).result)
    return headed.length ? { manager: true, as: "head" } : { manager: false, as: "employee" }
  } catch (error) {
    if (isCliError(error) && error.code === "permission_error")
      return { manager: false, as: "employee", missing: "department" }
    throw error
  }
}

/** Whose rights the webhook carries: it acts as the employee who made it, within that employee's access. */
export const webhookUser = async (portal: BitrixTransport) => {
  const user = (await portal.call("user.current")).result
  const id = String(fieldOf(user, "ID") ?? "")
  const role = await roleOf(portal, id)
  const name = [text(fieldOf(user, "NAME")), text(fieldOf(user, "LAST_NAME"))].filter(Boolean).join(" ")
  return { id, name: name || null, admin: role.as === "admin", manager: role.manager }
}
