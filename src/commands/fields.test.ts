import { describe, expect, it } from "vitest"
import { fakePortal, ok } from "../testing/fake-portal.js"
import { b24 } from "../testing/harness.js"

const portal = () =>
  fakePortal({
    "crm.contact.field.list": ok({
      items: [
        { name: "name", title: "First name", type: "string", multiple: false, filterable: true },
        { name: "UF_CRM_1_SOURCE", title: "Source", type: "int", multiple: false, filterable: true },
        { name: "UF_CRM_1_SOURCE_data", title: "Source", type: "object", multiple: false, filterable: false },
        { name: "UF_CRM_2_NOTE", title: "Note", type: "string", multiple: true, filterable: false },
      ],
    }),
    "crm.contact.userfield.list": ok(
      [
        {
          FIELD_NAME: "UF_CRM_1_SOURCE",
          USER_TYPE_ID: "enumeration",
          MULTIPLE: "N",
          LIST: [
            { ID: "44", SORT: "10", VALUE: "Website", DEF: "N", XML_ID: "W" },
            { ID: "45", SORT: "20", VALUE: "Fair", DEF: "N", XML_ID: "F" },
          ],
        },
        { FIELD_NAME: "UF_CRM_2_NOTE", USER_TYPE_ID: "string", MULTIPLE: "Y" },
      ],
      { total: 2 },
    ),
  })

describe("fields list", () => {
  it("lists the custom fields with their type, filterability and a list field's options", async () => {
    const fake = portal()
    const ran = await b24(["work", "fields", "list", "people", "--json"], { portal: fake })
    expect(ran.code).toBe(0)
    expect(ran.json().items).toEqual([
      {
        code: "UF_CRM_1_SOURCE",
        label: "Source",
        type: "enumeration",
        multiple: false,
        filterable: true,
        options: [
          { id: "44", label: "Website" },
          { id: "45", label: "Fair" },
        ],
      },
      { code: "UF_CRM_2_NOTE", label: "Note", type: "string", multiple: true, filterable: false },
    ])
    expect(fake.calls.map((call) => [call.api, call.method])).toEqual([
      [3, "crm.contact.field.list"],
      [2, "crm.contact.userfield.list"],
    ])
  })

  it("pages the list the portal gives whole", async () => {
    const first = await b24(["work", "fields", "list", "people", "--limit", "1", "--json"], { portal: portal() })
    expect((first.json().items as { code: string }[]).map((field) => field.code)).toEqual(["UF_CRM_1_SOURCE"])
    expect(first.json().page).toMatchObject({ has_more: true, limit: 1 })
    const second = await b24(["work", "fields", "list", "people", "--limit", "1", "--page", "2", "--json"], {
      portal: portal(),
    })
    expect((second.json().items as { code: string }[]).map((field) => field.code)).toEqual(["UF_CRM_2_NOTE"])
    expect(second.json().page).toMatchObject({ has_more: false })
    const all = await b24(["work", "fields", "list", "people", "--limit", "1", "--all", "--json"], { portal: portal() })
    expect(all.json().items).toHaveLength(2)
  })

  it("refuses a kind it has no fields for", async () => {
    const fake = portal()
    const ran = await b24(["work", "fields", "list", "products", "--json"], { portal: fake })
    expect(ran.code).toBe(2)
    expect(fake.calls).toHaveLength(0)
  })
})
