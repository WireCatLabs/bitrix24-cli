import { memoryKeyring } from "@wirecat/cli-base"
import { describe, expect, it } from "vitest"
import { seededCrm } from "../testing/fake-crm.js"
import { FAKE_SECRET } from "../testing/fake-portal.js"
import { b24, synced } from "../testing/harness.js"

type Item = Record<string, unknown>
const items = (ran: Awaited<ReturnType<typeof b24>>) => (ran.json() as { items: Item[] }).items
const item = (ran: Awaited<ReturnType<typeof b24>>) => (ran.json() as { item: Item }).item

describe("sync", () => {
  it("copies the portal into the store, in its own recorded run with the portal's requests in it", async () => {
    const portal = seededCrm()
    const ran = await b24(["work", "sync", "--json", "--record"], { portal })
    expect(ran.code).toBe(0)
    expect(item(ran)).toMatchObject({ provider: "bitrix24", account: "example.bitrix24.test", state: "complete" })
    const runId = (ran.json().meta as { run_id: string }).run_id
    expect(runId).toMatch(/-sync-/)
    const shown = await b24(["runs", "show", runId, "--json"])
    expect(shown.code).toBe(0)
    expect(shown.out).toContain("crm.deal.list")
    expect(ran.out + ran.err + shown.out).not.toContain(FAKE_SECRET)
  })

  it("refuses --offline and a profile with no sign-in before any request", async () => {
    const portal = seededCrm()
    expect((await b24(["work", "sync", "--offline"], { portal })).code).toBe(5)
    expect((await b24(["other", "sync"], { portal, keyring: memoryKeyring() })).code).toBe(4)
    expect(portal.calls).toHaveLength(0)
  })

  it("store status says how far each kind is", async () => {
    await synced()
    const rows = items(await b24(["work", "store", "status", "--json"]))
    expect(rows.map(({ kind, state, stored }) => [kind, state, stored])).toEqual([
      ["organization", "complete", 1],
      ["person", "complete", 1],
      ["deal", "complete", 2],
      ["lead", "complete", 1],
    ])
  })
})

describe("fields list", () => {
  it("lists the portal's fields of each kind as the sync stored them, a contact's included", async () => {
    const { portal } = await synced()
    const before = portal.calls.length
    const people = items(await b24(["work", "--offline", "fields", "list", "people", "--json"], { portal }))
    expect(people).toEqual([
      {
        code: "UF_CRM_CHANNEL",
        label: "Channel",
        type: "enumeration",
        multiple: true,
        filterable: true,
        options: [
          { id: "51", label: "Phone" },
          { id: "52", label: "Fair" },
        ],
        untrusted: ["label", "options.label"],
      },
    ])
    const deals = items(await b24(["work", "--offline", "fields", "list", "deals", "--json"], { portal }))
    expect(deals.map(({ code }) => code)).toEqual(["UF_CRM_SOURCE", "UF_CRM_NOTE", "UF_CRM_TAGS"])
    const second = await b24(["work", "fields", "list", "deals", "--limit", "1", "--page", "2", "--json"], { portal })
    expect(items(second).map(({ code }) => code)).toEqual(["UF_CRM_NOTE"])
    expect(items(await b24(["work", "fields", "list", "deals", "--all", "--json"], { portal }))).toHaveLength(3)
    expect(portal.calls.length).toBe(before)
  })
})

describe("sync and field definitions", () => {
  it("syncs the records without definitions when the webhook may not read them", async () => {
    const portal = seededCrm({ "crm.deal.field.list": { status: 403, body: { error: "ACCESS_DENIED" } } })
    expect((await b24(["work", "sync", "--json"], { portal })).code).toBe(0)
    expect(items(await b24(["work", "--offline", "fields", "list", "deals", "--json"], { portal }))).toEqual([])
    expect(items(await b24(["work", "--offline", "deals", "list", "--json"], { portal }))).toHaveLength(2)
  })

  it("fails the sync on any other failure, rather than mark the stored definitions deleted", async () => {
    const { portal } = await synced()
    const failing = seededCrm({ "crm.deal.field.list": { status: 503, body: { error: "INTERNAL_SERVER_ERROR" } } })
    expect((await b24(["work", "sync", "--json"], { portal: failing })).code).not.toBe(0)
    expect(items(await b24(["work", "--offline", "fields", "list", "deals", "--json"], { portal }))).toHaveLength(3)
  })
})

