import { crmValues } from "@wirecat/cli-core"
import type { BitrixCaller, BitrixTransport } from "../bitrix/transport.js"
import { rest3Rows } from "./rows.js"

const { id, ids } = crmValues

const PAGE = 500

/** The contacts and companies named on the deals and leads of these users; with `since`, only on those changed since. */
export const clientsOf = async (caller: BitrixCaller, assignees: readonly number[], since?: string) => {
  const clients = { contact: new Set<string>(), company: new Set<string>() }
  for (const type of ["deal", "lead"]) {
    const { items } = await rest3Rows(
      caller,
      `crm.${type}.list`,
      {
        select: ["id", "companyId", "contactId", "contactsId"],
        filter: [["assignedById", "in", assignees], ...(since ? [["updatedTime", ">=", since]] : [])],
        order: { id: "ASC" },
      },
      PAGE,
    )
    for (const raw of items) {
      for (const one of [id(raw.contactId), ...ids(raw.contactsId)]) if (one) clients.contact.add(one)
      const company = id(raw.companyId)
      if (company) clients.company.add(company)
    }
  }
  return clients
}

const admins = new WeakMap<BitrixTransport, Promise<boolean>>()
/** REST names no CRM role, so an administrator is the only user the portal itself puts above these rules. */
export const isAdmin = (portal: BitrixTransport): Promise<boolean> => {
  let found = admins.get(portal)
  if (!found) {
    found = portal.call("user.admin").then(({ result }) => result === true)
    admins.set(portal, found)
  }
  return found
}
