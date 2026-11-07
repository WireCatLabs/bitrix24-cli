import { crmGapsOf } from "@wirecat/cli-core/crm"
import { type MessageStore, openCache, openStore } from "@wirecat/cli-core/store"
import { afterEach, describe, expect, it } from "vitest"
import { fakeCrm } from "../testing/fake-crm.js"
import { b24, synced } from "../testing/harness.js"

const PORTAL = { provider: "bitrix24", account: "example.bitrix24.test" }
const ALICE = {
  name: "Alice",
  lastName: "Example",
  post: "Procurement manager",
  email: [{ valueTypeId: "WORK", value: "alice@acme.example" }],
}

/**
 * Northstar is the own company, Acme the client. Emma, a portal user, owns the Acme renewal and reports to Grace,
 * the head of her department; Alice and Bob are Acme's contacts on the deal.
 */
const northstar = () => {
  const crm = fakeCrm()
  const own = crm.putMine({ id: 1, title: "Northstar Consulting" })
  crm.putDepartment({ ID: "1", NAME: "Northstar", UF_HEAD: "8" })
  crm.putUser({ ID: "7", NAME: "Emma", LAST_NAME: "Stone", EMAIL: "emma@northstar.example", UF_DEPARTMENT: [1] })
  crm.putUser({ ID: "8", NAME: "Grace", LAST_NAME: "Hall", EMAIL: "grace@northstar.example", UF_DEPARTMENT: [1] })
  const acme = crm.put("company", { title: "Acme Ltd", typeId: "CUSTOMER" })
  const alice = crm.put("contact", { ...ALICE, companiesId: [acme] })
  const bob = crm.put("contact", {
    name: "Bob",
    lastName: "Example",
    post: "CEO",
    companiesId: [acme],
    email: [{ valueTypeId: "WORK", value: "bob@acme.example" }],
  })
  const deal = crm.put("deal", {
    title: "Acme renewal",
    categoryId: 0,
    stageId: "NEW",
    companyId: acme,
    contactsId: [alice, bob],
    assignedById: 7,
  })
  return { crm, own, acme, alice, bob, deal }
}

const stores: MessageStore[] = []
afterEach(async () => {
  for (const store of stores.splice(0)) await store.close()
})

const opened = async () => {
  const store = await openStore({ path: process.env.MESSAGING_STORE as string })
  stores.push(store)
  const person = async (email: string) => {
    const found = await store.people.personOf({ provider: "email", id: email })
    if (!found) throw new Error(`no person has ${email}`)
    return `person:${found.uid}`
  }
  const organization = async (name: string) =>
    `organization:${(await store.knowledge.organizations()).find((one) => one.name === name)?.id}`
  return { store, person, organization }
}

const memberships = async (store: MessageStore, ref: string) =>
  (await store.knowledge.relations(null, ref)).filter(({ kind }) => kind === "member-of")

const rows = async (sql: string, ...values: unknown[]) => {
  const database = await openCache(process.env.MESSAGING_STORE as string)
  try {
    return database.prepare(sql).all(...(values as never[]))
  } finally {
    database.close()
  }
}

const resync = async (crm: ReturnType<typeof fakeCrm>) => {
  const ran = await b24(["work", "sync", "--rescan", "--json"], { portal: crm })
  if (ran.code !== 0) throw new Error(`sync failed: ${ran.err}`)
  return ran.json() as { item: { issues: { kind: string; reason: string }[]; users?: number } }
}

