import { memoryKeyring } from "@wirecat/cli-base"
import { describe, expect, it } from "vitest"
import { fakePortal, ok, type PortalCall } from "../testing/fake-portal.js"
import { b24 } from "../testing/harness.js"

const deal = (id: number, more: Record<string, unknown> = {}) => ({
  id,
  title: `Kitchen ${id}`,
  categoryId: 1,
  stageId: "C1:NEW",
  stageSemanticId: "P",
  opportunity: 15000,
  currencyId: "EUR",
  assignedById: 7,
  companyId: 0,
  contactsId: [3, 4],
  closeTime: "2026-12-01T00:00:00+03:00",
  createdTime: "2026-11-01T10:00:00+03:00",
  updatedTime: "2026-11-02T10:00:00+03:00",
  url: "https://example.bitrix24.test/crm/deal/details/1/",
  ...more,
})

const items = (rows: unknown[]) => ok({ items: rows })

const listed = (ran: Awaited<ReturnType<typeof b24>>) =>
  ran.json() as { items: Record<string, unknown>[]; page: Record<string, unknown> }

describe("deals", () => {
  it("list sends the query as REST 3.0 triples and answers neutral deals", async () => {
    const portal = fakePortal({ "crm.deal.list": items([deal(2), deal(1)]) })
    const ran = await b24(
      ["work", "deals", "list", "outcome:open", "pipeline_id:1", "amount>=10000", "--limit", "1", "--json"],
      { portal },
    )
    expect(ran.code).toBe(0)
    const call = portal.calls[0] as PortalCall
    expect(call.api).toBe(3)
    expect(call.body.filter).toEqual([
      ["stageSemanticId", "=", "P"],
      ["categoryId", "=", 1],
      ["opportunity", ">=", 10000],
    ])
    expect(call.body.pagination).toEqual({ limit: 2, offset: 0 })
    const answer = listed(ran)
    expect(answer.items).toEqual([
      {
        id: "2",
        title: "Kitchen 2",
        pipeline_id: "1",
        stage_id: "C1:NEW",
        outcome: "open",
        amount: 15000,
        currency: "EUR",
        assigned_to: "7",
        organization_id: null,
        person_ids: ["3", "4"],
        closes_on: "2026-12-01",
        created_at: "2026-11-01T07:00:00.000Z",
        updated_at: "2026-11-02T07:00:00.000Z",
        url: "https://example.bitrix24.test/crm/deal/details/1/",
      },
    ])
    expect(answer.page).toMatchObject({ has_more: true, limit: 1 })
  })

  it("list sends a free word to REST 2's substring match, which REST 3.0 does not have", async () => {
    const portal = fakePortal({ "crm.item.list": ok({ items: [deal(5)] }) })
    const ran = await b24(["work", "deals", "list", "kitchen", 'stage_id:"C1:WON"', "--json"], { portal })
    expect(ran.code).toBe(0)
    const call = portal.calls[0] as PortalCall
    expect(call).toMatchObject({ api: 2, method: "crm.item.list" })
    expect(call.body).toMatchObject({
      entityTypeId: 2,
      filter: { "%title": "kitchen", "=stageId": "C1:WON" },
      start: 0,
    })
  })

  it("list --all walks every page", async () => {
    const pages = [Array.from({ length: 1000 }, (_, i) => deal(2000 - i)), [deal(1)]]
    const portal = fakePortal({ "crm.deal.list": () => items(pages.shift() ?? []) })
    const ran = await b24(["work", "deals", "list", "--all", "--json"], { portal })
    expect(listed(ran).items).toHaveLength(1001)
    expect(portal.calls.map((call) => call.body.pagination)).toEqual([
      { limit: 1000, offset: 0 },
      { limit: 1000, offset: 1000 },
    ])
  })

  it("list reads a time window in UTC", async () => {
    const portal = fakePortal({ "crm.deal.list": items([]) })
    await b24(["work", "deals", "list", "updated_at:[2026-11-01T00:00:00Z TO 2026-11-02T00:00:00Z]", "--json"], {
      portal,
    })
    const filter = portal.calls[0]?.body.filter as unknown[][]
    expect(filter.map((one) => one.slice(0, 2))).toEqual([
      ["updatedTime", ">="],
      ["updatedTime", "<="],
    ])
  })

  it("list refuses a field the portal cannot filter, and a bad id", async () => {
    expect((await b24(["work", "deals", "list", "closes_on:2026-12-01"])).code).toBe(2)
    expect((await b24(["work", "deals", "list", "assigned_to:abc"])).code).toBe(2)
  })

  it("show reads one deal with the portal's custom fields under provider_metadata", async () => {
    const portal = fakePortal({
      "crm.deal.get": ok({ item: deal(42) }),
      "crm.item.get": ok({ item: { id: 42, UF_CRM_1_SIZE: "large", UF_CRM_1_SIZE_data: {}, title: "x" } }),
    })
    const ran = await b24(["work", "deals", "show", "42", "--json"], { portal })
    expect(ran.json().item).toMatchObject({ id: "42", provider_metadata: { UF_CRM_1_SIZE: "large" } })
    expect(portal.calls[1]?.body).toEqual({ entityTypeId: 2, id: 42, useOriginalUfNames: "Y" })
  })

  it("show finds a deal by its exact title, and refuses two with candidates", async () => {
    const one = fakePortal({
      "crm.item.list": ok({ items: [deal(1, { title: "Kitchen" }), deal(2, { title: "Kitchen sink" })] }),
      "crm.deal.get": ok({ item: deal(1, { title: "Kitchen" }) }),
      "crm.item.get": ok({ item: {} }),
    })
    expect((await b24(["work", "deals", "show", "kitchen", "--json"], { portal: one })).json().item).toMatchObject({
      id: "1",
    })
    const two = fakePortal({
      "crm.item.list": ok({ items: [deal(1, { title: "Kitchen" }), deal(2, { title: "kitchen" })] }),
    })
    const ran = await b24(["work", "deals", "show", "Kitchen", "--json"], { portal: two })
    expect(ran.code).toBe(2)
    expect(ran.json().error).toMatchObject({ reason: "deal.ambiguous" })
    const none = fakePortal({ "crm.item.list": ok({ items: [] }) })
    expect((await b24(["work", "deals", "show", "Nothing"], { portal: none })).code).toBe(6)
  })

  it("show answers not_found for a deal the portal does not have", async () => {
    const portal = fakePortal({
      "crm.deal.get": {
        status: 400,
        body: { error: { code: "BITRIX_REST_V3_EXCEPTION_ENTITYNOTFOUNDEXCEPTION", message: "x" } },
      },
    })
    expect((await b24(["work", "deals", "show", "9"], { portal })).code).toBe(6)
    expect((await b24(["work", "deals", "show", "9"], { portal: fakePortal({ "crm.deal.get": ok({}) }) })).code).toBe(6)
  })

  it("refuses --offline and a profile with no sign-in", async () => {
    expect((await b24(["work", "deals", "list", "--offline"])).code).toBe(5)
    expect((await b24(["work", "deals", "list"], { keyring: memoryKeyring() })).code).toBe(4)
  })
})

