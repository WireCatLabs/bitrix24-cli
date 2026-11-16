import { describe, expect, it } from "vitest"
import { fakePortal, ok, type PortalCall, type Reply } from "../testing/fake-portal.js"
import { b24, synced } from "../testing/harness.js"

const definitions = {
  "crm.company.field.list": ok({
    items: [
      { name: "title", title: "Title", type: "string", multiple: false, filterable: true },
      { name: "UF_CRM_1_SOURCE", title: "Lead source", type: "int", multiple: false, filterable: true },
      { name: "UF_CRM_2_ROOMS", title: "Rooms", type: "double", multiple: false, filterable: true },
      { name: "UF_CRM_3_NOTE", title: "Note", type: "string", multiple: false, filterable: false },
    ],
  }),
  "crm.company.userfield.list": ok([
    {
      FIELD_NAME: "UF_CRM_1_SOURCE",
      USER_TYPE_ID: "enumeration",
      MULTIPLE: "N",
      LIST: [
        { ID: "44", VALUE: "Website" },
        { ID: "45", VALUE: "Fair" },
      ],
    },
    { FIELD_NAME: "UF_CRM_2_ROOMS", USER_TYPE_ID: "double", MULTIPLE: "N" },
    { FIELD_NAME: "UF_CRM_3_NOTE", USER_TYPE_ID: "string", MULTIPLE: "N" },
  ]),
}

const row = { id: 7, title: "Kitchen", UF_CRM_1_SOURCE: 45, UF_CRM_2_ROOMS: 3, UF_CRM_3_NOTE: "" }

const portalWith = (more: Record<string, Reply> = {}) =>
  fakePortal({ ...definitions, "crm.company.list": ok({ items: [row] }), ...more })

const listCall = (portal: ReturnType<typeof portalWith>) =>
  portal.calls.find((call) => call.method.endsWith(".list") && !call.method.includes("field")) as PortalCall

describe("custom fields in a list query", () => {
  it("filters by a label or a code, a list field by its option's label, a number field as a number", async () => {
    const portal = portalWith()
    const ran = await b24(
      ["work", "organizations", "list", "lead_source:fair", "UF_CRM_2_ROOMS:3", "type:CUSTOMER", "--json"],
      {
        portal,
      },
    )
    expect(ran.code).toBe(0)
    expect(listCall(portal)).toMatchObject({ api: 3, method: "crm.company.list" })
    expect(listCall(portal).body.filter).toEqual([
      ["typeId", "=", "CUSTOMER"],
      ["UF_CRM_1_SOURCE", "=", 45],
      ["UF_CRM_2_ROOMS", "=", 3],
    ])
  })

  it("takes a label with an escaped space", async () => {
    const portal = portalWith()
    await b24(["work", "organizations", "list", "Lead\\ source:Website", "--json"], { portal })
    expect(listCall(portal).body.filter).toEqual([["UF_CRM_1_SOURCE", "=", 44]])
  })

  it("goes to REST 2 with the original UF names beside a free word", async () => {
    const portal = fakePortal({ ...definitions, "crm.item.list": ok({ items: [row] }) })
    const ran = await b24(["work", "organizations", "list", "kitchen", "lead_source:Website", "--json"], { portal })
    expect(ran.code).toBe(0)
    expect(listCall(portal)).toMatchObject({ api: 2, method: "crm.item.list" })
    expect(listCall(portal).body).toMatchObject({
      filter: { "%title": "kitchen", "=UF_CRM_1_SOURCE": 44 },
      useOriginalUfNames: "Y",
    })
  })

  it("refuses a field the portal cannot filter by, an unknown one, and an option the list does not have", async () => {
    const portal = portalWith()
    const note = await b24(["work", "organizations", "list", "note:x", "--json"], { portal })
    expect(note.code).toBe(2)
    expect(note.json().error).toMatchObject({ reason: "field.not-filterable", details: { field: "UF_CRM_3_NOTE" } })
    const unknown = await b24(["work", "organizations", "list", "sourc:x", "--json"], { portal })
    expect(unknown.json().error).toMatchObject({
      reason: "field.unknown",
      param: "--query",
      details: { candidates: [{ code: "UF_CRM_1_SOURCE", label: "Lead source" }] },
    })
    const option = await b24(["work", "organizations", "list", "lead_source:radio", "--json"], { portal })
    expect(option.json().error).toMatchObject({ reason: "field.unknown-option", param: "--query" })
    expect(portal.calls.map((call) => call.method)).not.toContain("crm.company.list")
  })

  it("reads the field definitions the last sync stored, and the portal's only before the first sync", async () => {
    const { portal } = await synced()
    const before = portal.calls.length
    expect((await b24(["work", "people", "list", "--json"], { portal })).code).toBe(0)
    expect(portal.calls.slice(before).map((call) => call.method)).toEqual(["crm.contact.list", "user.admin"])
  })

  it("reads the field definitions once, then the list, for a query of the list's own fields", async () => {
    const portal = portalWith()
    await b24(["work", "organizations", "list", "type:CUSTOMER", "--json"], { portal })
    expect(portal.calls.map((call) => call.method)).toEqual([
      "crm.company.field.list",
      "crm.company.userfield.list",
      "crm.company.list",
    ])
  })
})

describe("custom fields in --json", () => {
  it("gives only the codes named under provider_metadata", async () => {
    const portal = portalWith()
    const ran = await b24(["work", "organizations", "list", "--json=id,provider_metadata.UF_CRM_1_SOURCE"], { portal })
    expect(ran.code).toBe(0)
    const [item] = ran.json().items as Record<string, unknown>[]
    expect(item?.provider_metadata).toEqual({
      UF_CRM_1_SOURCE: { label: "Lead source", value: "Fair", option_id: "45" },
    })
  })

  it("selects every custom field for provider_metadata alone, leaving empty ones out", async () => {
    const portal = portalWith()
    const ran = await b24(["work", "organizations", "list", "--json=id,provider_metadata"], { portal })
    expect(listCall(portal).body.select).toEqual(
      expect.arrayContaining(["UF_CRM_1_SOURCE", "UF_CRM_2_ROOMS", "UF_CRM_3_NOTE"]),
    )
    expect((ran.json().items as { provider_metadata: Record<string, unknown> }[])[0]?.provider_metadata).toEqual({
      UF_CRM_1_SOURCE: { label: "Lead source", value: "Fair", option_id: "45" },
      UF_CRM_2_ROOMS: { label: "Rooms", value: 3 },
    })
  })

  it("refuses a code the portal does not list, before asking for the list", async () => {
    const portal = portalWith()
    const ran = await b24(["work", "organizations", "list", "--json=id,provider_metadata.UF_CRM_9_GONE"], { portal })
    expect(ran.code).toBe(2)
    expect(ran.json().error).toMatchObject({ reason: "field.unknown", param: "--json" })
    expect(portal.calls.map((call) => call.method)).not.toContain("crm.company.list")
  })
})
