import { CliError, isCliError } from "@wirecat/cli-base"
import { e164Of } from "@wirecat/cli-core"
import type { MeetingSave, MeetingSource, SourceMeeting, SourceParticipant } from "@wirecat/cli-core/meetings"
import type { AccountKey } from "@wirecat/cli-core/store"
import type { BitrixCaller } from "../bitrix/transport.js"
import { portalTime } from "../crm/values.js"
import type { Recordings } from "./recordings.js"

export const STATISTIC = "voximplant.statistic.get"

/**
 * A call's row is written when the call ends, with its start time, so each sync reads again the three hours before
 * its cursor: a call still going on at the last sync is found the next time. Three hours is our choice.
 */
export const OVERLAP_MS = 3 * 60 * 60 * 1000

/** One row of `voximplant.statistic.get`, as the portal sends it: numbers come as strings. */
export interface CallRecord {
  ID: string
  CALL_ID: string
  PORTAL_USER_ID: string | number
  PORTAL_NUMBER?: string | null
  PHONE_NUMBER?: string | null
  CALL_TYPE: string | number
  CALL_DURATION?: string | number | null
  CALL_START_DATE: string
  CALL_FAILED_CODE?: string | null
  CALL_FAILED_REASON?: string | null
  CRM_ENTITY_TYPE?: string | null
  CRM_ENTITY_ID?: string | number | null
  CRM_ACTIVITY_ID?: string | number | null
  /** A download link with a token in it: read, never stored. */
  CALL_RECORD_URL?: string | null
  RECORD_FILE_ID?: string | number | null
  RECORD_DURATION?: string | number | null
}

/** `CALL_TYPE` (apidocs): 1 outgoing, 2 incoming, 3 incoming with redirection, 4 callback, 5 informational call. */
const INCOMING = new Set(["2", "3"])
/** `CALL_FAILED_CODE` (apidocs): 200 successful, 304 missed, 486 busy, 603 declined, 603-S cancelled. */
const OUTCOMES: Record<string, "answered" | "no_answer" | "busy"> = {
  "200": "answered",
  "304": "no_answer",
  "486": "busy",
  "603": "no_answer",
  "603-S": "no_answer",
}

const text = (value: unknown) => (value === null || value === undefined || value === "" ? null : String(value))
const seconds = (value: unknown) => {
  const found = Number(value)
  return Number.isFinite(found) && found > 0 ? found : 0
}

/** Each country a national number fits; one written with `+` or `00` names its own. */
const readings = (number: string, regions: readonly string[]) =>
  new Set(
    (regions.length ? regions : [undefined])
      .map((region) => e164Of(number, region))
      .filter((one): one is string => typeof one === "string"),
  )

/** A number two of the countries read differently stays as written: a wrong guess joins a stranger's contact. */
export const e164 = (number: string, regions: readonly string[]): string | null => {
  const found = readings(number, regions)
  return found.size === 1 ? ([...found][0] as string) : null
}

const clock = (ms: number) => {
  const all = Math.round(ms / 1000)
  return `${Math.floor(all / 60)}:${String(all % 60).padStart(2, "0")}`
}

const WORDS = { answered: "answered", no_answer: "not answered", busy: "busy", failed: "failed" } as const

export const outcomeOf = (record: CallRecord) => OUTCOMES[text(record.CALL_FAILED_CODE) ?? ""] ?? "failed"

const meetingOf = (record: CallRecord, regions: readonly string[]): SourceMeeting => {
  const incoming = INCOMING.has(String(record.CALL_TYPE))
  const raw = text(record.PHONE_NUMBER)
  const client = raw ? (e164(raw, regions) ?? raw) : null
  const outcome = outcomeOf(record)
  const talkMs = outcome === "answered" ? seconds(record.CALL_DURATION) * 1000 : null
  const started = Date.parse(record.CALL_START_DATE)
  const reason = text(record.CALL_FAILED_REASON)
  const head = incoming ? `Incoming call from ${client ?? "?"}` : `Outgoing call to ${client ?? "?"}`
  const end =
    talkMs === null
      ? `${WORDS[outcome]}${reason && outcome === "failed" ? ` (${reason})` : ""}`
      : `answered, talk ${clock(talkMs)}`
  return {
    series: null,
    // The columns cli-core shows on every phone line's call: memo context and Desktop read them, not the metadata.
    call: { direction: incoming ? "in" : "out", clientPhone: client },
    description: `${head}: ${end}.`,
    occurrence: {
      id: record.CALL_ID,
      seriesId: record.CALL_ID,
      title: head,
      startedAt: new Date(started).toISOString(),
      endedAt: new Date(started + seconds(record.CALL_DURATION) * 1000).toISOString(),
    },
    metadata: {
      direction: incoming ? "incoming" : "outgoing",
      outcome,
      callType: text(record.CALL_TYPE),
      failedCode: text(record.CALL_FAILED_CODE),
      failedReason: reason,
      client,
      talkMs,
      waitMs: null,
      durationMs: seconds(record.CALL_DURATION) * 1000,
      portalUserId: text(record.PORTAL_USER_ID),
      portalNumber: text(record.PORTAL_NUMBER),
      statisticId: text(record.ID),
      crmEntityType: text(record.CRM_ENTITY_TYPE),
      crmEntityId: text(record.CRM_ENTITY_ID),
      crmActivityId: text(record.CRM_ACTIVITY_ID),
      recordFileId: text(record.RECORD_FILE_ID),
      recordDurationMs: record.RECORD_DURATION ? seconds(record.RECORD_DURATION) * 1000 : null,
    },
  }
}

