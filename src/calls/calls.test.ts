import { readdirSync, readFileSync, rmSync, statSync } from "node:fs"
import { join } from "node:path"
import { beforeEach, describe, expect, it } from "vitest"
import { openB24Store } from "../store.js"
import { seededCrm } from "../testing/fake-crm.js"
import type { PortalCall, Reply } from "../testing/fake-portal.js"
import { ok } from "../testing/fake-portal.js"
import { b24 } from "../testing/harness.js"

const HOST = "example.bitrix24.test"
const LINK = `https://${HOST}/rest/download.json?auth=fakeauth0&token=faketoken0`
const AUDIO = "ID3-fake-recording-bytes"

/** One row as apidocs voximplant-statistic-get shows it: numbers as strings. */
const row = (id: number, fields: Record<string, unknown> = {}) => ({
  ID: String(id),
  CALL_ID: `externalCall.${id}`,
  PORTAL_USER_ID: "7",
  PORTAL_NUMBER: "reg123",
  PHONE_NUMBER: "+79000000001",
  CALL_TYPE: "2",
  CALL_DURATION: "125",
  CALL_START_DATE: "2026-11-10T10:00:00+03:00",
  CALL_FAILED_CODE: "200",
  CALL_FAILED_REASON: "Success call",
  CRM_ENTITY_TYPE: "CONTACT",
  CRM_ENTITY_ID: "100",
  CRM_ACTIVITY_ID: "500",
  CALL_RECORD_URL: null,
  RECORD_FILE_ID: null,
  ...fields,
})

/** A portal whose call history answers by `>ID`, as the docs page's keyset paging reads it. */
const history =
  (rows: Record<string, unknown>[]) =>
  (call: PortalCall): Reply => {
    const filter = (call.body.FILTER ?? {}) as Record<string, unknown>
    if (filter.CALL_ID) return ok(rows.filter((one) => one.CALL_ID === filter.CALL_ID))
    const after = Number(filter[">ID"] ?? 0)
    const users = (filter.PORTAL_USER_ID as number[] | undefined)?.map(String)
    return ok(
      rows
        .filter((one) => Number(one.ID) > after && (!users || users.includes(String(one.PORTAL_USER_ID))))
        .slice(0, 2),
    )
  }

const portalWith = (
  rows: Record<string, unknown>[],
  more: Record<string, Reply | Reply[] | ((call: PortalCall) => Reply)> = {},
) => seededCrm({ "voximplant.statistic.get": history(rows), ...more })

// Each test sets its own settings; the config folder is the file's, not the test's.
beforeEach(() => rmSync(process.env.B24_CONFIG_DIR as string, { recursive: true, force: true }))

const statistic = (portal: { calls: PortalCall[] }) =>
  portal.calls.filter(({ method }) => method === "voximplant.statistic.get")

