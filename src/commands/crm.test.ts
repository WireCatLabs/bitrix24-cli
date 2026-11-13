import { memoryKeyring } from "@wirecat/cli-base"
import { describe, expect, it } from "vitest"
import { FAKE_SECRET, fakePortal, ok, type PortalCall, type Reply } from "../testing/fake-portal.js"
import { b24 } from "../testing/harness.js"

const company = (id: number, more: Record<string, unknown> = {}) => ({
  id,
  title: `Example ${id}`,
  typeId: "CUSTOMER",
  industryId: "IT",
  revenue: 15000,
  currencyId: "EUR",
  assignedById: 7,
  contactsId: [3, 4],
  createdTime: "2026-11-01T10:00:00+03:00",
  updatedTime: "2026-11-02T10:00:00+03:00",
  url: "https://example.bitrix24.test/crm/company/details/1/",
  ...more,
})

const items = (rows: unknown[]) => ok({ items: rows })

const listed = (ran: Awaited<ReturnType<typeof b24>>) =>
  ran.json() as { items: Record<string, unknown>[]; page: Record<string, unknown> }

describe("organizations: the list and show every portal noun shares", () => {
  it("list sends the query as REST 3.0 triples and answers neutral organizations", async () => {
    const portal = fakePortal({ "crm.company.list": items([company(2), company(1)]) })
    const ran = await b24(
      ["work", "organizations", "list", "type_id:CUSTOMER", "assigned_to:7", "--limit", "1", "--json"],
      { portal },
    )
    expect(ran.code).toBe(0)
    const call = portal.calls[0] as PortalCall
    expect(call.api).toBe(3)
    expect(call.body.filter).toEqual([
      ["typeId", "=", "CUSTOMER"],
      ["assignedById", "=", 7],
    ])
    expect(call.body.pagination).toEqual({ limit: 2, offset: 0 })
    const answer = listed(ran)
    expect(answer.items).toEqual([
      {
        id: "2",
        name: "Example 2",
        type_id: "CUSTOMER",
        industry_id: "IT",
        revenue: 15000,
        currency: "EUR",
        person_ids: ["3", "4"],
        assigned_to: "7",
        created_at: "2026-11-01T07:00:00.000Z",
        updated_at: "2026-11-02T07:00:00.000Z",
        url: "https://example.bitrix24.test/crm/company/details/1/",
      },
    ])
    expect(answer.page).toMatchObject({ has_more: true, limit: 1 })
  })

  it("list sends a free word to REST 2's substring match, which REST 3.0 does not have", async () => {
    const portal = fakePortal({ "crm.item.list": ok({ items: [company(5)] }) })
    const ran = await b24(["work", "organizations", "list", "kitchen", "type_id:PARTNER", "--json"], { portal })
    expect(ran.code).toBe(0)
    const call = portal.calls[0] as PortalCall
    expect(call).toMatchObject({ api: 2, method: "crm.item.list" })
    expect(call.body).toMatchObject({
      entityTypeId: 4,
      filter: { "%title": "kitchen", "=typeId": "PARTNER" },
      start: 0,
    })
  })

  it("list --all walks every page", async () => {
    const pages = [Array.from({ length: 1000 }, (_, i) => company(2000 - i)), [company(1)]]
    const portal = fakePortal({ "crm.company.list": () => items(pages.shift() ?? []) })
    const ran = await b24(["work", "organizations", "list", "--all", "--json"], { portal })
    expect(listed(ran).items).toHaveLength(1001)
    expect(portal.calls.map((call) => call.body.pagination)).toEqual([
      { limit: 1000, offset: 0 },
      { limit: 1000, offset: 1000 },
    ])
  })

  it("list reads a time window in UTC", async () => {
    const portal = fakePortal({ "crm.company.list": items([]) })
    await b24(
      ["work", "organizations", "list", "updated_at:[2026-11-01T00:00:00Z TO 2026-11-02T00:00:00Z]", "--json"],
      {
        portal,
      },
    )
    const filter = portal.calls[0]?.body.filter as unknown[][]
    expect(filter.map((one) => one.slice(0, 2))).toEqual([
      ["updatedTime", ">="],
      ["updatedTime", "<="],
    ])
  })

  it("list runs in its own recorded run, with the portal request in it", async () => {
    const portal = fakePortal({ "crm.company.list": items([company(1)]) })
    const ran = await b24(["work", "organizations", "list", "--json", "--record"], { portal })
    const runId = (ran.json().meta as { run_id: string }).run_id
    expect(runId).toMatch(/-organizations-list-/)
    const shown = await b24(["runs", "show", runId, "--json"])
    expect(shown.code).toBe(0)
    expect(shown.out).toContain("crm.company.list")
  })

  it("list refuses a field the portal cannot filter, and a bad id", async () => {
    expect((await b24(["work", "organizations", "list", "revenue:5"])).code).toBe(2)
    expect((await b24(["work", "organizations", "list", "assigned_to:abc"])).code).toBe(2)
  })

  const userFields = ok(
    [
      { FIELD_NAME: "UF_CRM_1_SIZE", USER_TYPE_ID: "string", MULTIPLE: "N" },
      {
        FIELD_NAME: "UF_CRM_6_KIND",
        USER_TYPE_ID: "enumeration",
        MULTIPLE: "N",
        LIST: [
          { ID: "44", SORT: "10", VALUE: "Retail", DEF: "N", XML_ID: "R" },
          { ID: "45", SORT: "20", VALUE: "Wholesale", DEF: "N", XML_ID: "W" },
        ],
      },
      {
        FIELD_NAME: "UF_CRM_7_TAGS",
        USER_TYPE_ID: "enumeration",
        MULTIPLE: "Y",
        LIST: [
          { ID: "50", SORT: "10", VALUE: "Hot", DEF: "N", XML_ID: "H" },
          { ID: "51", SORT: "20", VALUE: "Repeat", DEF: "N", XML_ID: "P" },
        ],
      },
    ],
    { total: 3 },
  )

  const withCustomFields = (labels: Reply, more: Record<string, unknown> = {}) =>
    fakePortal({
      "crm.company.get": ok({ item: company(42) }),
      "crm.item.get": ok({
        item: {
          id: 42,
          UF_CRM_1_SIZE: "large",
          UF_CRM_1_SIZE_data: {},
          UF_CRM_2_PAID: false,
          UF_CRM_3_NOTE: null,
          UF_CRM_4_CODE: "",
          UF_CRM_5_TAGS: [],
          title: "x",
          ...more,
        },
      }),
      "crm.company.field.list": labels,
      "crm.company.userfield.list": userFields,
    })

  it("show reads one company with the portal's custom fields and their labels under provider_metadata", async () => {
    const portal = withCustomFields(
      items([
        { name: "title", title: "Name" },
        { name: "UF_CRM_1_SIZE", title: "Size" },
        { name: "UF_CRM_1_SIZE_data", title: "Size" },
        { name: "UF_CRM_2_PAID", title: "Paid" },
      ]),
    )
    const ran = await b24(["work", "organizations", "show", "42", "--json"], { portal })
    expect((ran.json().item as Record<string, unknown>).provider_metadata).toEqual({
      UF_CRM_1_SIZE: { label: "Size", value: "large" },
      UF_CRM_2_PAID: { label: "Paid", value: false },
    })
    expect(portal.calls[1]?.body).toEqual({ entityTypeId: 4, id: 42, useOriginalUfNames: "Y" })
    expect(portal.calls[2]).toMatchObject({
      api: 3,
      method: "crm.company.field.list",
      body: { select: ["name", "title", "type", "multiple", "filterable"] },
    })
    expect(portal.calls[3]).toMatchObject({ api: 2, method: "crm.company.userfield.list" })
    expect(portal.calls).toHaveLength(4)
  })

  it("show gives a list field's value by its option's label and keeps the option id", async () => {
    const portal = withCustomFields(
      items([
        { name: "UF_CRM_6_KIND", title: "Kind", type: "int" },
        { name: "UF_CRM_7_TAGS", title: "Tags", type: "int", multiple: true },
      ]),
      { UF_CRM_6_KIND: 45, UF_CRM_7_TAGS: [50, 99] },
    )
    const ran = await b24(["work", "organizations", "show", "42", "--json"], { portal })
    const metadata = (ran.json().item as { provider_metadata: Record<string, unknown> }).provider_metadata
    expect(metadata.UF_CRM_6_KIND).toEqual({ label: "Kind", value: "Wholesale", option_id: "45" })
    expect(metadata.UF_CRM_7_TAGS).toEqual({ label: "Tags", value: ["Hot", "99"], option_id: ["50", "99"] })
  })

  it("show gives a custom field the portal has no label for a null label", async () => {
    const portal = withCustomFields(items([{ name: "UF_CRM_1_SIZE", title: "Size" }]))
    const ran = await b24(["work", "organizations", "show", "42", "--json"], { portal })
    expect((ran.json().item as Record<string, unknown>).provider_metadata).toEqual({
      UF_CRM_1_SIZE: { label: "Size", value: "large" },
      UF_CRM_2_PAID: { label: null, value: false },
    })
  })

  it("show still answers, with null labels, when the portal refuses the labels", async () => {
    const portal = withCustomFields({
      status: 403,
      body: { error: { code: "BITRIX_REST_V3_EXCEPTION_ACCESSDENIEDEXCEPTION", message: "Access denied" } },
    })
    const ran = await b24(["work", "organizations", "show", "42", "--json"], { portal })
    expect(ran.code).toBe(0)
    expect((ran.json().item as Record<string, unknown>).provider_metadata).toEqual({
      UF_CRM_1_SIZE: { label: null, value: "large" },
      UF_CRM_2_PAID: { label: null, value: false },
    })
    expect(ran.err).toBe("")
    expect(ran.out + ran.err).not.toContain(FAKE_SECRET)
  })

  it("show fails when the labels fail for any reason but a refusal", async () => {
    const portal = withCustomFields({ status: 500, body: { error: "INTERNAL_SERVER_ERROR" } })
    const ran = await b24(["work", "organizations", "show", "42", "--json"], { portal })
    expect(ran.code).not.toBe(0)
  })

  it("show asks for labels only when a custom field holds a value, and list never does", async () => {
    const portal = fakePortal({
      "crm.company.get": ok({ item: company(42) }),
      "crm.item.get": ok({ item: { UF_CRM_3_NOTE: null } }),
      "crm.company.list": items([company(1)]),
    })
    await b24(["work", "organizations", "show", "42", "--json"], { portal })
    await b24(["work", "organizations", "list", "--json"], { portal })
    expect(portal.calls.map((call) => call.method)).toEqual(["crm.company.get", "crm.item.get", "crm.company.list"])
  })

  it("show finds a company by its exact title, and refuses two with candidates", async () => {
    const one = fakePortal({
      "crm.item.list": ok({ items: [company(1, { title: "Kitchen" }), company(2, { title: "Kitchen sink" })] }),
      "crm.company.get": ok({ item: company(1, { title: "Kitchen" }) }),
      "crm.item.get": ok({ item: {} }),
    })
    expect(
      (await b24(["work", "organizations", "show", "kitchen", "--json"], { portal: one })).json().item,
    ).toMatchObject({
      id: "1",
    })
    const two = fakePortal({
      "crm.item.list": ok({ items: [company(1, { title: "Kitchen" }), company(2, { title: "kitchen" })] }),
    })
    const ran = await b24(["work", "organizations", "show", "Kitchen", "--json"], { portal: two })
    expect(ran.code).toBe(2)
    expect(ran.json().error).toMatchObject({ reason: "organization.ambiguous" })
    const none = fakePortal({ "crm.item.list": ok({ items: [] }) })
    expect((await b24(["work", "organizations", "show", "Nothing"], { portal: none })).code).toBe(6)
  })

  it("show answers not_found for a company the portal does not have", async () => {
    const portal = fakePortal({
      "crm.company.get": {
        status: 400,
        body: { error: { code: "BITRIX_REST_V3_EXCEPTION_ENTITYNOTFOUNDEXCEPTION", message: "x" } },
      },
    })
    expect((await b24(["work", "organizations", "show", "9"], { portal })).code).toBe(6)
    expect(
      (await b24(["work", "organizations", "show", "9"], { portal: fakePortal({ "crm.company.get": ok({}) }) })).code,
    ).toBe(6)
  })

  it("refuses --offline and a profile this computer has never seen", async () => {
    expect((await b24(["work", "organizations", "list", "--offline"])).code).toBe(5)
    expect((await b24(["work", "organizations", "list"], { keyring: memoryKeyring() })).code).toBe(6)
  })
})

