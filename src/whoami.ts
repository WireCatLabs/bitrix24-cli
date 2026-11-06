import type { BitrixTransport } from "./bitrix/transport.js"

interface CurrentUser {
  ID?: unknown
  NAME?: unknown
  LAST_NAME?: unknown
}

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "")

/** Whose rights the webhook carries: it acts as the employee who made it, within that employee's access. */
export const webhookUser = async (portal: BitrixTransport) => {
  const user = (await portal.call("user.current")).result as CurrentUser
  const admin = (await portal.call("user.admin")).result === true
  const name = [text(user?.NAME), text(user?.LAST_NAME)].filter(Boolean).join(" ")
  return { id: String(user?.ID ?? ""), name: name || null, admin }
}
