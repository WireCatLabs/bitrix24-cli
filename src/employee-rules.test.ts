import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { mcpOverStdio } from "@wirecat/cli-core/testing"
import { afterEach, describe, expect, it } from "vitest"
import { employeeRuleOf } from "./api-keys.js"
import { run } from "./program.js"
import { fakePortal, ok } from "./testing/fake-portal.js"
import { b24, signedIn, synced } from "./testing/harness.js"

const refusal = (rule: string) => ({ code: "permission_error", reason: `employee.${rule}`, details: { sent: false } })

const config = () => join(process.env.B24_CONFIG_DIR ?? "", "config.json")
const allowing = (...keys: string[]) => {
  mkdirSync(process.env.B24_CONFIG_DIR ?? "", { recursive: true })
  const permissions = Object.fromEntries(keys.map((key) => [key, "allow"]))
  writeFileSync(config(), JSON.stringify({ profiles: { work: { permissions } } }))
}
afterEach(() => rmSync(config(), { force: true }))

describe("what only a Bitrix24 administrator's webhook may do", () => {
  it("refuses an employee's deal delete even when the profile allows it, and lets an administrator", async () => {
    const { portal, ref } = await synced()
    const deal = ref("deals", 102)
    const writes = portal.writes()
    allowing("deals.delete", "api.crm.deal.delete")
    const ran = await b24(["work", "deals", "delete", deal, "--json"], { portal })
    expect(ran.code).not.toBe(0)
    expect(ran.json().error).toMatchObject({
      ...refusal("delete"),
      message: expect.stringContaining("only a Bitrix24 administrator"),
    })
    expect(portal.writes()).toBe(writes)
    expect(portal.row("deal", 102)).toBeDefined()

    portal.setAdmin(true)
    expect((await b24(["work", "deals", "delete", deal, "--yes", "--json"], { portal })).code).toBe(0)
    expect(portal.row("deal", 102)).toBeUndefined()
  })

  it("refuses an employee's deal delete over MCP", async () => {
    const { portal, ref } = await synced()
    allowing("deals.delete")
    const mcp = await mcpOverStdio((streams) =>
      run(["work", "mcp", "serve"], {
        tty: false,
        streams: { data: () => {}, diagnostic: () => {} },
        keyring: signedIn(),
        fetch: portal.fetch,
        sleep: async () => {},
        ...streams,
      } as Parameters<typeof run>[1]),
    )
    try {
      const answer = await mcp.call("b24_write", { command: "deals delete", arguments: { deal: ref("deals", 102) } })
      expect(JSON.stringify(answer)).toContain("employee.delete")
    } finally {
      await mcp.close()
    }
    expect(portal.row("deal", 102)).toBeDefined()
  })

  it("refuses an employee's api call to a .delete method and a batch with a delete inside", async () => {
    const { portal } = await synced()
    const writes = portal.writes()
    allowing("deals.delete", "api.crm.deal.delete", "api.crm.item.delete", "api.batch")
    const call = (method: string, body: string) =>
      b24(["work", "api", "call", method, "--body", body, "--json"], { portal })
    expect((await call("crm.deal.delete", '{"id":102}')).json().error).toMatchObject(refusal("delete"))
    expect((await call("CRM.Item.Delete.json", '{"entityTypeId":2,"id":102}')).json().error).toMatchObject(
      refusal("delete"),
    )
    expect((await call("batch", '{"cmd":{"a":"crm.deal.delete?id=102"}}')).json().error).toMatchObject(refusal("batch"))
    expect(portal.writes()).toBe(writes)
  })

  it("refuses an employee's unbind and merge of duplicates through api call, and lets an administrator", async () => {
    const methods = { "crm.timeline.bindings.unbind": ok(true), "crm.entity.mergebatch": ok({ STATUS: "SUCCESS" }) }
    allowing("api.crm.timeline.bindings.unbind", "api.crm.entity.mergebatch")
    const call = (portal: ReturnType<typeof fakePortal>, method: string, body: string) =>
      b24(["work", "api", "call", method, "--body", body, "--json"], { portal })
    const unbind = '{"fields":{"OWNER_ID":1,"ENTITY_ID":102,"ENTITY_TYPE":"deal"}}'
    const merge = '{"params":{"entityTypeId":3,"entityIds":[1,2]}}'
    const employee = fakePortal({ "user.admin": ok(false), ...methods })
    expect((await call(employee, "crm.timeline.bindings.unbind", unbind)).json().error).toMatchObject(refusal("unbind"))
    expect((await call(employee, "crm.entity.mergeBatch", merge)).json().error).toMatchObject(refusal("merge"))
    expect(employee.calls.every(({ method }) => method === "user.admin")).toBe(true)

    const admin = fakePortal(methods)
    expect((await call(admin, "crm.timeline.bindings.unbind", unbind)).code).toBe(0)
    expect((await call(admin, "crm.entity.mergeBatch", merge)).code).toBe(0)
  })

  it("refuses an employee's update that clears a field, through a command and through api call", async () => {
    const { portal, ref } = await synced()
    const writes = portal.writes()
    const cleared = await b24(["work", "deals", "update", ref("deals", 102), "--field", "Note=", "--json"], { portal })
    expect(cleared.json().error).toMatchObject(refusal("clear"))
    const api = (body: string) => b24(["work", "api", "call", "crm.deal.update", "--body", body, "--json"], { portal })
    for (const body of [
      '{"id":102,"fields":{"title":""}}',
      '{"id":102,"fields":{"contactsId":[]}}',
      '{"id":102,"fields":{"COMPANY_ID":0}}',
    ])
      expect((await api(body)).json().error, body).toMatchObject(refusal("clear"))
    expect(portal.writes()).toBe(writes)

    expect((await api('{"id":102,"fields":{"title":"Example renamed"}}')).code).toBe(0)
    portal.setAdmin(true)
    expect((await api('{"id":102,"fields":{"title":""}}')).code).toBe(0)
  })

  it("names the rule each method falls under, and leaves creates and plain updates alone", () => {
    expect(employeeRuleOf("crm.deal.contact.items.set", { id: 1, items: [] })).toBe("clear")
    expect(employeeRuleOf("crm.contact.update", { id: 1, fields: { PHONE: [{ ID: 5, DELETE: "Y" }] } })).toBe("clear")
    expect(employeeRuleOf("crm.contact.update", { id: 1, fields: { phone: [{ value: " " }] } })).toBe("clear")
    expect(employeeRuleOf("disk.file.markdeleted", { id: 1 })).toBe("delete")
    expect(employeeRuleOf("crm.deal.contact.items.delete", { id: 1 })).toBe("delete")
    expect(employeeRuleOf("event.unbind", {})).toBe("unbind")
    expect(employeeRuleOf("CRM.Entity.MergeBatch.json", {})).toBe("merge")
    expect(employeeRuleOf("crm.duplicate.findbycomm", {})).toBeUndefined()
    expect(employeeRuleOf("crm.deal.add", { fields: { title: "", companyId: 0 } })).toBeUndefined()
    expect(employeeRuleOf("crm.deal.update", { id: 1, fields: { categoryId: 0, opportunity: 0 } })).toBeUndefined()
  })
})
