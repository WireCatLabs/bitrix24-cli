import { readFileSync } from "node:fs"
import { join } from "node:path"
import { CliError, resolvePaths, writeSecurely } from "@wirecat/cli-base"
import type { BitrixCaller, BitrixTransport } from "../bitrix/transport.js"
import { IDENTITY } from "../identity.js"
import { id, ids, type Raw } from "./values.js"
import { rest3Rows } from "./walk.js"

const PAGE = 500

/** The owner's rule (NEED-2487): a user sees at most this many contacts' or companies' phones and e-mails a day. */
export const DAILY_FOREIGN = 100

const CONTACT_DATA = ["phone", "email", "fm"]

export type ClientType = "contact" | "company"
export const isClientType = (type: string): type is ClientType => type === "contact" || type === "company"

/** The contacts and companies named on the deals and leads of these users. */
export const clientsOf = async (caller: BitrixCaller, assignees: readonly number[]) => {
  const clients = { contact: new Set<string>(), company: new Set<string>() }
  for (const type of ["deal", "lead"]) {
    const { items } = await rest3Rows(
      caller,
      `crm.${type}.list`,
      {
        select: ["id", "companyId", "contactId", "contactsId"],
        filter: [["assignedById", "in", assignees]],
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

const linked = new WeakMap<BitrixTransport, ReturnType<typeof clientsOf>>()
const isOwn = async (portal: BitrixTransport, type: ClientType, raw: Raw) => {
  if (String(raw.assignedById) === portal.userId) return true
  let found = linked.get(portal)
  if (!found) {
    found = clientsOf(portal, [Number(portal.userId)])
    linked.set(portal, found)
  }
  return (await found)[type].has(id(raw.id) ?? "")
}

/** A list of contacts or companies for anyone but an administrator: phones and e-mails only of the user's clients. */
export const withoutForeignContacts = async (portal: BitrixTransport, type: ClientType, rows: Raw[]) => {
  if (await isAdmin(portal)) return rows
  return Promise.all(
    rows.map(async (raw) =>
      (await isOwn(portal, type, raw))
        ? raw
        : Object.fromEntries(Object.entries(raw).filter(([key]) => !CONTACT_DATA.includes(key))),
    ),
  )
}

export const quotaFile = (env: NodeJS.ProcessEnv, portal: BitrixTransport): string =>
  join(
    resolvePaths({ appName: IDENTITY.appName, prefix: IDENTITY.envPrefix, env }).state,
    "crm",
    "foreign-contacts",
    `${new URL(portal.origin).hostname}-${portal.userId}.json`,
  )

interface Shown {
  day: string
  seen: string[]
}

const shownIn = (file: string, day: string): Shown => {
  try {
    const found = JSON.parse(readFileSync(file, "utf8")) as Partial<Shown>
    return found.day === day && Array.isArray(found.seen) ? { day, seen: found.seen.map(String) } : { day, seen: [] }
  } catch {
    return { day, seen: [] }
  }
}

/**
 * One contact or company with its phones and e-mails. Anyone but an administrator spends one of the day's
 * `DAILY_FOREIGN` on a record that is not their client; the same record again that day is free. The day is UTC's.
 */
export const spendOnForeign = async (
  portal: BitrixTransport,
  type: ClientType,
  raw: Raw,
  file: string,
  now: number = Date.now(),
) => {
  if ((await isAdmin(portal)) || (await isOwn(portal, type, raw))) return
  const key = `${type}:${id(raw.id)}`
  const shown = shownIn(file, new Date(now).toISOString().slice(0, 10))
  if (shown.seen.includes(key)) return
  if (shown.seen.length >= DAILY_FOREIGN)
    throw new CliError(
      "permission_error",
      `${DAILY_FOREIGN} contacts and companies that are not your clients were shown today, the most a day; ` +
        "your own clients are not counted, and a Bitrix24 administrator has no limit",
      { limit: DAILY_FOREIGN },
    )
  writeSecurely(file, JSON.stringify({ ...shown, seen: [...shown.seen, key] }), 0o600)
}
