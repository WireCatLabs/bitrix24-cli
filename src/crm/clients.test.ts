import { mkdirSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import { describe, expect, it } from "vitest"
import type { BitrixTransport } from "../bitrix/transport.js"
import { fakeCrm } from "../testing/fake-crm.js"
import { b24 } from "../testing/harness.js"
import { DAILY_FOREIGN, quotaFile } from "./clients.js"

const OWN = 7
const OTHER = 9
const phone = (value: string) => [{ valueType: "WORK", value }]

const portal = () => {
  const crm = fakeCrm()
  const contact = (name: string, assignedById: number) =>
    crm.put("contact", { name, assignedById, phone: phone(`+7 900 000-00-${String(assignedById).padStart(2, "0")}`) })
  const ids = {
    mine: contact("Mine", OWN),
    onDeal: contact("On my deal", OTHER),
    stranger: contact("Stranger", OTHER),
  }
  crm.put("deal", { title: "Own", categoryId: 0, stageId: "PREPARATION", assignedById: OWN, contactsId: [ids.onDeal] })
  return { crm, ids }
}

const phones = async (crm: ReturnType<typeof fakeCrm>) => {
  const ran = await b24(["work", "people", "list", "--json"], { portal: crm })
  const items = (ran.json() as { items: { name: string; phones?: unknown[] }[] }).items
  return Object.fromEntries(items.map(({ name, phones }) => [name, Boolean(phones?.length)]))
}

const quota = () =>
  quotaFile(process.env, { origin: "https://example.bitrix24.test", userId: String(OWN) } as BitrixTransport)

const used = (count: number) => {
  const file = quota()
  mkdirSync(dirname(file), { recursive: true })
  const seen = Array.from({ length: count }, (_, at) => `contact:${1000 + at}`)
  writeFileSync(file, JSON.stringify({ day: new Date().toISOString().slice(0, 10), seen }))
}

describe("contacts and companies that are not the user's clients", () => {
  it("lists them without phones and e-mails for anyone but an administrator", async () => {
    const { crm } = portal()
    expect(await phones(crm)).toEqual({ Mine: true, "On my deal": true, Stranger: false })
    crm.setAdmin(true)
    expect(await phones(crm)).toEqual({ Mine: true, "On my deal": true, Stranger: true })
  })

  it("shows one with its phones, a hundred a day, and the user's own clients for free", async () => {
    const { crm, ids } = portal()
    used(DAILY_FOREIGN - 1)
    const show = (id: number) => b24(["work", "people", "show", String(id), "--json"], { portal: crm })

    expect((await show(ids.stranger)).code).toBe(0)
    expect((await show(ids.stranger)).code).toBe(0)
    const other = crm.put("contact", { name: "Second stranger", assignedById: OTHER })
    const over = await show(other)
    expect(over.code).not.toBe(0)
    expect(over.json().error).toMatchObject({
      code: "permission_error",
      message: expect.stringContaining("the most a day"),
    })
    expect((await show(ids.mine)).code).toBe(0)
    expect((await show(ids.onDeal)).code).toBe(0)

    crm.setAdmin(true)
    expect((await show(other)).code).toBe(0)
  })

  it("refuses api call reads of contacts and companies to anyone but an administrator", async () => {
    const { crm } = portal()
    const call = (method: string, body = "{}") =>
      b24(["work", "api", "call", method, "--body", body, "--json"], { portal: crm })
    for (const [method, body] of [
      ["crm.contact.list", "{}"],
      ["crm.company.get", '{"id":1}'],
      ["crm.item.list", '{"entityTypeId":3}'],
      ["crm.requisite.list", "{}"],
    ] as const) {
      const ran = await call(method, body)
      expect(ran.code, method).not.toBe(0)
      expect(ran.json().error, method).toMatchObject({
        code: "permission_error",
        message: expect.stringContaining("only a Bitrix24 administrator reads"),
      })
    }
    expect(crm.calls.some(({ method }) => method === "crm.contact.list")).toBe(false)

    crm.setAdmin(true)
    expect((await call("crm.contact.list", '{"select":["id"]}')).code).toBe(0)
  })
})