describe("lists read the store, --offline too", () => {
  it("deals and leads in core's shape: status, pipeline, stage, close date, a decimal amount, assignee, custom values", async () => {
    const { portal } = await synced()
    const before = portal.calls.length
    const deals = items(await b24(["work", "--offline", "deals", "list", "status:open", "--json"], { portal }))
    expect(deals.find((one) => one.external_id === "102")).toMatchObject({
      title: "Example kitchen",
      status: "open",
      pipeline_name: "Example sales",
      stage: "Quote sent",
      amount: "15000.50",
      currency: "EUR",
      close_date: "2026-12-01",
      organization: { name: "Example Ltd" },
      people: [{ name: "Anna Example", role: "contact" }],
      assignee: "example.bitrix24.test/user/7",
      provider_metadata: { UF_CRM_SOURCE: { label: "Source", value: "Website", option_id: "41" } },
    })
    const [lead] = items(await b24(["work", "leads", "list", "--json"], { portal }))
    expect(lead).toMatchObject({ pipeline_name: "Leads", stage: "In progress", amount: "300.00" })
    const stages = items(await b24(["work", "stages", "list", "kind:lead", "--json"], { portal }))
    expect(stages.map(({ name, outcome }) => [name, outcome])).toEqual([
      ["Unprocessed", "open"],
      ["In progress", "open"],
      ["Good lead", "won"],
      ["Junk", "lost"],
    ])
    expect(portal.calls.length).toBe(before)
  })
})

describe("writes", () => {
  it("create sends the operation id as the Idempotency-Key and stores the portal's copy", async () => {
    const { portal } = await synced()
    const ran = await b24(
      [
        "work",
        "deals",
        "create",
        "--title",
        "WireCat test deal",
        "--pipeline",
        "Example sales",
        "--amount",
        "1500.50",
        "--currency",
        "EUR",
        "--field",
        "Source=Website",
        "--json",
      ],
      { portal },
    )
    expect(ran.code).toBe(0)
    const answer = item(ran) as { operation_id: string; deal: Item }
    expect(answer.deal).toMatchObject({ title: "WireCat test deal", stage: "New", amount: "1500.50" })
    const add = portal.calls.find((call) => call.method === "crm.deal.add")
    expect(add?.headers["Idempotency-Key"]).toBe(answer.operation_id)
    expect(add?.body).toEqual({
      fields: { title: "WireCat test deal", categoryId: 0, opportunity: 1500.5, currencyId: "EUR", UF_CRM_SOURCE: 41 },
    })
    const shown = await b24(["work", "--offline", "deals", "show", String(answer.deal.ref), "--json"], { portal })
    expect(item(shown)).toMatchObject({ title: "WireCat test deal" })
  })

  it("--field with no key before its = is refused before any request", async () => {
    const { portal, ref, calls } = await synced()
    const before = calls()
    for (const pair of ["=x", " =x"]) {
      const ran = await b24(["work", "deals", "update", ref("deals", 102), "--field", pair, "--json"], { portal })
      expect(ran.code).toBe(2)
      const error = ran.json().error as { code: string; message: string }
      expect(error.code).toBe("validation_error")
      expect(error.message).toContain("--field")
    }
    expect(calls()).toBe(before)
  })

  it("a write whose answer is lost is sent once, is outcome_unknown, and its --operation-id repeat is replayed", async () => {
    const { portal, ref } = await synced()
    portal.loseNextAnswer()
    const typed = ["work", "deals", "update", ref("deals", 102), "--title", "Example renamed", "--json"]
    const lost = await b24(typed, { portal })
    expect(lost.code).toBe(14)
    const error = lost.json().error as { message: string; details: { operation_id: string } }
    expect(error.message).toContain("--operation-id")
    expect(portal.writes()).toBe(1)
    const again = await b24([...typed, "--operation-id", error.details.operation_id], { portal })
    expect(again.code).toBe(0)
    expect(portal.row("deal", 102)?.title).toBe("Example renamed")
  })

  it("move and close go to a stage of the deal's own pipeline; delete asks first", async () => {
    const { portal, ref } = await synced()
    const deal = ref("deals", 102)
    expect(item(await b24(["work", "deals", "move", deal, "New", "--json"], { portal }))).toMatchObject({
      deal: { stage: "New", status: "open" },
    })
    expect(item(await b24(["work", "deals", "close", deal, "lost", "--json"], { portal }))).toMatchObject({
      deal: { stage: "Lost", status: "lost" },
    })
    const writes = portal.writes()
    expect((await b24(["work", "deals", "delete", deal], { portal })).code).toBe(7)
    expect(portal.writes()).toBe(writes)
    expect(item(await b24(["work", "deals", "delete", deal, "--yes", "--json"], { portal }))).toMatchObject({
      removed: 1,
    })
    expect(portal.row("deal", 102)).toBeUndefined()
  })

  it("refuses under B24_READ_ONLY before any request", async () => {
    const { portal, ref, calls } = await synced()
    const before = calls()
    const ran = await b24(["work", "deals", "update", ref("deals", 102), "--title", "x"], {
      portal,
      env: { B24_READ_ONLY: "1" },
    })
    expect(ran.code).toBe(5)
    expect(calls()).toBe(before)
  })

  it("refuses a lead's close date and a close reason before any write", async () => {
    const { portal, ref } = await synced()
    expect(
      (await b24(["work", "leads", "update", ref("leads", 104), "--close-date", "2026-12-01"], { portal })).code,
    ).toBe(2)
    expect(
      (await b24(["work", "deals", "close", ref("deals", 102), "won", "--reason", "Example"], { portal })).code,
    ).toBe(2)
    expect(portal.writes()).toBe(0)
  })
})