describe("meetings sync imports the portal's calls", () => {
  it("reads the signed-in user's calls by id, and keeps each one's direction, number and outcome", async () => {
    const portal = portalWith([
      row(1),
      row(2, { CALL_TYPE: "1", PHONE_NUMBER: "+79000000002", CALL_FAILED_CODE: "304", CALL_DURATION: "0" }),
      row(3, { PORTAL_USER_ID: "9" }),
    ])
    const ran = await b24(["work", "meetings", "sync", "--since-time", "2026-11-01T00:00:00Z", "--json"], { portal })
    expect(ran.code, ran.err).toBe(0)
    const sent = statistic(portal).map(({ body }) => body)
    expect(sent[0]).toMatchObject({
      FILTER: { ">=CALL_START_DATE": expect.stringMatching(/^2026-1[01]-/), PORTAL_USER_ID: [7] },
      SORT: "ID",
      ORDER: "ASC",
      start: 0,
    })
    expect(sent[1]?.FILTER).toMatchObject({ ">ID": 2 })
    const listed = (await b24(["work", "meetings", "list", "--json"], { portal })).json() as {
      items: { title: string; provider_id: string; call: { direction: string; client_phone: string } }[]
    }
    expect(
      listed.items.map(({ provider_id, title, call }) => [provider_id, title, call.direction, call.client_phone]),
    ).toEqual([
      ["externalCall.1", "Incoming call from +79000000001", "in", "+79000000001"],
      ["externalCall.2", "Outgoing call to +79000000002", "out", "+79000000002"],
    ])
  })

  it("says how each call ended, and keeps no person for a hidden number", async () => {
    const portal = portalWith([
      row(1, { CALL_FAILED_CODE: "486", CALL_DURATION: "0" }),
      row(2, { CALL_TYPE: "4", CALL_FAILED_CODE: "OTHER", CALL_FAILED_REASON: "Line error", CALL_DURATION: "0" }),
      row(3, { PHONE_NUMBER: "anonymous", CALL_FAILED_CODE: "603-S", CALL_DURATION: "0" }),
    ])
    expect((await b24(["work", "meetings", "sync", "--json"], { portal })).code).toBe(0)
    const listed = (await b24(["work", "meetings", "list", "--json"])).json() as {
      items: { description: string; participants_count: number }[]
    }
    expect(listed.items.map(({ description, participants_count }) => [description, participants_count])).toEqual([
      ["Incoming call from +79000000001: busy.", 2],
      ["Outgoing call to +79000000001: failed (Line error).", 2],
      ["Incoming call from anonymous: not answered.", 1],
    ])
  })

  it("reads a number without + in the profile's phone_region, and leaves it as written without one", async () => {
    const rows = [row(1, { PHONE_NUMBER: "79000000001" }), row(2, { PHONE_NUMBER: "89000000001" })]
    await b24(["work", "meetings", "sync", "--json"], { portal: portalWith(rows) })
    const store = await openB24Store(process.env)
    const before = (await store.meetings.meetings({ accountId: 1 })).map((one) => one.clientPhone)
    await store.close()
    expect(before.every((phone) => phone === "79000000001" || phone === "89000000001")).toBe(true)
    expect((await b24(["work", "config", "set", "phone_region", "ru"])).code).toBe(0)
    await b24(["work", "meetings", "sync", "--rescan", "--json"], { portal: portalWith(rows) })
    const listed = (await b24(["work", "meetings", "list", "--json"])).json() as {
      items: { call: { client_phone: string } }[]
    }
    expect(listed.items.map((one) => one.call.client_phone)).toEqual(["+79000000001", "+79000000001"])
  })

  it("refuses a stored scope of all, as the CRM sync does", async () => {
    expect((await b24(["work", "config", "set", `crm.bitrix24:${HOST}.scope`, "all"])).code).toBe(0)
    const portal = portalWith([row(1)])
    const ran = await b24(["work", "meetings", "sync", "--json"], { portal })
    expect(ran.code).not.toBe(0)
    expect(ran.err).toContain("bitrix.scope-all-refused")
    expect(statistic(portal)).toHaveLength(0)
  })
})

describe("recordings", () => {
  const recorded = row(1, { CALL_RECORD_URL: LINK, RECORD_FILE_ID: 42 })
  const audio: Reply = { text: AUDIO, headers: { "content-type": "audio/mpeg" } }

  it("are not downloaded unless download_recordings is on", async () => {
    const portal = portalWith([recorded], { "download.json": audio })
    await b24(["work", "meetings", "sync", "--json"], { portal })
    expect(portal.calls.some(({ method }) => method === "download.json")).toBe(false)
  })

  it("are kept for the owner only and named as the call's file; the link with its token is stored nowhere", async () => {
    expect((await b24(["work", "config", "set", "download_recordings", "true"])).code).toBe(0)
    const portal = portalWith([recorded], { "download.json": audio })
    expect((await b24(["work", "meetings", "sync", "--json"], { portal })).code).toBe(0)
    const folder = join(process.env.B24_STATE_DIR as string, "recordings", "work")
    expect(readdirSync(folder)).toEqual(["externalCall.1.mp3"])
    expect(readFileSync(join(folder, "externalCall.1.mp3"), "utf8")).toBe(AUDIO)
    // Windows has no POSIX mode bits: Node reports 0o666 for any writable file.
    if (process.platform !== "win32") expect(statSync(join(folder, "externalCall.1.mp3")).mode & 0o777).toBe(0o600)
    const shown = (await b24(["work", "meetings", "show", "1", "--json"])).json() as {
      item: { attachments: { local_path: string; mime: string }[] }
    }
    expect(shown.item.attachments).toEqual([
      expect.objectContaining({ local_path: join(folder, "externalCall.1.mp3"), mime: "audio/mpeg" }),
    ])
    expect(readFileSync(process.env.MESSAGING_STORE as string).includes("faketoken0")).toBe(false)
    // A second sync reads the kept file, never the portal's link again.
    await b24(["work", "meetings", "sync", "--rescan", "--json"], { portal })
    expect(portal.calls.filter(({ method }) => method === "download.json")).toHaveLength(1)
  })

  it("never follows a link into a private network, and saves the call without it", async () => {
    expect((await b24(["work", "config", "set", "download_recordings", "true"])).code).toBe(0)
    const elsewhere = row(1, { CALL_RECORD_URL: "https://10.0.0.5/rec.mp3?token=faketoken0" })
    const ran = await b24(["work", "meetings", "sync", "--json"], { portal: portalWith([elsewhere]) })
    expect(ran.code, ran.err).toBe(0)
    expect(ran.err).toContain("private network")
    expect(ran.err).not.toContain("faketoken0")
    const listed = (await b24(["work", "meetings", "list", "--json"])).json() as { items: unknown[] }
    expect(listed.items).toHaveLength(1)
  })
})

