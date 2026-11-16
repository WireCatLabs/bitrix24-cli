import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { type KeyringStore, memoryKeyring } from "@wirecat/cli-base"
import { type MeetingSource, pull, type SourceMeeting } from "@wirecat/cli-core/meetings"
import { beforeEach, describe, expect, it } from "vitest"
import { RELAY_URL } from "../bitrix/oauth.js"
import { openB24Store } from "../store.js"
import { seededCrm } from "../testing/fake-crm.js"
import { FAKE_CLIENT_ID, FAKE_CLIENT_SECRET, FAKE_CODE, fakeApp } from "../testing/fake-oauth.js"
import type { PortalCall, Reply } from "../testing/fake-portal.js"
import { ok } from "../testing/fake-portal.js"
import { b24 } from "../testing/harness.js"
import { FINISH, REGISTER } from "./log.js"

const HOST = "example.bitrix24.test"
const allow = async (keyring?: KeyringStore, keys = [REGISTER, FINISH]) => {
  for (const key of keys)
    expect(
      (await b24(["work", "config", "set", `permissions.api.${key}`, "allow"], keyring ? { keyring } : {})).code,
    ).toBe(0)
}

/** The fields each method's apidocs page lists (telephony-external-call-register and -finish, 2026-11-16). */
const FIELDS = {
  [REGISTER]: new Set(
    "USER_ID USER_PHONE_INNER PHONE_NUMBER TYPE CALL_START_DATE CRM_CREATE CRM_SOURCE CRM_ENTITY_TYPE CRM_ENTITY_ID SHOW ADD_TO_CHAT CALL_LIST_ID LINE_NUMBER EXTERNAL_CALL_ID".split(
      " ",
    ),
  ),
  [FINISH]: new Set(
    "CALL_ID USER_ID USER_PHONE_INNER DURATION COST COST_CURRENCY STATUS_CODE FAILED_REASON RECORD_URL VOTE ADD_TO_CHAT".split(
      " ",
    ),
  ),
}

const refused = (error: string, description: string): Reply => ({
  status: 400,
  body: { error, error_description: description },
})