describe("leads, people and organizations", () => {
  it("leads list maps a lead with its phones and the person's name", async () => {
    const portal = fakePortal({
      "crm.lead.list": items([
        {
          id: 3,
          title: "Website form",
          name: "Ivan",
          lastName: "Petrov",
          companyTitle: "Acme",
          stageId: "NEW",
          stageSemanticId: "S",
          phone: [{ id: 1, valueTypeId: "WORK", value: "+10000000000" }],
          email: [],
          createdTime: "2026-11-01T10:00:00Z",
        },
      ]),
    })
    const ran = await b24(["work", "leads", "list", "outcome:won", "--json"], { portal })
    expect(listed(ran).items[0]).toMatchObject({
      name: "Ivan Petrov",
      organization_name: "Acme",
      outcome: "won",
      phones: [{ type: "work", value: "+10000000000" }],
      emails: [],
    })
    expect(portal.calls[0]?.body.filter).toEqual([["stageSemanticId", "=", "S"]])
  })

  it("people list matches a word against the first or last name", async () => {
    const portal = fakePortal({
      "crm.item.list": ok({ items: [{ id: 4, name: "Anna", lastName: "Ivanova", companiesId: [9] }] }),
    })
    const ran = await b24(["work", "people", "list", "name:ivan*", "--json"], { portal })
    expect(listed(ran).items[0]).toMatchObject({ name: "Anna Ivanova", organization_ids: ["9"] })
    expect(portal.calls[0]?.body).toMatchObject({
      entityTypeId: 3,
      filter: { "0": { logic: "OR", "%name": "ivan", "%lastName": "ivan" } },
    })
  })

  it("people show and organizations show read REST 3.0", async () => {
    const portal = fakePortal({
      "crm.contact.get": ok({ item: { id: 4, name: "Anna", companyId: 9 } }),
      "crm.company.get": ok({ item: { id: 9, title: "Acme", revenue: "1000.5", contactsId: [4] } }),
      "crm.item.get": ok({ item: {} }),
    })
    expect((await b24(["work", "people", "show", "4", "--json"], { portal })).json().item).toMatchObject({
      organization_ids: ["9"],
    })
    expect((await b24(["work", "organizations", "show", "9", "--json"], { portal })).json().item).toMatchObject({
      name: "Acme",
      revenue: 1000.5,
      person_ids: ["4"],
    })
    const listedOrganizations = await b24(["work", "organizations", "list", "type_id:CUSTOMER", "--json"], {
      portal: fakePortal({ "crm.company.list": items([]) }),
    })
    expect(listedOrganizations.code).toBe(0)
  })
})

