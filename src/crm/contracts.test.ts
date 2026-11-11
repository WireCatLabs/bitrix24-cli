import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { DealKind } from "@wirecat/cli-core"
import { crmSourceContract, crmSyncContract, crmWriteContract } from "@wirecat/cli-core/crm/testing"
import { type MessageStore, openStore } from "@wirecat/cli-core/store"
import { afterEach, describe, expect, it } from "vitest"
import { BitrixTransport } from "../bitrix/transport.js"
import { fakeCrm, seededCrm } from "../testing/fake-crm.js"
import { FAKE_WEBHOOK } from "../testing/fake-portal.js"
import { bitrixCrmSource } from "./source.js"
import { bitrixCrmWriter } from "./writer.js"

/** As an administrator: an employee may not delete or clear a field, which the write contract does. */
const over = (crm: ReturnType<typeof fakeCrm>) => {
  crm.setAdmin(true)
  const transport = new BitrixTransport({ webhook: FAKE_WEBHOOK, fetch: crm.fetch, sleep: async () => {} })
  const source = bitrixCrmSource(
    () => transport,
    Date.now,
    undefined,
    async () => ({ mode: "mine", also: ["7"], setting: "scope", chosen: "unassigned" }),
  )
  return { source, writer: bitrixCrmWriter(() => transport, source) }
}

const stores: MessageStore[] = []
afterEach(async () => {
  for (const store of stores.splice(0)) await store.close()
})

describe("crmSourceContract over the fake portal", () => {
  for (const { name, run } of crmSourceContract(() => ({
    source: over(seededCrm()).source,
    deadCursor: { kind: "deal", cursor: "not a time" },
  })))
    it(name, run)
})

describe("crmSyncContract over b24's store", () => {
  for (const { name, run } of crmSyncContract(async () => {
    const store = await openStore({ path: join(mkdtempSync(join(tmpdir(), "b24-sync-")), "store.db") })
    stores.push(store)
    return { store, account: { provider: "bitrix24", account: "example.bitrix24.test" } }
  }))
    it(name, run)
})

const ALIASES: Record<DealKind, string[]> = {
  deal: ["stageId", "STAGE_ID", "categoryId", "CATEGORY_ID", "assignedById", "ASSIGNED_BY_ID", "stageSemanticId"],
  lead: ["stageId", "STAGE_ID", "statusId", "STATUS_ID", "assignedById", "ASSIGNED_BY_ID"],
}

for (const kind of ["deal", "lead"] as const)
  describe(`crmWriteContract for ${kind}s over the fake portal`, () => {
    for (const { name, run } of crmWriteContract(async () => {
      const crm = fakeCrm()
      const { source, writer } = over(crm)
      const [pipeline] = await source.pipelines(kind)
      if (!pipeline) throw new Error("the fake portal has no pipeline")
      return {
        writer,
        kind,
        pipeline,
        aliases: ALIASES[kind],
        loseNextAnswer: crm.loseNextAnswer,
        requests: crm.writes,
      }
    }))
      it(name, run)
  })

