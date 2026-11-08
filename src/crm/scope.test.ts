import { openCache } from "@wirecat/cli-core/store"
import { describe, expect, it } from "vitest"
import { fakeCrm } from "../testing/fake-crm.js"
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
    expect((await sync(crm)).scope).toEqual({ mode: "mine", also: [] })
    expect(await titles(crm)).toEqual(["Own"])
    expect(await titles(crm, "leads")).toEqual([])
    const listed = crm.calls.filter(({ method }) => method === "crm.deal.list")
    expect(listed[0]?.body.filter).toContainEqual(["assignedById", "in", [OWN]])

    await set(UNASSIGNED, String(INTEGRATION))
    expect((await sync(crm)).scope).toEqual({ mode: "mine", also: [String(INTEGRATION)] })
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

  it("copies every deal for all, and drops the others' again for mine", async () => {
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
})
