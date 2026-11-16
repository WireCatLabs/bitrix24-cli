import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { CliError } from "@wirecat/cli-base"
import { describe, expect, it } from "vitest"
import {
  FINISH,
  type Ledger,
  type LedgerRow,
  logCalls,
  openLedger,
  type PlannedCall,
  planCalls,
  REGISTER,
} from "./log.js"

const HOST = "example.bitrix24.test"

interface Call {
  id: number
  provider?: string
  direction?: "in" | "out" | null
  clientPhone?: string | null
  metadata?: Record<string, unknown> | null
  durationMs?: number | null
  contacts?: string[]
  users?: string[]
}

/** A store with just what planCalls reads: the calls, their accounts, the client and the employee as people. */
const storeOf = (calls: Call[]) => {
  const people = new Map<string, string[]>()
  for (const call of calls) {
    people.set(
      `client${call.id}`,
      (call.contacts ?? []).map((one) => `${HOST}/contact/${one}`),
    )
    people.set(
      `manager${call.id}`,
      (call.users ?? []).map((one) => `${HOST}/user/${one}`),
    )
  }
  return {
    meetings: {
      meetings: async () =>
        calls.map((call) => ({
          id: call.id,
          accountId: call.id,
          externalId: `ext${call.id}`,
          startedAt: Date.parse("2026-11-10T07:00:00Z") + call.id,
          createdAt: 0,
          durationMs: call.durationMs ?? null,
          metadata: call.metadata === undefined ? {} : call.metadata,
          deletedAt: null,
          direction: call.direction === undefined ? "in" : call.direction,
          clientPhone: call.clientPhone === undefined ? "+79000000001" : call.clientPhone,
          manager: { name: null, person: `person:manager${call.id}` },
        })),
      account: async (id: number) => ({
        provider: calls.find((one) => one.id === id)?.provider ?? "asterisk",
        account: "office",
      }),
      meeting: async (id: number) => ({
        participants: [{ role: "client", person: { uid: `client${id}`, name: null } }],
      }),
    },
    people: {
      personByUid: async (uid: string) => ({
        uid,
        identities: (people.get(uid) ?? []).map((id) => ({ provider: "bitrix24", id })),
      }),
    },
    accounts: {},
  } as unknown as Parameters<typeof planCalls>[0]
}

describe("planCalls", () => {
  it("reads each phone system's outcome and talk time as finish's codes", async () => {
    const { planned } = await planCalls(
      storeOf([
        { id: 1, metadata: { outcome: "answered", talkMs: 61_400 }, contacts: ["5"], users: ["7"] },
        { id: 2, direction: "out", metadata: { disposition: "NO ANSWER" }, contacts: ["5"], users: ["7"] },
        { id: 3, metadata: { outcome: "busy" }, contacts: ["5"], users: ["7"] },
        { id: 4, metadata: null, contacts: ["5"], users: ["7"] },
        { id: 5, metadata: { disposition: "ANSWERED" }, durationMs: 30_000, contacts: ["5"], users: ["7"] },
        { id: 6, metadata: { disposition: "ANSWERED" }, durationMs: null, contacts: ["5"], users: ["7"] },
      ]),
      { host: HOST },
    )
    expect(planned.map(({ register, finish }) => [register.TYPE, finish.STATUS_CODE, finish.DURATION])).toEqual([
      [2, "200", 61],
      [1, "304", 0],
      [2, "486", 0],
      [2, "OTHER", 0],
      [2, "200", 30],
      [2, "200", 0],
    ])
  })

  it("skips a call it cannot place, with the reason, and never guesses", async () => {
    const { planned, skipped } = await planCalls(
      storeOf([
        { id: 1, provider: "bitrix24", contacts: ["5"], users: ["7"] },
        { id: 2, clientPhone: null, contacts: ["5"], users: ["7"] },
        { id: 3, contacts: ["5", "6"], users: ["7"] },
        { id: 4, contacts: [], users: ["7"] },
        { id: 5, contacts: ["5"], users: [] },
        { id: 6, contacts: ["5"], users: ["7", "8"] },
        { id: 7, direction: null, contacts: ["5"], users: ["7"] },
      ]),
      { host: HOST },
    )
    expect(planned).toEqual([])
    expect(skipped.map(({ reason }) => reason)).toEqual([
      "a Bitrix24 call: it is in Bitrix24 already",
      "the client's number is not known",
      "the client is linked to several contacts",
      "the client is linked to no contact",
      "the employee is linked to no portal user",
      "the employee is linked to several portal users",
    ])
  })
})