/** register and finish as their pages describe them: an application only, the fields listed, a finish after a register. */
const telephony = () => {
  const registered = new Set<string>()
  let next = 0
  const strict = (method: keyof typeof FIELDS, body: (call: PortalCall) => Reply) => (call: PortalCall) => {
    if (/\/rest\/\d+\/[^/]+\//.test(call.url))
      return refused("WRONG_AUTH_TYPE", "Current authorization type is denied for this method")
    const unknown = Object.keys(call.body).filter((one) => !FIELDS[method].has(one))
    if (unknown.length) throw new Error(`${method} got fields its page does not list: ${unknown.join(", ")}`)
    if (call.body.USER_ID === undefined && call.body.USER_PHONE_INNER === undefined)
      return refused("ERROR_CORE", "USER_ID or USER_PHONE_INNER should be set")
    return body(call)
  }
  return {
    [REGISTER]: strict(REGISTER, () => {
      next++
      const id = `externalCall.fake${next}`
      registered.add(id)
      return ok({ CALL_ID: id, CRM_CREATED_LEAD: null, CRM_CREATED_ENTITIES: [], CRM_ENTITY_TYPE: "CONTACT" })
    }),
    [FINISH]: strict(FINISH, ({ body }) =>
      registered.has(String(body.CALL_ID))
        ? ok({ CALL_ID: body.CALL_ID, CRM_ACTIVITY_ID: 900 + next, CALL_FAILED_CODE: body.STATUS_CODE })
        : refused("ERROR_CORE", "Call is not found (call should be registered prior to finishing)"),
    ),
  }
}

const people = () => ({
  "user.current": ok({ ID: "7", NAME: "Example", LAST_NAME: "Owner" }),
  "user.admin": ok(true),
})

/** A portal signed in to as a local application, its CRM copied, and one pbx call in the store. */
const setUp = async (more: Record<string, Reply | ((call: PortalCall) => Reply)> = {}) => {
  const crm = seededCrm({ ...people(), ...telephony(), ...more })
  const contact = crm.put("contact", {
    name: "Olga",
    lastName: "Example",
    assignedById: 7,
    phone: [{ valueTypeId: "MOBILE", value: "+7 900 000-00-01" }],
  })
  const app = fakeApp(crm)
  const keyring: KeyringStore = memoryKeyring()
  let landed: (url: string) => void = () => {}
  const address = new Promise<string>((resolve) => {
    landed = resolve
  })
  const signIn = await b24(["work", "session", "start", "--portal", HOST, "--client-id", FAKE_CLIENT_ID, "--json"], {
    keyring,
    portal: app,
    stdin: `${FAKE_CLIENT_SECRET}\n`,
    openBrowser: async (url) => {
      const state = new URL(url).searchParams.get("state") ?? ""
      landed(`${RELAY_URL}?code=${FAKE_CODE}&state=${encodeURIComponent(state)}&domain=${HOST}`)
    },
    answer: () => address,
  })
  expect(signIn.code, signIn.err).toBe(0)
  expect((await b24(["work", "sync", "--json"], { portal: app, keyring })).code).toBe(0)
  const store = await openB24Store(process.env)
  try {
    const accountId = await store.accounts.saveAccount({ provider: "asterisk", account: "office" }, { name: "Office" })
    await pull(pbxSource, store.meetings, {
      accountId,
      since: "2026-11-01T00:00:00Z",
      now: Date.parse("2026-11-12T00:00:00Z"),
    })
    const [saved] = await store.meetings.meetings({ accountId })
    await store.people.linkIdentities(
      { provider: "asterisk", id: "extension:101" },
      { provider: "bitrix24", id: `${HOST}/user/7` },
      { method: "manual", by: "test" },
    )
    await store.people.linkIdentities(
      { provider: "asterisk", id: "phone:+79000000001" },
      { provider: "bitrix24", id: `${HOST}/contact/${contact}` },
      { method: "manual", by: "test" },
    )
    return { app, crm, keyring, contact, meeting: saved?.id as number }
  } finally {
    await store.close()
  }
}

const NONE = { joinedAt: null, leftAt: null, durationMs: null, sessions: null, metadata: {}, email: null }

/** One answered call as pbx stores it: Asterisk's disposition and billed time, the extension and the caller. */
const pbxSource: MeetingSource = {
  provider: "asterisk",
  name: "fake pbx",
  meetings: async () => [
    {
      series: null,
      occurrence: {
        id: "1700000000.42",
        seriesId: "1700000000.42",
        title: "+79000000001 → 101",
        startedAt: "2026-11-10T07:00:00.000Z",
        endedAt: "2026-11-10T07:02:05.000Z",
      },
      call: { direction: "in", clientPhone: "+79000000001" },
      metadata: { direction: "in", disposition: "ANSWERED", durationMs: 125_000, answeredMs: 118_000 },
    } as unknown as SourceMeeting,
  ],
  participants: async () => [
    { ...NONE, identityExternalId: "extension:101", displayName: "Front desk", externalId: "101", role: "manager" },
    {
      ...NONE,
      identityExternalId: "phone:+79000000001",
      phone: "+79000000001",
      displayName: null,
      externalId: null,
      role: "client",
    },
  ],
  transcript: async () => null,
  chat: async () => null,
  summary: async () => null,
  files: async () => null,
}

beforeEach(() => rmSync(process.env.B24_CONFIG_DIR as string, { recursive: true, force: true }))

describe("calls export writes other phone systems' calls onto the contact", () => {
  it("shows in a dry run what it would send and its gates, and sends nothing", async () => {
    const { app, crm, keyring, contact, meeting } = await setUp()
    const before = crm.calls.length
    const ran = await b24(["work", "calls", "export", "--dry-run", "--json"], { portal: app, keyring })
    expect(ran.code, ran.err).toBe(0)
    expect(ran.json().item).toMatchObject({
      preview: true,
      gates: {
        export_calls: false,
        permissions: [
          { key: "calls.export", level: "allow" },
          { key: `api.${REGISTER}`, level: "deny" },
          { key: `api.${FINISH}`, level: "deny" },
        ],
      },
      effects: { keyring_read: false, service_contacted: false },
      portals: [
        {
          portal: HOST,
          would_export: [
            {
              meeting,
              register: {
                USER_ID: 7,
                PHONE_NUMBER: "+79000000001",
                TYPE: 2,
                CALL_START_DATE: "2026-11-10T07:00:00.000Z",
                CRM_CREATE: 0,
                CRM_ENTITY_TYPE: "CONTACT",
                CRM_ENTITY_ID: contact,
                SHOW: 0,
                ADD_TO_CHAT: 0,
                EXTERNAL_CALL_ID: "wirecat:asterisk:1700000000.42",
              },
              finish: { USER_ID: 7, DURATION: 118, STATUS_CODE: "200", ADD_TO_CHAT: 0 },
            },
          ],
        },
      ],
    })
    expect(crm.calls.length).toBe(before)
  })

  it("refuses while export_calls is off, or either method is denied, before any request", async () => {
    const { app, crm, keyring } = await setUp()
    const before = crm.calls.length
    await allow(keyring)
    const off = await b24(["work", "calls", "export", "--json"], { portal: app, keyring })
    expect(off.code).not.toBe(0)
    expect(off.json().error).toMatchObject({ code: "configuration_error", reason: "calls-export.off" })
    expect((await b24(["work", "config", "set", "export_calls", "true"], { keyring })).code).toBe(0)
    expect((await b24(["work", "config", "set", `permissions.api.${FINISH}`, "deny"], { keyring })).code).toBe(0)
    const one = await b24(["work", "calls", "export", "--json"], { portal: app, keyring })
    expect(one.json().error).toMatchObject({ code: "permission_error", details: { permission: `api.${FINISH}` } })
    // The rest of the family stays denied, a raw call included.
    const raw = await b24(["work", "api", "call", "telephony.externalCall.hide", "--body", "{}", "--json"], {
      portal: app,
      keyring,
    })
    expect(raw.code).not.toBe(0)
    expect(crm.calls.length).toBe(before)
  })

  it("refuses a webhook sign-in and names the application sign-in", async () => {
    await setUp()
    await allow()
    expect((await b24(["work", "config", "set", "export_calls", "true"])).code).toBe(0)
    const ran = await b24(["work", "calls", "export", "--json"])
    expect(ran.json().error).toMatchObject({ code: "permission_error", reason: "webhook.app-only" })
  })

  it("registers and finishes each call once, keeping the ids it got", async () => {
    const { app, crm, keyring, meeting } = await setUp()
    await allow(keyring)
    expect((await b24(["work", "config", "set", "export_calls", "true"], { keyring })).code).toBe(0)
    const ran = await b24(["work", "calls", "export", "--json"], { portal: app, keyring })
    expect(ran.code, ran.err).toBe(0)
    expect(ran.json().item).toMatchObject({
      exported: [{ meeting, call_id: "externalCall.fake1", activity_id: 901 }],
      already_exported: 0,
      failed: [],
    })
    const again = await b24(["work", "calls", "export", "--json"], { portal: app, keyring })
    expect(again.json().item).toMatchObject({ exported: [], already_exported: 1 })
    expect(crm.calls.filter(({ method }) => method.startsWith("telephony.")).map(({ method }) => method)).toEqual([
      REGISTER,
      FINISH,
    ])
    const state = join(process.env.B24_STATE_DIR as string, "calls-export", `${HOST}.json`)
    expect(JSON.parse(readFileSync(state, "utf8"))).toMatchObject({
      "asterisk:office:1700000000.42": { call_id: "externalCall.fake1", activity_id: 901 },
    })
  })

  it("finishes a call a stopped run registered, and never registers it twice", async () => {
    let fail = true
    const { app, crm, keyring, meeting } = await setUp({
      [FINISH]: (call: PortalCall) => {
        if (fail) {
          fail = false
          return refused("INTERNAL_SERVER_ERROR", "fake outage")
        }
        return ok({ CALL_ID: call.body.CALL_ID, CRM_ACTIVITY_ID: 950 })
      },
    })
    await allow(keyring)
    expect((await b24(["work", "config", "set", "export_calls", "true"], { keyring })).code).toBe(0)
    const first = await b24(["work", "calls", "export", "--json"], { portal: app, keyring })
    expect((first.json().item as { failed: unknown[] }).failed).toHaveLength(1)
    const second = await b24(["work", "calls", "export", "--json"], { portal: app, keyring })
    expect(second.json().item).toMatchObject({
      exported: [{ meeting, call_id: "externalCall.fake1", activity_id: 950 }],
    })
    expect(crm.calls.filter(({ method }) => method === REGISTER)).toHaveLength(1)
  })

  it("skips a call whose client is linked to no contact, with the reason", async () => {
    const { app, keyring } = await setUp()
    const store = await openB24Store(process.env)
    try {
      await store.people.unlinkIdentity(
        { provider: "asterisk", id: "phone:+79000000001" },
        { method: "manual", by: "test" },
      )
    } finally {
      await store.close()
    }
    const ran = await b24(["work", "calls", "export", "--dry-run", "--json"], { portal: app, keyring })
    expect(ran.json().item).toMatchObject({
      portals: [{ portal: HOST, would_export: [], skipped: [{ reason: "the client is linked to no contact" }] }],
    })
  })

  it("takes a window, one call, and a contact named by hand", async () => {
    const { app, keyring, meeting } = await setUp()
    const preview = async (...args: string[]) => {
      const ran = await b24(["work", "calls", "export", "--dry-run", "--json", ...args], { portal: app, keyring })
      expect(ran.code, ran.err).toBe(0)
      return (ran.json().item as { portals: { would_export: { register: Record<string, unknown> }[] }[] }).portals[0]
    }
    expect((await preview("--since-time", "2026-11-11T00:00:00Z"))?.would_export).toEqual([])
    const chosen = await preview("--meeting", String(meeting), "--contact", "321", "--phone", "+79000000099")
    expect(chosen?.would_export.map(({ register }) => [register.CRM_ENTITY_ID, register.PHONE_NUMBER])).toEqual([
      [321, "+79000000099"],
    ])
    const alone = await b24(["work", "calls", "export", "--dry-run", "--phone", "+79000000099", "--json"])
    expect(alone.json().error).toMatchObject({ code: "validation_error" })
  })

  it("never sends again a call an earlier run sent without an answer", async () => {
    const { app, crm, keyring, meeting } = await setUp()
    await allow(keyring)
    expect((await b24(["work", "config", "set", "export_calls", "true"], { keyring })).code).toBe(0)
    const folder = join(process.env.B24_STATE_DIR as string, "calls-export")
    mkdirSync(folder, { recursive: true })
    writeFileSync(
      join(folder, `${HOST}.json`),
      JSON.stringify({ "asterisk:office:1700000000.42": { call_id: null, registered_at: "2026-11-16T10:00:00Z" } }),
    )
    const ran = await b24(["work", "calls", "export", "--json"], { portal: app, keyring })
    expect(ran.json().item).toMatchObject({
      exported: [],
      failed: [{ meeting, reason: "calls-export.outcome-unknown" }],
    })
    expect(crm.calls.filter(({ method }) => method.startsWith("telephony."))).toEqual([])
  })
})
