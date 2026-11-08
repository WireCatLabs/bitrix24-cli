import { describe, expect, it } from "vitest"
import { FAKE_HOOK, fakePortal, ok } from "./fake-portal.js"

const send = (method: string, body: unknown) =>
  fakePortal({ [method]: ok([]) }).fetch(`${FAKE_HOOK}${method}`, { method: "POST", body: JSON.stringify(body) })

describe("fakePortal", () => {
  it("fails a REST 2 call that names a product or user field the docs do not list", async () => {
    await expect(send("crm.product.list", { select: ["NAME"], filter: { "%NAEM": "x" } })).rejects.toThrow(/NAEM/)
    await expect(send("user.get", { FILTER: { NAME_SERACH: "x" } })).rejects.toThrow(/NAME_SERACH/)
    await expect(
      send("crm.product.list", { select: ["ID"], filter: { "=ACTIVE": "Y" }, order: { ID: "DESC" } }),
    ).resolves.toBeDefined()
    await expect(
      send("user.get", { FILTER: { NAME_SEARCH: "x", USER_TYPE: "employee" }, sort: "ID" }),
    ).resolves.toBeDefined()
  })
})