describe("people", () => {
  it("joins the employee to the CRM user and the caller's mobile to the contact with that number", async () => {
    const portal = portalWith([row(1, { PHONE_NUMBER: "+79000000001" })])
    const contact = portal.put("contact", {
      name: "Olga",
      lastName: "Example",
      assignedById: 7,
      phone: [{ valueTypeId: "MOBILE", value: "8 (900) 000-00-01" }],
    })
    expect((await b24(["work", "sync", "--json"], { portal })).code).toBe(0)
    expect((await b24(["work", "meetings", "sync", "--json"], { portal })).code).toBe(0)
    // A CRM sync after the calls keeps what the calls joined.
    expect((await b24(["work", "sync", "--rescan", "--json"], { portal })).code).toBe(0)
    const store = await openB24Store(process.env)
    try {
      const personOf = (id: string) => store.people.personOf({ provider: "bitrix24", id })
      const caller = await personOf("phone:+79000000001")
      const olga = await personOf(`${HOST}/contact/${contact}`)
      expect(olga?.name).toBe("Olga Example")
      expect(caller?.uid).toBe(olga?.uid)
      const user = await personOf(`${HOST}/user/7`)
      expect(user?.name).toBe("Example Owner")
      const listed = (await b24(["work", "meetings", "list", "--json"])).json() as {
        items: { call: { manager: { name: string; person: string } } }[]
      }
      expect(listed.items[0]?.call.manager).toEqual({ name: "Example Owner", person: `person:${user?.uid}` })
    } finally {
      await store.close()
    }
  })
})

describe("permissions", () => {
  it("leave api call of the call history denied: its answer holds recording links with tokens", async () => {
    const ran = await b24(["work", "api", "call", "voximplant.statistic.get", "--json"], {
      portal: portalWith([row(1)]),
    })
    expect(ran.code).toBe(5)
    expect(ran.err).toContain("api.voximplant")
  })

  it("stop the calls sync with meetings.sync deny", async () => {
    expect((await b24(["work", "config", "set", "permissions.meetings.sync", "deny"])).code).toBe(0)
    const portal = portalWith([row(1)])
    expect((await b24(["work", "meetings", "sync", "--json"], { portal })).code).toBe(5)
    expect(statistic(portal)).toHaveLength(0)
  })
})