const memoryLedger = (rows: Record<string, LedgerRow> = {}): Ledger & { rows: Record<string, LedgerRow> } => ({
  rows,
  get: (key) => rows[key],
  put: async (key, row) => {
    rows[key] = row
  },
  drop: async (key) => {
    delete rows[key]
  },
})

const planned: PlannedCall = {
  meeting: 1,
  key: "asterisk:office:ext1",
  register: {
    USER_ID: 7,
    PHONE_NUMBER: "+79000000001",
    TYPE: 2,
    CALL_START_DATE: "2026-11-10T07:00:00.000Z",
    CRM_CREATE: 0,
    CRM_ENTITY_TYPE: "CONTACT",
    CRM_ENTITY_ID: 5,
    SHOW: 0,
    ADD_TO_CHAT: 0,
    EXTERNAL_CALL_ID: "wirecat:asterisk:ext1",
  },
  finish: { USER_ID: 7, DURATION: 61, STATUS_CODE: "200", ADD_TO_CHAT: 0 },
}

describe("logCalls", () => {
  it("drops the pending row of a refused register, so the next run may send it", async () => {
    const ledger = memoryLedger()
    const report = await logCalls({ planned: [planned], skipped: [] }, ledger, async () => {
      throw new CliError("validation_error", "Unknown TYPE.")
    })
    expect(report.failed).toMatchObject([{ meeting: 1, reason: "validation_error" }])
    expect(ledger.rows).toEqual({})
  })

  it("keeps the pending row when the register's answer never came, and stops", async () => {
    const ledger = memoryLedger()
    const run = logCalls({ planned: [planned], skipped: [] }, ledger, async () => {
      throw new CliError("outcome_unknown", "no answer")
    })
    await expect(run).rejects.toMatchObject({ code: "outcome_unknown" })
    expect(ledger.rows[planned.key]).toMatchObject({ call_id: null })
  })

  it("fails a register with no CALL_ID, and any other error without its text", async () => {
    const empty = await logCalls({ planned: [planned], skipped: [] }, memoryLedger(), async () => ({}))
    expect(empty.failed).toMatchObject([{ reason: "calls-export.no-call-id" }])
    const odd = await logCalls(
      { planned: [planned], skipped: [] },
      memoryLedger({ [planned.key]: { call_id: "externalCall.1", registered_at: "x" } }),
      async (method) => {
        if (method === FINISH) throw new Error("https://example.bitrix24.test/secret")
        return {}
      },
    )
    expect(odd.failed).toEqual([
      { meeting: 1, reason: "unexpected", message: "the call could not be written to Bitrix24" },
    ])
  })

  it("sends register's fields as planned, and finish with the CALL_ID it got", async () => {
    const sent: [string, Record<string, unknown>][] = []
    const report = await logCalls(
      { planned: [planned], skipped: [] },
      memoryLedger(),
      async (method, body) => {
        sent.push([method, body])
        return method === REGISTER ? { CALL_ID: "externalCall.9" } : { CRM_ACTIVITY_ID: "not a number" }
      },
      () => new Date("2026-11-16T00:00:00Z"),
    )
    expect(sent.map(([method, body]) => [method, body.CALL_ID ?? body.EXTERNAL_CALL_ID])).toEqual([
      [REGISTER, "wirecat:asterisk:ext1"],
      [FINISH, "externalCall.9"],
    ])
    expect(report.exported).toEqual([{ meeting: 1, call_id: "externalCall.9", activity_id: null }])
  })
})

describe("openLedger", () => {
  it("starts empty without a file, and refuses a file it cannot read", async () => {
    const folder = mkdtempSync(join(tmpdir(), "b24-ledger-"))
    const fresh = await openLedger(join(folder, "none", "portal.json"))
    expect(fresh.get("any")).toBeUndefined()
    await fresh.put("a", { call_id: "x", registered_at: "t" })
    await fresh.drop("a")
    expect(fresh.get("a")).toBeUndefined()
    mkdirSync(join(folder, "bad"))
    writeFileSync(join(folder, "bad", "portal.json"), "{not json")
    await expect(openLedger(join(folder, "bad", "portal.json"))).rejects.toMatchObject({
      details: { reason: "calls-export.ledger-unreadable" },
    })
  })
})
