import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { CliError, resolvePaths } from "@wirecat/cli-base"
import type { Meeting, MeetingDetails } from "@wirecat/cli-core/meetings"
import type { MessageStore } from "@wirecat/cli-core/store"
import { IDENTITY } from "../identity.js"

export const REGISTER = "telephony.externalcall.register"
export const FINISH = "telephony.externalcall.finish"

/** The fields `register` takes, as its apidocs page lists them; `CRM_CREATE`, `SHOW` and `ADD_TO_CHAT` are always 0. */
export interface RegisterFields {
  USER_ID: number
  PHONE_NUMBER: string
  TYPE: 1 | 2
  CALL_START_DATE: string
  CRM_CREATE: 0
  CRM_ENTITY_TYPE: "CONTACT"
  CRM_ENTITY_ID: number
  SHOW: 0
  ADD_TO_CHAT: 0
  EXTERNAL_CALL_ID: string
}

export interface FinishFields {
  USER_ID: number
  DURATION: number
  STATUS_CODE: "200" | "304" | "486" | "OTHER"
  ADD_TO_CHAT: 0
}

export interface PlannedCall {
  meeting: number
  /** The store's key of the call, which the ledger keeps: provider, account and the provider's own id. */
  key: string
  register: RegisterFields
  finish: FinishFields
}

export interface SkippedCall {
  meeting: number
  reason: string
}

/**
 * A call written once: `register` gave `call_id`; `finished_at` is absent until `finish` went through. A row with no
 * `call_id` is a `register` whose answer never came: it may be on the portal, so it is never sent again.
 */
export interface LedgerRow {
  call_id: string | null
  registered_at: string
  finished_at?: string
  activity_id?: number | null
}

export interface Ledger {
  get(key: string): LedgerRow | undefined
  put(key: string, row: LedgerRow): Promise<void>
  drop(key: string): Promise<void>
}

/**
 * Bitrix24 merges a second `register` only within 30 minutes (apidocs register, "Features of Re-registration"), so b24
 * keeps its own list of the calls it wrote, one file per portal: two profiles on one portal write a call once.
 */
export const ledgerPath = (env: NodeJS.ProcessEnv, host: string): string =>
  join(
    resolvePaths({ appName: IDENTITY.appName, prefix: IDENTITY.envPrefix, env }).state,
    "calls-export",
    `${host.replace(/[^A-Za-z0-9.-]/g, "_")}.json`,
  )

export const openLedger = async (path: string): Promise<Ledger> => {
  let rows: Record<string, LedgerRow> = {}
  try {
    rows = JSON.parse(await readFile(path, "utf8")) as Record<string, LedgerRow>
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT")
      throw new CliError("conflict", `the list of calls already written to Bitrix24 cannot be read: ${path}`, {
        reason: "calls-export.ledger-unreadable",
      })
  }
  const save = async () => {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 })
    await writeFile(`${path}.partial`, `${JSON.stringify(rows, null, 2)}\n`, { mode: 0o600 })
    await rename(`${path}.partial`, path)
  }
  return {
    get: (key) => rows[key],
    put: async (key, row) => {
      rows = { ...rows, [key]: row }
      await save()
    },
    drop: async (key) => {
      const { [key]: _, ...rest } = rows
      rows = rest
      await save()
    },
  }
}

const number = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null)
const word = (value: unknown) => (typeof value === "string" ? value.toLowerCase().replace(/\s+/g, "_") : null)

/** pbx keeps Asterisk's disposition, b24 its own outcome: both read as the codes `finish` takes. */
const statusOf = (metadata: Meeting["metadata"]): FinishFields["STATUS_CODE"] => {
  const said = word(metadata?.outcome) ?? word(metadata?.disposition)
  if (said === "answered") return "200"
  if (said === "no_answer") return "304"
  if (said === "busy") return "486"
  return "OTHER"
}

const talkSecondsOf = (meeting: Meeting, status: string) => {
  if (status !== "200") return 0
  const { metadata } = meeting
  const ms = number(metadata?.talkMs) ?? number(metadata?.answeredMs) ?? meeting.durationMs ?? 0
  return Math.round(ms / 1000)
}

const idsOn = (
  person: Awaited<ReturnType<MessageStore["people"]["personByUid"]>>,
  host: string,
  kind: "contact" | "user",
) => {
  const pattern = new RegExp(`^${host.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/${kind}/(\\d+)$`)
  const ids = (person?.identities ?? [])
    .filter((one) => one.provider === "bitrix24")
    .map((one) => pattern.exec(one.id)?.[1])
    .filter((one): one is string => one !== undefined)
  return [...new Set(ids)].map(Number)
}

const uidOf = (ref: string | null | undefined) => (ref ? ref.replace(/^person:/, "") : null)

export interface PlanOptions {
  /** The portal's host: the contact and the employee are this portal's. */
  host: string
  since?: number
  /** Only this stored call. */
  meeting?: number
  /** Write onto this contact, whatever the call's client is linked to. */
  contact?: number
  /** With `contact`: the number sent instead of the caller's, since Bitrix24 also looks for CRM records by number. */
  phone?: string
}

/**
 * The stored calls of other phone systems that can land on a contact of this portal: the client linked to exactly one
 * contact, the employee to one portal user. Bitrix24's own calls are already there. A call that cannot is skipped
 * with the reason, never guessed.
 */