describe("meetings transcribe", () => {
  const pcm = { samples: new Float32Array(16_000 * 3), rate: 16_000 }
  const speech = {
    findModel: () => ({ id: "gigaam-v3" }),
    isInstalled: () => true,
    modelsDirectory: () => "",
    localSpeechRecognitionModel: () => ({ engine: "fake", model: "gigaam-v3", version: "1" }),
    decodeChannels: async () => ({ channels: [pcm], mixed: false }),
    mixDown: () => pcm,
    recognizeLocalPieces: async () => [{ start: 0.2, end: 1.5, text: "Добрый день, это Ольга" }],
  }
  const transcribe = async (portal: ReturnType<typeof portalWith>, more: string[] = [], engine = speech) => {
    const { run } = await import("../program.js")
    const out: string[] = []
    const err: string[] = []
    const code = await run(["work", "meetings", "transcribe", ...more, "--json"], {
      streams: { data: (text: string) => out.push(text), diagnostic: (text: string) => err.push(text) },
      tty: false,
      keyring: (await import("../testing/harness.js")).signedIn(),
      fetch: portal.fetch,
      sleep: async () => {},
      speech: engine,
    } as never)
    return { code, out: out.join(""), err: err.join("") }
  }

  it("downloads the recording from a fresh link, recognizes it here, and keeps no file unless asked", async () => {
    const portal = portalWith([row(1, { CALL_RECORD_URL: LINK })], {
      "download.json": { text: AUDIO, headers: { "content-type": "audio/mpeg" } },
    })
    await b24(["work", "meetings", "sync", "--json"], { portal })
    const ran = await transcribe(portal)
    expect(ran.code, ran.err).toBe(0)
    expect(JSON.parse(ran.out).item).toMatchObject({ transcribed: 1, failed: [] })
    expect(statistic(portal).at(-1)?.body).toEqual({ FILTER: { CALL_ID: "externalCall.1" } })
    const transcript = await b24(["work", "meetings", "transcript", "1", "--json"], { portal })
    expect(transcript.out).toContain("Добрый день, это Ольга")
    expect(readdirSync(process.env.B24_STATE_DIR as string)).not.toContain("recordings")
  })

  it("lists a call with no recording on the portal as failed, named by its ref, and goes on", async () => {
    const portal = portalWith([row(1)])
    await b24(["work", "meetings", "sync", "--json"], { portal })
    const ran = await transcribe(portal)
    expect(JSON.parse(ran.out).item).toMatchObject({
      transcribed: 0,
      audio_ms: 0,
      failed: [{ meeting: 1, ref: expect.stringMatching(/^meeting:/), reason: "recording.missing" }],
    })
  })

  it("downloads a recording the telephony provider keeps on its own public host", async () => {
    // A literal public address, so the test resolves no name.
    const provider = "https://93.184.216.10/records/a1b2/rec.mp3"
    const portal = portalWith([row(1, { CALL_RECORD_URL: provider })], {
      "rec.mp3": { text: AUDIO, headers: { "content-type": "audio/mpeg" } },
    })
    await b24(["work", "meetings", "sync", "--json"], { portal })
    const ran = await transcribe(portal)
    expect(JSON.parse(ran.out).item).toMatchObject({ transcribed: 1, failed: [] })
    expect(portal.calls.filter(({ method }) => method === "rec.mp3").map(({ url }) => url)).toEqual([provider])
  })

  it("spends --max-meetings only on calls with a recording", async () => {
    const portal = portalWith(
      [
        row(1, { CALL_RECORD_URL: LINK }),
        row(2, { CALL_START_DATE: "2026-11-11T10:00:00+03:00" }),
        row(3, { CALL_START_DATE: "2026-11-12T10:00:00+03:00" }),
      ],
      { "download.json": { text: AUDIO, headers: { "content-type": "audio/mpeg" } } },
    )
    await b24(["work", "meetings", "sync", "--json"], { portal })
    const ran = await transcribe(portal, ["--max-meetings", "1"])
    expect(JSON.parse(ran.out).item).toMatchObject({
      transcribed: 1,
      failed: [{ reason: "recording.missing" }, { reason: "recording.missing" }],
      remaining: 0,
    })
  })

  it("keeps the recording with download_recordings, and reads the kept file the next time", async () => {
    const portal = portalWith([row(1, { CALL_RECORD_URL: LINK })], {
      "download.json": { text: AUDIO, headers: { "content-type": "audio/wav; codec=pcm" } },
    })
    await b24(["work", "meetings", "sync", "--json"], { portal })
    expect((await b24(["work", "config", "set", "download_recordings", "true"])).code).toBe(0)
    expect((await transcribe(portal)).code).toBe(0)
    const shown = (await b24(["work", "meetings", "show", "1", "--json"])).json() as {
      item: { attachments: { local_path: string }[] }
    }
    expect(shown.item.attachments[0]?.local_path).toMatch(/externalCall\.1\.wav$/)
    const folder = join(process.env.B24_STATE_DIR as string, "recordings", "work")
    expect(readdirSync(folder)).toEqual(["externalCall.1.wav"])
    const downloads = portal.calls.filter(({ method }) => method === "download.json").length
    const again = await transcribe(portal, ["--replace"])
    expect(JSON.parse(again.out).item).toMatchObject({ transcribed: 1 })
    expect(portal.calls.filter(({ method }) => method === "download.json")).toHaveLength(downloads)
  })

  it("names the two channels of a stereo recording, by number", async () => {
    const portal = portalWith([row(1, { CALL_RECORD_URL: LINK })], {
      "download.json": { text: AUDIO, headers: { "content-type": "audio/mpeg" } },
    })
    await b24(["work", "meetings", "sync", "--json"], { portal })
    const stereo = { ...speech, decodeChannels: async () => ({ channels: [pcm, pcm], mixed: false }) }
    expect((await transcribe(portal, [], stereo)).code).toBe(0)
    const transcript = await b24(["work", "meetings", "transcript", "1", "--json"])
    expect(transcript.out).toContain("Channel 1")
    expect(transcript.out).toContain("Channel 2")
  })

  it("refuses a recording that is not audio, or too large", async () => {
    const portal = portalWith(
      [
        row(1, { CALL_RECORD_URL: LINK }),
        row(2, { CALL_ID: "externalCall.big", CALL_RECORD_URL: LINK }),
        row(3, { CALL_ID: "externalCall.cut", CALL_RECORD_URL: LINK }),
        row(4, { CALL_ID: "", CALL_RECORD_URL: LINK }),
      ],
      {
        "download.json": [
          { text: "<html>", headers: { "content-type": "text/html" } },
          { text: AUDIO, headers: { "content-type": "audio/mpeg", "content-length": String(65 * 1024 * 1024) } },
          new Error("socket hang up"),
        ],
      },
    )
    await b24(["work", "meetings", "sync", "--json"], { portal })
    const report = JSON.parse((await transcribe(portal)).out).item as { failed: { reason: string }[] }
    expect(report.failed.map(({ reason }) => reason).sort()).toEqual([
      "bitrix.download-too-large",
      "network_error",
      "recording.not-audio",
    ])
  })

  it("lists a call it could not transcribe with the reason, and goes on", async () => {
    const portal = portalWith(
      [
        row(1, { CALL_RECORD_URL: LINK }),
        row(2, { CALL_ID: "externalCall.long", CALL_DURATION: String(2 * 60 * 60), CALL_RECORD_URL: LINK }),
      ],
      { "download.json": { status: 403, text: "denied" } },
    )
    await b24(["work", "meetings", "sync", "--json"], { portal })
    const ran = await transcribe(portal)
    const report = JSON.parse(ran.out).item as { failed: { reason: string; message: string }[] }
    expect(report.failed.map(({ reason }) => reason).sort()).toEqual(["bitrix.download-refused", "recording.too-long"])
    expect(ran.out + ran.err).not.toContain("faketoken0")
  })

  it("names the step when the speech model is unknown or not downloaded", async () => {
    const portal = portalWith([])
    const unknown = await transcribe(portal, [], { ...speech, findModel: () => undefined as never })
    expect(unknown.err).toContain("no speech model")
    const missing = await transcribe(portal, [], { ...speech, isInstalled: () => false })
    expect(missing.err).toContain("models download")
    const negative = await transcribe(portal, ["--max-meetings", "-1"])
    expect(negative.err).toContain("--max-meetings takes a whole number")
  })
})