describe("pipelines and stages", () => {
  const categories = ok({
    categories: [
      { id: 0, name: "General", sort: 100, isDefault: "Y" },
      { id: 1, name: "Wholesale", sort: 200, isDefault: "N" },
    ],
  })
  const statuses = [
    { ENTITY_ID: "STATUS", STATUS_ID: "NEW", NAME: "New", SORT: 10, EXTRA: { SEMANTICS: "", COLOR: "#aaa" } },
    { ENTITY_ID: "STATUS", STATUS_ID: "CONVERTED", NAME: "Good lead", SORT: 20, SEMANTICS: "S" },
    { ENTITY_ID: "DEAL_STAGE_1", STATUS_ID: "C1:LOSE", NAME: "Lost", SORT: 30, SEMANTICS: "F" },
    { ENTITY_ID: "SOURCE", STATUS_ID: "WEB", NAME: "Website" },
  ]

  it("pipelines list and show by name", async () => {
    const portal = fakePortal({ "crm.category.list": () => categories })
    expect(listed(await b24(["work", "pipelines", "list", "--json"], { portal })).items).toEqual([
      { id: "0", name: "General", is_default: true, sort: 100 },
      { id: "1", name: "Wholesale", is_default: false, sort: 200 },
    ])
    expect((await b24(["work", "pipelines", "show", "wholesale", "--json"], { portal })).json().item).toMatchObject({
      id: "1",
    })
    expect((await b24(["work", "pipelines", "show", "Retail"], { portal })).code).toBe(6)
  })

  it("stages list takes the outcome from the stage's semantics", async () => {
    const portal = fakePortal({ "crm.status.list": () => ok(statuses) })
    const all = listed(await b24(["work", "stages", "list", "--json"], { portal })).items
    expect(all.map(({ id, entity, pipeline_id, outcome }) => [id, entity, pipeline_id, outcome])).toEqual([
      ["NEW", "leads", null, "open"],
      ["CONVERTED", "leads", null, "won"],
      ["C1:LOSE", "deals", "1", "lost"],
    ])
    await b24(["work", "stages", "list", "entity:leads", "--json"], { portal })
    await b24(["work", "stages", "list", "pipeline_id:1", "--json"], { portal })
    const deals = listed(await b24(["work", "stages", "list", "entity:deals", "--json"], { portal })).items
    expect(deals).toHaveLength(1)
    expect(portal.calls.slice(1, 3).map((call) => call.body.filter)).toEqual([
      { ENTITY_ID: "STATUS" },
      { ENTITY_ID: "DEAL_STAGE_1" },
    ])
    expect((await b24(["work", "stages", "show", "C1:LOSE", "--json"], { portal })).json().item).toMatchObject({
      outcome: "lost",
    })
    expect((await b24(["work", "stages", "show", "Nowhere"], { portal })).code).toBe(6)
  })
})