export const planCalls = async (
  store: Pick<MessageStore, "meetings" | "people" | "accounts">,
  options: PlanOptions,
): Promise<{ planned: PlannedCall[]; skipped: SkippedCall[] }> => {
  const calls = (
    await store.meetings.meetings({
      ...(options.meeting === undefined ? {} : { ids: [options.meeting] }),
      ...(options.since === undefined ? {} : { since: options.since }),
    })
  ).filter((one) => one.direction && one.deletedAt === null)
  const planned: PlannedCall[] = []
  const skipped: SkippedCall[] = []
  for (const call of calls.sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0))) {
    const owner = await store.meetings.account(call.accountId)
    const provider = owner?.provider ?? "unknown"
    const skip = (reason: string) => skipped.push({ meeting: call.id, reason })
    if (provider === "bitrix24" && options.contact === undefined) {
      skip("a Bitrix24 call: it is in Bitrix24 already")
      continue
    }
    const details = (await store.meetings.meeting(call.id)) as MeetingDetails
    const client = details.participants.find((one) => one.role === "client")
    const phone = options.phone ?? call.clientPhone ?? null
    if (!phone) {
      skip("the client's number is not known")
      continue
    }
    const contacts =
      options.contact === undefined
        ? idsOn(client?.person ? await store.people.personByUid(client.person.uid) : undefined, options.host, "contact")
        : [options.contact]
    if (contacts.length !== 1) {
      skip(contacts.length ? "the client is linked to several contacts" : "the client is linked to no contact")
      continue
    }
    const managerUid = uidOf(call.manager?.person)
    const users = idsOn(managerUid ? await store.people.personByUid(managerUid) : undefined, options.host, "user")
    if (users.length !== 1) {
      skip(users.length ? "the employee is linked to several portal users" : "the employee is linked to no portal user")
      continue
    }
    const userId = users[0] as number
    const status = statusOf(call.metadata)
    planned.push({
      meeting: call.id,
      key: `${provider}:${owner?.account ?? call.accountId}:${call.externalId}`,
      register: {
        USER_ID: userId,
        PHONE_NUMBER: phone,
        TYPE: call.direction === "in" ? 2 : 1,
        CALL_START_DATE: new Date(call.startedAt ?? call.createdAt).toISOString(),
        CRM_CREATE: 0,
        CRM_ENTITY_TYPE: "CONTACT",
        CRM_ENTITY_ID: contacts[0] as number,
        SHOW: 0,
        ADD_TO_CHAT: 0,
        EXTERNAL_CALL_ID: `wirecat:${provider}:${call.externalId}`,
      },
      finish: { USER_ID: userId, DURATION: talkSecondsOf(call, status), STATUS_CODE: status, ADD_TO_CHAT: 0 },
    })
  }
  return { planned, skipped }
}

export interface LogReport {
  exported: { meeting: number; call_id: string; activity_id: number | null }[]
  already_exported: number
  skipped: SkippedCall[]
  failed: { meeting: number; reason: string; message: string }[]
}

type Send = (method: string, body: Record<string, unknown>) => Promise<Record<string, unknown>>

/**
 * Each planned call: `register`, then `finish`, the ledger written after each, so a run stopped between the two
 * finishes that call next time and never registers it again.
 */
export const logCalls = async (
  plan: { planned: PlannedCall[]; skipped: SkippedCall[] },
  ledger: Ledger,
  send: Send,
  now: () => Date = () => new Date(),
): Promise<LogReport> => {
  const report: LogReport = { exported: [], already_exported: 0, skipped: plan.skipped, failed: [] }
  for (const call of plan.planned) {
    let row = ledger.get(call.key)
    if (row?.finished_at) {
      report.already_exported++
      continue
    }
    try {
      if (row && !row.call_id) {
        report.failed.push({
          meeting: call.meeting,
          reason: "calls-export.outcome-unknown",
          message: `an earlier run sent this call and got no answer; check the contact in Bitrix24, then drop its line from the list of written calls`,
        })
        continue
      }
      if (!row) {
        await ledger.put(call.key, { call_id: null, registered_at: now().toISOString() })
        let registered: Record<string, unknown>
        try {
          registered = await send(REGISTER, { ...call.register })
        } catch (error) {
          // Refused, so not on the portal: the next run may send it again. Without an answer it may be there.
          if (!(error instanceof CliError && error.code === "outcome_unknown")) await ledger.drop(call.key)
          throw error
        }
        const callId = registered.CALL_ID
        if (typeof callId !== "string" || !callId)
          throw new CliError("invalid_response", "Bitrix24 registered the call but gave no CALL_ID", {
            reason: "calls-export.no-call-id",
          })
        row = { call_id: callId, registered_at: now().toISOString() }
        await ledger.put(call.key, row)
      }
      const callId = row.call_id as string
      const finished = await send(FINISH, { CALL_ID: callId, ...call.finish })
      const activity = Number(finished.CRM_ACTIVITY_ID)
      row = { ...row, finished_at: now().toISOString(), activity_id: Number.isSafeInteger(activity) ? activity : null }
      await ledger.put(call.key, row)
      report.exported.push({ meeting: call.meeting, call_id: callId, activity_id: row.activity_id ?? null })
    } catch (error) {
      if (error instanceof CliError && ["cancelled", "permission_error", "outcome_unknown"].includes(error.code))
        throw error
      report.failed.push({
        meeting: call.meeting,
        reason: error instanceof CliError ? String(error.details.reason ?? error.code) : "unexpected",
        message: error instanceof CliError ? error.message : "the call could not be written to Bitrix24",
      })
    }
  }
  return report
}