const NONE = { joinedAt: null, leftAt: null, durationMs: null, sessions: null, metadata: {} }

/** `anonymous`, an empty field: only something dialable is a person. */
const isDialable = (number: string) => /^\+?[\d\s().-]+$/.test(number) && /\d{3}/.test(number.replace(/\D/g, ""))

const participantsOf = (
  record: CallRecord,
  regions: readonly string[],
  manager: (userId: string) => string,
): SourceParticipant[] => {
  const user = text(record.PORTAL_USER_ID)
  const staff: SourceParticipant[] = user
    ? [
        {
          ...NONE,
          // The CRM's own identity of the employee, so the call joins the user `sync` stored without any rule.
          identityExternalId: manager(user),
          email: null,
          displayName: null,
          externalId: user,
          role: "manager",
        },
      ]
    : []
  const raw = text(record.PHONE_NUMBER)
  if (!raw || !isDialable(raw)) return staff
  const phone = e164(raw, regions)
  const crm = text(record.CRM_ENTITY_TYPE)
  const client: SourceParticipant = {
    ...NONE,
    // What cli-core matches to the CRM contact or messenger person with the same number (NEED-2600).
    identityExternalId: phone ? `phone:${phone}` : `number:${raw.replace(/\s/g, "")}`,
    email: null,
    phone,
    displayName: null,
    externalId: null,
    role: "client",
    // Bitrix24's own binding is the portal's word, not the phone network's: kept to read, never a join (plan DEBT).
    metadata: crm ? { crmEntityType: crm, crmEntityId: text(record.CRM_ENTITY_ID) } : {},
  }
  return INCOMING.has(String(record.CALL_TYPE)) ? [client, ...staff] : [...staff, client]
}

/** The rows that started at `since` or later, of the chosen users only, by id so a new row never shifts a page. */
export async function* callRecords(
  caller: BitrixCaller,
  { since, users }: { since: number; users: readonly number[] },
): AsyncGenerator<CallRecord> {
  let after = 0
  for (;;) {
    const answer = await caller.call(STATISTIC, {
      FILTER: { ">=CALL_START_DATE": portalTime(since), PORTAL_USER_ID: users, ...(after ? { ">ID": after } : {}) },
      SORT: "ID",
      ORDER: "ASC",
      start: 0,
    })
    if (!Array.isArray(answer.result))
      throw new CliError("invalid_response", `the portal answered ${STATISTIC} without its list of calls`)
    const rows = answer.result as CallRecord[]
    // An empty page ends the round, not a short one: a portal that caps pages lower still lists every row.
    if (!rows.length) return
    yield* rows.filter((row) => text(row.CALL_ID) && !Number.isNaN(Date.parse(row.CALL_START_DATE)))
    const last = Number(rows.at(-1)?.ID)
    if (!Number.isSafeInteger(last) || last <= after) return
    after = last
  }
}

/** One call read again by its id, for a fresh recording link: the docs say a link is no lasting id. */
export const callRecord = async (caller: BitrixCaller, callId: string): Promise<CallRecord | null> => {
  const answer = await caller.call(STATISTIC, { FILTER: { CALL_ID: callId } })
  const rows = Array.isArray(answer.result) ? (answer.result as CallRecord[]) : []
  return rows.find((row) => row.CALL_ID === callId) ?? null
}

export interface CallSourceOptions {
  portal: () => BitrixCaller
  account: AccountKey
  /** The CRM identity of a portal user: `crmIdentityId(account, id, "user")`. */
  manager: (userId: string) => string
  /** The users whose calls are copied; the CRM sync's own rule decides them. */
  users: () => Promise<number[]>
  phoneRegions: readonly string[]
  /** Where recordings are kept; null when `download_recordings` is off. */
  recordings: Recordings | null
  /** Told of a recording that could not be downloaded: the call is saved without it. */
  missed?: (callId: string, error: unknown) => void
}

/**
 * Bitrix24's call history as meetings for cli-core's `pull`: one call is one meeting, its id the call's `CALL_ID`. Its
 * people are the employee and the outside number; its attachment is the recording, when the owner keeps them.
 */
export const callSource = (options: CallSourceOptions): MeetingSource => {
  const seen = new Map<string, CallRecord>()
  return {
    provider: options.account.provider,
    name: "Bitrix24 telephony",
    overlapMs: OVERLAP_MS,
    meetings: async (since) => {
      const users = await options.users()
      if (!users.length) return []
      const meetings = new Map<string, SourceMeeting>()
      for await (const record of callRecords(options.portal(), { since: Date.parse(since), users })) {
        seen.set(record.CALL_ID, record)
        meetings.set(record.CALL_ID, meetingOf(record, options.phoneRegions))
      }
      return [...meetings.values()]
    },
    participants: async (id) => {
      const record = seen.get(id)
      return record ? participantsOf(record, options.phoneRegions, options.manager) : null
    },
    transcript: async () => null,
    chat: async () => null,
    summary: async () => null,
    files: async (id): Promise<NonNullable<MeetingSave["attachments"]> | null> => {
      const record = seen.get(id)
      if (!record || !options.recordings) return null
      try {
        const kept = await options.recordings.keep(id, async () => (record.CALL_RECORD_URL ? record : null))
        return kept ? [kept] : null
      } catch (error) {
        if (!isCliError(error) || error.code === "cancelled") throw error
        options.missed?.(id, error)
        return null
      }
    },
  }
}