describe("people and organizations", () => {
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
      "crm.contact.list": items([]),
      "crm.company.list": items([]),
      "crm.product.list": ok([]),
      "user.get": ok([]),
    })

  for (const noun of ["people", "organizations", "products", "users"])
    it(`${noun} list takes --limit, --page and --all`, async () => {
      const at = portal()
      for (const flags of [["--limit", "5", "--page", "2", "--json"], ["--all", "--json"], ["--compact"]])
        expect((await b24(["work", noun, "list", ...flags], { portal: at })).code).toBe(0)
    })

  it("a later page starts past the earlier ones", async () => {
    const at = portal()
    await b24(["work", "organizations", "list", "--limit", "5", "--page", "3", "--json"], { portal: at })
    expect(at.calls[0]?.body.pagination).toEqual({ limit: 6, offset: 10 })
  })

  it("people show leaves out provider_metadata when every custom field is empty", async () => {
    const at = fakePortal({
      "crm.contact.get": ok({ item: { id: 3, name: "Example" } }),
      "crm.item.get": ok({ item: { UF_CRM_1745512486047: null, UF_CRM_1745512486048: [] } }),
    })
    expect((await b24(["work", "people", "show", "3", "--json"], { portal: at })).json().item).not.toHaveProperty(
      "provider_metadata",
    )
  })
})
