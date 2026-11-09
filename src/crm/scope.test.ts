import { memoryKeyring } from "@wirecat/cli-base"
import { openCache } from "@wirecat/cli-core/store"
import { describe, expect, it, vi } from "vitest"
import { fakeCrm } from "../testing/fake-crm.js"
import { FAKE_HOOK } from "../testing/fake-portal.js"
import { b24 } from "../testing/harness.js"

const SCOPE = "crm.bitrix24:example.bitrix24.test.scope"
const UNASSIGNED = "crm.bitrix24:example.bitrix24.test.unassigned"
const OWN = 7
const OTHER = 9
const INTEGRATION = 15

const portal = () => {
  const crm = fakeCrm()
  const deal = (title: string, assignedById: number) =>
    crm.put("deal", { title, categoryId: 0, stageId: "PREPARATION", assignedById })
  const ids = { own: deal("Own", OWN), other: deal("Other's", OTHER), form: deal("Website form", INTEGRATION) }
  crm.put("lead", { title: "Other's lead", stageId: "IN_PROCESS", assignedById: OTHER })
  return { crm, ids }
}

const sync = async (crm: ReturnType<typeof fakeCrm>) => {
  const ran = await b24(["work", "sync", "--json"], { portal: crm })
  return (ran.json() as { item: Record<string, unknown> }).item
}

const titles = async (crm: ReturnType<typeof fakeCrm>, kind = "deals") =>
  (
    (await b24(["work", kind, "list", "--offline", "--json"], { portal: crm })).json() as { items: { title: string }[] }
  ).items
    .map(({ title }) => title)
    .sort()

const set = async (setting: string, value: string) =>
  expect((await b24(["work", "config", "set", setting, value, "--json"])).code).toBe(0)

