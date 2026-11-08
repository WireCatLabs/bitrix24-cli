import type { BitrixTransport } from "./bitrix/transport.js"
import { fieldOf } from "./crm/values.js"

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "")

/** Whose rights the webhook carries: it acts as the employee who made it, within that employee's access. */
export const webhookUser = async (portal: BitrixTransport) => {
  const user = (await portal.call("user.current")).result
  const admin = (await portal.call("user.admin")).result === true
  const name = [text(fieldOf(user, "NAME")), text(fieldOf(user, "LAST_NAME"))].filter(Boolean).join(" ")
  return { id: String(fieldOf(user, "ID") ?? ""), name: name || null, admin }
}
