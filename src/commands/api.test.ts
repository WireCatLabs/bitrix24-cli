import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { fakePortal, ok } from "../testing/fake-portal.js"
import { b24 } from "../testing/harness.js"

const withPermissions = async (permissions: Record<string, string>, body: () => Promise<void>) => {
  const dir = process.env.B24_CONFIG_DIR ?? ""
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "config.json"), JSON.stringify({ profiles: { work: { permissions } } }))
  try {
    await body()
  } finally {
    rmSync(join(dir, "config.json"))
  }
}

describe("api list and show", () => {
  it("list names each method's REST version, effect and permission", async () => {
    const ran = await b24(["api", "list", "effect:destructive", "scope:crm", "--json"])
    const items = (ran.json() as { items: Record<string, unknown>[] }).items
    expect(items.map((one) => one.name)).toContain("crm.deal.delete")
    expect(items.find((one) => one.name === "crm.deal.delete")).toMatchObject({
      rest: "3.0",
      default_level: "ask",
      permission: "api.crm.deal.delete",
      also_checks: ["deals.delete"],
    })
  })

  it("show tells a messaging write is denied and calls nothing", async () => {
    const ran = await b24(["api", "show", "im.message.add", "--json"])
    expect(ran.json().item).toMatchObject({ rest: "2", effect: "write", default_level: "deny" })
    expect((await b24(["api", "show", "not a method"])).code).toBe(2)
  })
})

describe("api call", () => {
  it("calls a read on its REST version and marks the answer untrusted", async () => {
    const portal = fakePortal({ "crm.deal.list": ok({ items: [{ id: 1 }] }), "crm.status.list": ok([], { total: 0 }) })
    const ran = await b24(["work", "api", "call", "crm.deal.list", "--body", '{"select":["id"]}', "--json"], { portal })
    expect(ran.json().item).toMatchObject({
      method: "crm.deal.list",
      result: { items: [{ id: 1 }] },
      untrusted: expect.any(String),
    })
    expect(portal.calls[0]).toMatchObject({ api: 3, body: { select: ["id"] } })
    expect((await b24(["work", "api", "call", "crm.status.list", "--json"], { portal })).json().item).toMatchObject({
      total: 0,
    })
  })

  it("a write answers its operation_id and sends it as the Idempotency-Key", async () => {
    const portal = fakePortal({ "crm.contact.update": ok({ result: true }) })
    const ran = await b24(
      ["work", "api", "call", "crm.contact.update", "--body", '{"id":4,"fields":{"post":"Buyer"}}', "--json"],
      { portal },
    )
    const item = ran.json().item as { operation_id: string }
    expect(item).toMatchObject({ result: { result: true } })
    expect(portal.calls[0]?.headers["Idempotency-Key"]).toBe(item.operation_id)
  })

  it("denies messages to people and batch until the owner allows them, sending nothing", async () => {
    const portal = fakePortal({ "im.message.add": ok(1), batch: ok({}) })
    expect(
      (await b24(["work", "api", "call", "im.message.add", "--body", '{"DIALOG_ID":1,"MESSAGE":"x"}'], { portal }))
        .code,
    ).toBe(5)
    expect((await b24(["work", "api", "call", "batch", "--body", '{"cmd":{}}'], { portal })).code).toBe(5)
    expect(portal.calls).toHaveLength(0)
  })

  it("checks the command key the raw call does the same as", async () => {
    const portal = fakePortal({ "crm.deal.update": ok({ result: true }) })
    await withPermissions({ "deals.move": "deny" }, async () => {
      const moved = ["work", "api", "call", "crm.deal.update", "--body", '{"id":1,"fields":{"stageId":"WON"}}']
      expect((await b24(moved, { portal })).code).toBe(5)
      expect(
        (await b24(["work", "api", "call", "crm.deal.update", "--body", '{"id":1,"fields":{"title":"x"}}'], { portal }))
          .code,
      ).toBe(0)
    })
    const assigning = ["work", "api", "call", "crm.deal.update", "--body", '{"id":1,"fields":{"assignedById":9}}']
    expect((await b24(assigning, { portal })).code).toBe(5)
  })

  it("asks before a delete, and runs it on --yes", async () => {
    const portal = fakePortal({ "crm.contact.delete": ok(true) })
    const call = ["work", "api", "call", "crm.contact.delete", "--body", '{"id":4}']
    expect((await b24(call, { portal })).code).toBe(7)
    expect(portal.calls).toHaveLength(0)
    expect((await b24([...call, "--yes"], { portal })).code).toBe(0)
  })

  it("refuses a read the owner denied, and a body that is not an object", async () => {
    await withPermissions({ "api.crm.deal.list": "deny" }, async () => {
      expect((await b24(["work", "api", "call", "crm.deal.list"])).code).toBe(5)
    })
    expect((await b24(["work", "api", "call", "crm.deal.list", "--body", "[]"])).code).toBe(2)
    expect((await b24(["work", "api", "call", "crm.deal.list", "--body", "{"])).code).toBe(2)
  })
})