describe("sync scope", () => {
  it("copies the webhook user's deals and leads by default, and the unassigned users' once set", async () => {
    const { crm } = portal()
    expect((await sync(crm)).scope).toEqual({ mode: "mine", self: "7", also: [] })
    expect(await titles(crm)).toEqual(["Own"])
    expect(await titles(crm, "leads")).toEqual([])
    const listed = crm.calls.filter(({ method }) => method === "crm.deal.list")
    expect(listed[0]?.body.filter).toContainEqual(["assignedById", "in", [OWN]])

    await set(UNASSIGNED, String(INTEGRATION))
    expect((await sync(crm)).scope).toEqual({ mode: "mine", self: "7", also: [String(INTEGRATION)] })
    expect(await titles(crm)).toEqual(["Own", "Website form"])
  })

  it("drops a deal given to another user at the next sync", async () => {
    const { crm, ids } = portal()
    await sync(crm)
    crm.setClock(Date.now())
    crm.put("deal", { ...crm.row("deal", ids.own), assignedById: OTHER })
    const item = await sync(crm)
    expect((item.synced as Record<string, unknown>[]).find(({ kind }) => kind === "deal")).toMatchObject({
      round: "changes",
      out_of_scope: 1,
    })
    expect(await titles(crm)).toEqual([])
  })

  it("copies every deal for a department head under all, and drops the others' again for mine", async () => {
    const { crm } = portal()
    await set(SCOPE, "all")
    expect((await sync(crm)).scope).toEqual({ mode: "all" })
    expect(await titles(crm)).toEqual(["Other's", "Own", "Website form"])
    expect(await titles(crm, "leads")).toEqual(["Other's lead"])

    await set(SCOPE, "mine")
    await sync(crm)
    expect(await titles(crm)).toEqual(["Own"])
    expect(await titles(crm, "leads")).toEqual([])
  })

  it("brings a deal given to the user, drops one given away, and marks a deleted one", async () => {
    const { crm, ids } = portal()
    await sync(crm)
    crm.setClock(Date.now())
    crm.put("deal", { ...crm.row("deal", ids.other), assignedById: OWN })
    crm.put("deal", { ...crm.row("deal", ids.own), assignedById: OTHER })
    await sync(crm)
    expect(await titles(crm)).toEqual(["Other's"])

    crm.remove("deal", ids.other)
    // The id pass marks only rows saved an hour before it started, so a row a sync is still writing is never taken.
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + 2 * 3_600_000 })
    try {
      await b24(["work", "sync", "--rescan", "--json"], { portal: crm })
    } finally {
      vi.useRealTimers()
    }
    expect(await titles(crm)).toEqual([])
  })

  it("refuses scope all to an employee, and copies their own under mine", async () => {
    const { crm } = portal()
    crm.putDepartment({ ID: "1", NAME: "Example company", UF_HEAD: String(OTHER) })
    await set(SCOPE, "all")
    const ran = await b24(["work", "sync", "--json"], { portal: crm })
    expect(ran.code).not.toBe(0)
    const error = ran.json().error as { code: string; message: string }
    expect(error.code).toBe("configuration_error")
    expect(error.message).toContain("neither a Bitrix24 administrator nor the head of a department")
    expect(error.message).toContain(`config set ${SCOPE} mine`)
    expect(await titles(crm)).toEqual([])

    await set(SCOPE, "mine")
    await sync(crm)
    expect(await titles(crm)).toEqual(["Own"])
  })

  it("counts an employee whose webhook cannot read departments as no head, and says why", async () => {
    const { crm } = portal()
    crm.withhold("department")
    await set(SCOPE, "all")
    const ran = await b24(["work", "sync", "--json"], { portal: crm })
    expect((ran.json().error as { message: string }).message).toContain("lacks the department scope")
  })

  it("copies every deal for a portal administrator who heads no department", async () => {
    const { crm } = portal()
    crm.putDepartment({ ID: "1", NAME: "Example company", UF_HEAD: String(OTHER) })
    crm.setAdmin(true)
    await set(SCOPE, "all")
    expect((await sync(crm)).scope).toEqual({ mode: "all" })
    expect(await titles(crm)).toEqual(["Other's", "Own", "Website form"])
  })

  it("stops a manager who is no longer one from copying every deal", async () => {
    const { crm } = portal()
    await set(SCOPE, "all")
    await sync(crm)
    expect(await titles(crm)).toEqual(["Other's", "Own", "Website form"])
    crm.putDepartment({ ID: "1", NAME: "Example company", UF_HEAD: String(OTHER) })
    expect((await b24(["work", "sync", "--json"], { portal: crm })).code).not.toBe(0)
    await set(SCOPE, "mine")
    await sync(crm)
    expect(await titles(crm)).toEqual(["Own"])
  })

  it("refuses an unassigned list with an entry that is not a user id when it is set", async () => {
    const ran = await b24(["work", "config", "set", UNASSIGNED, "15,bot", "--json"])
    expect(ran.code).not.toBe(0)
    expect(ran.json().error).toMatchObject({ code: "validation_error" })
    expect(String((ran.json().error as { message: string }).message)).toContain('not "bot"')
  })

  it("reads no deal under a malformed unassigned value already stored, and points to the setting, not a retry", async () => {
    const { crm } = portal()
    await set(SCOPE, "mine")
    const database = await openCache(String(process.env.MESSAGING_STORE))
    database
      .prepare("INSERT INTO store_settings (key, value, at) VALUES (?, ?, 1)")
      .run(UNASSIGNED, JSON.stringify(["bot"]))
    database.close()
    const ran = await b24(["work", "sync", "--json"], { portal: crm })
    const answer = ran.json() as { item: Record<string, unknown>; next?: unknown }
    expect(answer.next).toBeUndefined()
    expect(String(answer.item.hint)).toContain(`b24 work config set ${UNASSIGNED}`)
    expect(await titles(crm)).toEqual([])
  })

  it("reads the webhook's user id however its address spells it", async () => {
    const { crm } = portal()
    const keyring = memoryKeyring({ "bitrix24-cli:token:work": FAKE_HOOK.replace("/rest/7/", "/rest/07/") })
    const ran = await b24(["work", "sync", "--json"], { portal: crm, keyring })
    expect((ran.json() as { item: Record<string, unknown> }).item.scope).toEqual({ mode: "mine", self: "7", also: [] })
    expect(crm.calls.find(({ method }) => method === "crm.deal.list")?.body.filter).toContainEqual([
      "assignedById",
      "in",
      [OWN],
    ])
    expect(await titles(crm)).toEqual(["Own"])
  })

  it("fails a kind whose list answer has no items, rather than take it for the end of the list", async () => {
    const crm = fakeCrm({ "crm.deal.list": { body: { result: {} } } })
    const deal = ((await sync(crm)).synced as Record<string, unknown>[]).find(({ kind }) => kind === "deal")
    expect(deal?.error).toMatch(/without its items/)
  })
})