describe("the Bitrix24 adapter", () => {
  it("runs against a fake that refuses a name REST 3.0 does not document, as the portal does", async () => {
    const crm = fakeCrm()
    const transport = new BitrixTransport({ webhook: FAKE_WEBHOOK, fetch: crm.fetch, sleep: async () => {} })
    for (const params of [{ select: ["id", "closedate"] }, { select: ["id"], filter: [["companyIds", "=", 1]] }])
      await expect(transport.call("crm.deal.list", params)).rejects.toMatchObject({
        code: "validation_error",
        details: { provider_error: "BITRIX_REST_V3_EXCEPTION_UNKNOWNDTOPROPERTYEXCEPTION" },
      })
    await expect(
      transport.call("crm.lead.add", { fields: { title: "x", closeTime: "2026-12-01" } }),
    ).rejects.toMatchObject({ details: { provider_error: "BITRIX_REST_V3_EXCEPTION_UNKNOWNDTOPROPERTYEXCEPTION" } })
  })

  it("runs against a fake that makes a repeated create a second record, as the live portal did", async () => {
    const crm = fakeCrm()
    const transport = new BitrixTransport({ webhook: FAKE_WEBHOOK, fetch: crm.fetch, sleep: async () => {} })
    const create = () =>
      transport.call("crm.lead.add", { fields: { title: "Example" } }, { idempotencyKey: "op-repeat" })
    const first = await create()
    const second = await create()
    expect(second.result).not.toEqual(first.result)
    expect(crm.writes()).toBe(2)
  })

  it("reads every stage of a directory, page by page, and none of another directory", async () => {
    const { source } = over(fakeCrm())
    const [sales] = await source.pipelines("deal")
    expect(sales?.stages.map((stage) => [stage.externalId, stage.outcome])).toEqual([
      ["NEW", "open"],
      ["PREPARATION", "open"],
      ["WON", "won"],
      ["LOSE", "lost"],
      ["APOLOGY", "lost"],
    ])
    expect((await source.pipelines("lead")).map(({ externalId, name }) => [externalId, name])).toEqual([["0", "Leads"]])
  })

  it("maps a deal into core's shape: decimal money, days, epoch times, the portal's custom fields with labels", async () => {
    const { source } = over(seededCrm())
    const page = await source.changes("deal", null)
    if ("reset" in page) throw new Error("reset")
    const [kitchen, partner] = page.items
    expect(kitchen).toMatchObject({
      title: "Example kitchen",
      pipeline: "0",
      stage: "PREPARATION",
      amount: "15000.5",
      currency: "EUR",
      closeDate: "2026-12-01",
      organization: expect.any(String),
      people: [{ externalId: expect.any(String), role: "contact" }],
      metadata: { UF_CRM_SOURCE: { label: "Source", value: "Website", option_id: "41" } },
    })
    expect(kitchen?.updatedAt).toBeTypeOf("number")
    expect(partner).toMatchObject({ pipeline: "1", stage: "C1:NEW", amount: null, currency: null })
  })

  it("reads changes from the last cursor with an overlap, by id, past the portal's page size", async () => {
    const crm = fakeCrm()
    for (let at = 0; at < 60; at += 1) crm.put("company", { title: `Example ${at}` })
    const { source } = over(crm)
    let page: string | undefined
    let listed = 0
    let cursor: string | null | undefined
    for (;;) {
      const answer = await source.changes("organization", null, page)
      if ("reset" in answer) throw new Error("reset")
      listed += answer.items.length
      if (answer.nextPage === undefined) {
        cursor = answer.cursor
        break
      }
      page = answer.nextPage
    }
    expect(listed).toBe(60)
    expect(cursor).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    const before = crm.calls.length
    await source.changes("organization", cursor ?? null)
    const filter = crm.calls[before]?.body.filter as unknown[][]
    expect(filter[0]?.slice(0, 2)).toEqual(["updatedTime", ">="])
    const overlap = Date.parse(String(cursor)) - Date.parse(String(filter[0]?.[2]))
    expect(overlap).toBeGreaterThanOrEqual(10 * 60_000)
    expect(overlap).toBeLessThan(10 * 60_000 + 1000)
    expect(filter[0]?.[2]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+00:00$/)
  })

  it("refuses a custom code that is a standard field before any request, and sends a list option as a number", async () => {
    const crm = seededCrm()
    const { writer } = over(crm)
    const before = crm.calls.length
    await expect(
      writer.update("deal", "102", { custom: { stage_id: "WON" } }, { operationId: "op-1" }),
    ).rejects.toMatchObject({ code: "validation_error" })
    expect(crm.calls.length).toBe(before)
    const changed = await writer.update(
      "deal",
      "102",
      { custom: { UF_CRM_SOURCE: "41", UF_CRM_NOTE: "Example note" } },
      { operationId: "op-2" },
    )
    expect(crm.row("deal", 102)).toMatchObject({ UF_CRM_SOURCE: 41, UF_CRM_NOTE: "Example note" })
    expect(changed.metadata).toMatchObject({
      UF_CRM_SOURCE: { label: "Source", value: "Website", option_id: "41" },
      UF_CRM_NOTE: { label: "Note", value: "Example note" },
    })
    await writer.update("deal", "102", { custom: { UF_CRM_NOTE: null } }, { operationId: "op-7" })
    expect(crm.row("deal", 102)?.UF_CRM_NOTE).toBeNull()
    await writer.update("deal", "102", { custom: { UF_CRM_TAGS: ["61", "62"] } }, { operationId: "op-8" })
    expect(crm.row("deal", 102)?.UF_CRM_TAGS).toEqual([61, 62])
    await writer.update("deal", "102", { custom: { UF_CRM_TAGS: null } }, { operationId: "op-9" })
    expect(crm.row("deal", 102)?.UF_CRM_TAGS).toEqual([])
  })

  it("resolves a label and an option label core passed as typed, from a store with no definitions yet", async () => {
    const crm = seededCrm()
    const { writer } = over(crm)
    await writer.update("deal", "102", { custom: { Source: "Website" } }, { operationId: "op-10" })
    expect(crm.row("deal", 102)).toMatchObject({ UF_CRM_SOURCE: 41 })
    const before = crm.writes()
    await expect(
      writer.update("deal", "102", { custom: { UF_CRM_SOURCE: "Nowhere" } }, { operationId: "op-11" }),
    ).rejects.toMatchObject({ code: "validation_error", details: { reason: "field.unknown-option" } })
    await expect(
      writer.update("deal", "102", { custom: { Unknown: "x" } }, { operationId: "op-12" }),
    ).rejects.toMatchObject({ details: { reason: "field.unknown" } })
    expect(crm.writes()).toBe(before)
  })

  it("closes a deal in the first won or lost stage of its own pipeline, and refuses a reason", async () => {
    const crm = seededCrm()
    const { writer } = over(crm)
    expect((await writer.close("deal", "102", "lost", { operationId: "op-3" })).stage).toBe("LOSE")
    expect((await writer.close("deal", "103", "won", { operationId: "op-4" })).stage).toBe("C1:WON")
    await expect(writer.close("deal", "102", "won", { operationId: "op-5", reason: "Example" })).rejects.toMatchObject({
      code: "validation_error",
    })
  })

  it("a write the portal made but whose read-back failed says so, and never reads as a failed write", async () => {
    const crm = seededCrm({ "crm.deal.get": { status: 503, body: { error: "INTERNAL_SERVER_ERROR" } } })
    const { writer } = over(crm)
    await expect(
      writer.update("deal", "102", { title: "Example renamed" }, { operationId: "op-6" }),
    ).rejects.toMatchObject({
      code: "invalid_response",
      details: { sent: true, operation_id: "op-6", external_id: "102" },
    })
    expect(crm.row("deal", 102)?.title).toBe("Example renamed")
  })
})