describe("relationships from the portal", () => {
  it("makes Acme's contacts its members, the deal's contacts and owner its people, and Emma Northstar's employee", async () => {
    const { crm, deal: dealId } = northstar()
    const { ref } = await synced(crm)
    const { store, person, organization } = await opened()
    const alice = await person("alice@acme.example")
    const bob = await person("bob@acme.example")
    const emma = await person("emma@northstar.example")
    const grace = await person("grace@northstar.example")
    const acme = await organization("Acme Ltd")
    const own = await organization("Northstar Consulting")
    for (const contact of [alice, bob])
      expect(await memberships(store, contact)).toEqual([
        expect.objectContaining({ kind: "member-of", to: acme, role: "contact", standing: "reported" }),
      ])
    const deal = ref("deals", dealId)
    expect((await store.deals.get(deal)).people.map(({ ref: one, role }) => [one, role]).sort()).toEqual(
      [
        [alice, "contact"],
        [bob, "contact"],
        [emma, "owner"],
      ].sort(),
    )
    expect(await store.knowledge.relations(null, emma)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "member-of", to: own, role: "employee", standing: "reported" }),
        expect.objectContaining({ kind: "reports-to", from: emma, to: grace, standing: "reported" }),
      ]),
    )
    expect((await store.knowledge.relations(null, grace)).filter(({ kind }) => kind === "reports-to")).toEqual([
      expect.objectContaining({ from: emma, to: grace }),
    ])
    expect((await store.knowledge.relations(null, alice)).some(({ kind }) => kind === "reports-to")).toBe(false)
    expect(
      await rows(
        "SELECT json_extract(metadata, '$.position') AS position, json_extract(metadata, '$.primary') AS main " +
          "FROM links WHERE kind = 'member-of' AND role = 'contact' AND from_id = ?",
        Number(alice.slice("person:".length)),
      ),
    ).toEqual([{ position: "Procurement manager", main: 1 }])
    expect(
      await rows("SELECT json_extract(metadata, '$.derived') AS derived FROM links WHERE kind = 'reports-to'"),
    ).toEqual([{ derived: "department-head" }])
  })

  it("syncs three times into one link per relationship, the own company and its employees kept", async () => {
    const { crm } = northstar()
    await synced(crm)
    const links = async () => [
      await rows("SELECT id, kind, from_id, to_id, role, deleted_at FROM links ORDER BY id"),
      await rows("SELECT count(*) AS n FROM link_revisions"),
    ]
    const first = await links()
    await resync(crm)
    await resync(crm)
    expect(await links()).toEqual(first)
    // Four memberships, three people on the deal, one reporting line; none withdrawn by the daily id pass.
    expect(first[0]?.map(({ deleted_at }) => deleted_at)).toEqual(Array(8).fill(null))
    const { store, person, organization } = await opened()
    const own = await organization("Northstar Consulting")
    expect(await store.knowledge.relations(null, await person("emma@northstar.example"))).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "member-of", to: own, standing: "reported" })]),
    )
  })

  it("withdraws Alice's place at Acme once she leaves it, and keeps the link as ended", async () => {
    const { crm, alice } = northstar()
    await synced(crm)
    crm.put("contact", { ...ALICE, id: alice, companiesId: [] })
    await resync(crm)
    const { store, person, organization } = await opened()
    expect(await memberships(store, await person("alice@acme.example"))).toEqual([
      expect.objectContaining({ kind: "member-of", to: await organization("Acme Ltd"), standing: "ended" }),
    ])
  })

  it("names a webhook without the department scope as a gap, and keeps its users and their reporting lines", async () => {
    const { crm } = northstar()
    await synced(crm)
    crm.withhold("department")
    const report = await resync(crm)
    expect(report.item.users).toBe(2)
    expect(report.item.issues).toEqual([expect.objectContaining({ kind: "user", reason: "crm.not-reported" })])
    const { store, person } = await opened()
    expect(await crmGapsOf(store, PORTAL)).toEqual([
      expect.objectContaining({ what: "departments", reason: "refused", code: "permission_error" }),
    ])
    const emma = await person("emma@northstar.example")
    expect((await store.knowledge.relations(null, emma)).map(({ kind, standing }) => [kind, standing]).sort()).toEqual([
      ["member-of", "reported"],
      ["related-to", "reported"],
      ["reports-to", "reported"],
    ])
  })

  it("syncs users without their e-mail when the webhook lacks user_basic, and still makes Emma the deal's owner", async () => {
    const { crm, deal } = northstar()
    crm.withhold("user_basic")
    const { ref } = await synced(crm)
    const { store } = await opened()
    expect((await store.deals.get(ref("deals", deal))).people).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "Emma Stone", role: "owner" })]),
    )
    expect(await store.people.personOf({ provider: "email", id: "emma@northstar.example" })).toBeFalsy()
  })

  it("gives a converted lead the deal the portal made from it", async () => {
    const { crm, acme } = northstar()
    const lead = crm.put("lead", { title: "Acme enquiry", stageId: "CONVERTED", companyId: acme })
    const deal = crm.put("deal", { title: "Acme enquiry", categoryId: 0, stageId: "NEW", leadId: lead })
    const { ref } = await synced(crm)
    expect(await rows("SELECT deal_id FROM leads WHERE external_id = ?", String(lead))).toEqual([
      { deal_id: Number(ref("deals", deal).slice("deal:".length)) },
    ])
  })

  it("makes Acme a customer of Northstar only once the owner maps its company type", async () => {
    const { crm } = northstar()
    await synced(crm)
    const setting = `crm.${PORTAL.provider}:${PORTAL.account}.company-types`
    expect((await b24(["work", "config", "set", setting, "CUSTOMER=customer-of"])).code).toBe(0)
    const before = await rows("SELECT count(*) AS n FROM links WHERE kind = 'customer-of'")
    await resync(crm)
    const { store, organization } = await opened()
    expect(before).toEqual([{ n: 0 }])
    expect(await store.knowledge.relations(null, await organization("Acme Ltd"))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "customer-of",
          to: await organization("Northstar Consulting"),
          standing: "reported",
        }),
      ]),
    )
  })
})