describe("products and users", () => {
  it("products list and show", async () => {
    const product = { ID: "11", NAME: "Chair", PRICE: "99.90", CURRENCY_ID: "EUR", ACTIVE: "Y", SECTION_ID: "2" }
    const portal = fakePortal({ "crm.product.list": ok([product], { total: 1 }), "crm.product.get": ok(product) })
    const ran = await b24(["work", "products", "list", "chair", "active:true", "--json"], { portal })
    expect(listed(ran).items).toEqual([
      { id: "11", name: "Chair", price: 99.9, currency: "EUR", active: true, section_id: "2" },
    ])
    expect(portal.calls[0]?.body.filter).toEqual({ "%NAME": "chair", "=ACTIVE": "Y" })
    expect((await b24(["work", "products", "show", "11", "--json"], { portal })).json().item).toMatchObject({
      id: "11",
    })
  })

  it("users list and show", async () => {
    const user = {
      ID: "7",
      NAME: "Anna",
      LAST_NAME: "Admin",
      EMAIL: "a@example.test",
      ACTIVE: true,
      UF_DEPARTMENT: [1],
    }
    const portal = fakePortal({
      "user.get": (call) => ok((call.body.FILTER as { ID?: number }).ID === 8 ? [] : [user]),
    })
    const ran = await b24(["work", "users", "list", "active:true", "--json"], { portal })
    expect(listed(ran).items[0]).toEqual({
      id: "7",
      name: "Anna Admin",
      email: "a@example.test",
      position: null,
      active: true,
      department_ids: ["1"],
    })
    expect(portal.calls[0]?.body.FILTER).toEqual({ ACTIVE: true })
    expect((await b24(["work", "users", "show", "7", "--json"], { portal })).json().item).toMatchObject({ id: "7" })
    expect((await b24(["work", "users", "show", "8"], { portal })).code).toBe(6)
  })
})

describe("every list pages the same way", () => {
  const portal = () =>
    fakePortal({
      "crm.deal.list": items([]),
      "crm.lead.list": items([]),
      "crm.contact.list": items([]),
      "crm.company.list": items([]),
      "crm.category.list": ok({ categories: [] }),
      "crm.status.list": ok([]),
      "crm.product.list": ok([]),
      "user.get": ok([]),
    })

  for (const noun of ["deals", "leads", "people", "organizations", "pipelines", "stages", "products", "users"])
    it(`${noun} list takes --limit, --page and --all`, async () => {
      const at = portal()
      for (const flags of [["--limit", "5", "--page", "2", "--json"], ["--all", "--json"], ["--compact"]])
        expect((await b24(["work", noun, "list", ...flags], { portal: at })).code).toBe(0)
    })

  it("a later page starts past the earlier ones", async () => {
    const at = portal()
    await b24(["work", "deals", "list", "--limit", "5", "--page", "3", "--json"], { portal: at })
    expect(at.calls[0]?.body.pagination).toEqual({ limit: 6, offset: 10 })
  })

  it("leads show reads one lead", async () => {
    const at = fakePortal({ "crm.lead.get": ok({ item: { id: 3, title: "Form" } }), "crm.item.get": ok({ item: {} }) })
    expect((await b24(["work", "leads", "show", "3", "--json"], { portal: at })).json().item).toMatchObject({ id: "3" })
  })
})
