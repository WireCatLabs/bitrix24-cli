import { describe, expect, it } from "vitest"
import { fakePortal, ok } from "../testing/fake-portal.js"
import { b24, synced } from "../testing/harness.js"

const definitions = {
  "crm.company.field.list": ok({
    items: [
      { name: "UF_CRM_1_SOURCE", title: "Lead source", type: "int", multiple: false, filterable: true },
      { name: "UF_CRM_2_BUDGET", title: "Budget", type: "string", multiple: false, filterable: false },
      { name: "UF_CRM_3_TAG", title: "Tag", type: "string", multiple: false, filterable: false },
      { name: "UF_CRM_4_TAG", title: "Tag", type: "string", multiple: false, filterable: false },
    ],
  }),
  "crm.company.userfield.list": ok([
    {
      FIELD_NAME: "UF_CRM_1_SOURCE",
      USER_TYPE_ID: "enumeration",
      MULTIPLE: "N",
      LIST: [{ ID: "45", VALUE: "Fair" }],
    },
    { FIELD_NAME: "UF_CRM_2_BUDGET", USER_TYPE_ID: "money", MULTIPLE: "N" },
    { FIELD_NAME: "UF_CRM_3_TAG", USER_TYPE_ID: "string", MULTIPLE: "N" },
    { FIELD_NAME: "UF_CRM_4_TAG", USER_TYPE_ID: "string", MULTIPLE: "N" },
  ]),
}

const row = {
  id: 7,
  title: '=HYPERLINK("http://example.com")',
  phone: [
    { value: "+10000000001", valueTypeId: "WORK" },
    { value: "+10000000002", valueTypeId: "MOBILE" },
  ],
  UF_CRM_1_SOURCE: 45,
  UF_CRM_2_BUDGET: "1500.50|USD",
  UF_CRM_3_TAG: "vip, fair",
}

const portalWith = (rows = [row]) => fakePortal({ ...definitions, "crm.company.list": ok({ items: rows }) })

const records = (out: string) => out.replace(/\r\n?$/, "").split("\r\n")

describe("organizations list --format csv", () => {
  it("prints the table and nothing else: own fields, then every custom field by its label", async () => {
    const ran = await b24(["work", "organizations", "list", "--format", "csv"], { portal: portalWith() })
    expect(ran.code).toBe(0)
    expect(ran.err).toBe("")
    const [header, first] = records(ran.out)
    expect(header).toBe(
      "id,name,type_id,industry_id,revenue,currency,person_ids,phones,emails,assigned_to,created_at,updated_at,url," +
        "Lead source,Budget amount,Budget currency,Tag (UF_CRM_3_TAG),Tag (UF_CRM_4_TAG)",
    )
    expect(first).toBe(
      `7,"'=HYPERLINK(""http://example.com"")",,,,,,'+10000000001; +10000000002,,,,,,Fair,1500.50,USD,"vip, fair",`,
    )
  })

  it("takes its columns from --json=a,b", async () => {
    const portal = portalWith()
    const ran = await b24(
      ["work", "organizations", "list", "--format", "csv", "--json=id,provider_metadata.UF_CRM_1_SOURCE"],
      {
        portal,
      },
    )
    expect(ran.code).toBe(0)
    expect(records(ran.out)).toEqual(["id,Lead source", "7,Fair"])
  })

  it("says where the next page is on stderr only", async () => {
    const ran = await b24(["work", "organizations", "list", "--format", "csv", "--json=id", "--limit", "1"], {
      portal: portalWith([row, { ...row, id: 8 }]),
    })
    expect(records(ran.out)).toEqual(["id", "7"])
    expect(ran.err).toContain("--page 2")
  })

  it.each([["--jsonl"], ["--json"], ["--compact"]])("refuses %s beside it before asking the portal", async (flag) => {
    const portal = portalWith()
    const ran = await b24(["work", "organizations", "list", "--format", "csv", flag], { portal })
    expect(ran.code).toBe(2)
    expect(ran.json().error).toMatchObject({ reason: "output.conflict" })
    expect(portal.calls).toEqual([])
  })
})

describe("people list --format csv", () => {
  it("prints the contacts as a table", async () => {
    const portal = fakePortal({
      "crm.contact.field.list": ok({ items: [] }),
      "crm.contact.userfield.list": ok([]),
      "crm.contact.list": ok({ items: [{ id: 3, name: "Example", lastName: "Person", companyId: 9 }] }),
    })
    const ran = await b24(["work", "people", "list", "--format", "csv", "--json=id,name,organization_ids"], { portal })
    expect(ran.code).toBe(0)
    expect(records(ran.out)).toEqual(["id,name,organization_ids", "3,Example Person,9"])
  })
})

it.each(["deals", "leads"])("%s list --format csv prints the stored copies, offline too", async (noun) => {
  const { portal } = await synced()
  const ran = await b24(["work", "--offline", noun, "list", "--format", "csv", "--json=external_id"], { portal })
  expect(ran.code).toBe(0)
  expect(records(ran.out)[0]).toBe("external_id")
  expect(records(ran.out).length).toBeGreaterThan(1)
})