describe("meetings people", () => {
  it("finds the people on the stored calls", async () => {
    await b24(["work", "meetings", "sync", "--json"], { portal: portalWith([row(1)]) })
    const ran = await b24(["work", "meetings", "people", "79000000001", "--json"])
    expect(ran.code, ran.err).toBe(0)
    expect(ran.json()).toHaveProperty("items")
    const events = await b24(["work", "events", "list", "--json"])
    expect(events.code, events.err).toBe(0)
  })
})

describe("models", () => {
  it("lists the speech models meetings transcribe can use", async () => {
    const ran = await b24(["models", "list", "--json"])
    expect(ran.code, ran.err).toBe(0)
    expect(ran.out).toContain("gigaam-v3")
  })
})

describe("sync brings the calls too", () => {
  it("copies the calls after the CRM, keeps the CRM's answer the only one, and says how to read bare numbers", async () => {
    const portal = portalWith([row(1, { PHONE_NUMBER: "79000000001" })])
    const ran = await b24(["work", "sync", "--json"], { portal })
    expect(ran.code, ran.err).toBe(0)
    expect(ran.json().item).toMatchObject({ provider: "bitrix24" })
    expect(ran.err).toContain("calls: 1 copied")
    expect(ran.err).toContain("config set phone_region ru")
    expect(statistic(portal).length).toBeGreaterThan(0)
    const listed = (await b24(["work", "meetings", "list", "--json"])).json() as { items: unknown[] }
    expect(listed.items).toHaveLength(1)
  })

  it("keeps the CRM sync when the calls fail, with a note, and skips them with sync_calls off", async () => {
    const refused = portalWith([], {
      "voximplant.statistic.get": {
        status: 401,
        body: { error: "insufficient_scope", error_description: "The request requires higher privileges" },
      },
    })
    const ran = await b24(["work", "sync", "--json"], { portal: refused })
    expect(ran.code, ran.err).toBe(0)
    expect(ran.err).toContain("calls not copied")
    expect(ran.err).toContain("config set sync_calls false")
    expect((await b24(["work", "config", "set", "sync_calls", "false"])).code).toBe(0)
    const off = portalWith([row(1)])
    expect((await b24(["work", "sync", "--json"], { portal: off })).code).toBe(0)
    expect(statistic(off)).toHaveLength(0)
  })

  it("leaves the calls alone on a dry run", async () => {
    const portal = portalWith([row(1)])
    expect((await b24(["work", "sync", "--dry-run", "--json"], { portal })).code).toBe(0)
    expect(statistic(portal)).toHaveLength(0)
  })
})
