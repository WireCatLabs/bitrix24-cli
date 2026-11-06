import { describe, expect, it } from "vitest"
import { fakePortal, ok, type PortalCall, type Reply } from "../testing/fake-portal.js"
import { b24 } from "../testing/harness.js"

const definitions = {
  "crm.deal.field.list": ok({
    items: [
      { name: "title", title: "Title", type: "string", multiple: false, filterable: true },
      { name: "UF_CRM_1_SOURCE", title: "Lead source", type: "int", multiple: false, filterable: true },
      { name: "UF_CRM_2_ROOMS", title: "Rooms", type: "double", multiple: false, filterable: true },
      { name: "UF_CRM_3_NOTE", title: "Note", type: "string", multiple: false, filterable: false },
    ],
  }),
  "crm.deal.userfield.list": ok([
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
  fakePortal({ ...definitions, "crm.deal.list": ok({ items: [row] }), ...more })

const listCall = (portal: ReturnType<typeof portalWith>) =>
  portal.calls.find((call) => call.method.endsWith(".list") && !call.method.includes("field")) as PortalCall

describe("custom fields in a list query", () => {
  it("filters by a label or a code, a list field by its option's label, a number field as a number", async () => {
    const portal = portalWith()
    const ran = await b24(["work", "deals", "list", "lead_source:fair", "UF_CRM_2_ROOMS:3", "outcome:open", "--json"], {
      portal,
    })
    expect(ran.code).toBe(0)
    expect(listCall(portal)).toMatchObject({ api: 3, method: "crm.deal.list" })
    expect(listCall(portal).body.filter).toEqual([
      ["stageSemanticId", "=", "P"],
      ["UF_CRM_1_SOURCE", "=", 45],
      ["UF_CRM_2_ROOMS", "=", 3],
    ])
  })

  it("takes a label with an escaped space", async () => {
    const portal = portalWith()
    await b24(["work", "deals", "list", "Lead\\ source:Website", "--json"], { portal })
    expect(listCall(portal).body.filter).toEqual([["UF_CRM_1_SOURCE", "=", 44]])
  })

  it("goes to REST 2 with the original UF names beside a free word", async () => {
    const portal = fakePortal({ ...definitions, "crm.item.list": ok({ items: [row] }) })
    const ran = await b24(["work", "deals", "list", "kitchen", "lead_source:Website", "--json"], { portal })
    expect(ran.code).toBe(0)
    expect(listCall(portal)).toMatchObject({ api: 2, method: "crm.item.list" })
    expect(listCall(portal).body).toMatchObject({
      filter: { "%title": "kitchen", "=UF_CRM_1_SOURCE": 44 },
      useOriginalUfNames: "Y",
    })
  })

  it("refuses a field the portal cannot filter by, an unknown one, and an option the list does not have", async () => {
    const portal = portalWith()
    const note = await b24(["work", "deals", "list", "note:x", "--json"], { portal })
    expect(note.code).toBe(2)
    expect(note.json().error).toMatchObject({ reason: "field.not-filterable", details: { field: "UF_CRM_3_NOTE" } })
    const unknown = await b24(["work", "deals", "list", "sourc:x", "--json"], { portal })
    expect(unknown.json().error).toMatchObject({
      reason: "field.unknown",
      details: { candidates: [{ code: "UF_CRM_1_SOURCE", label: "Lead source" }] },
    })
    const option = await b24(["work", "deals", "list", "lead_source:radio", "--json"], { portal })
    expect(option.json().error).toMatchObject({ reason: "field.unknown-option" })
    expect(portal.calls.map((call) => call.method)).not.toContain("crm.deal.list")
  })

  it("reads no field definitions for a query of the list's own fields", async () => {
    const portal = portalWith()
    await b24(["work", "deals", "list", "outcome:open", "--json"], { portal })
    expect(portal.calls.map((call) => call.method)).toEqual(["crm.deal.list"])
  })
})

describe("custom fields in --json", () => {
  it("selects only the codes named, and gives them under provider_metadata", async () => {
    const portal = portalWith()
    const ran = await b24(["work", "deals", "list", "--json=id,provider_metadata.UF_CRM_1_SOURCE"], { portal })
    expect(ran.code).toBe(0)
    expect(listCall(portal).body.select).toEqual(expect.arrayContaining(["id", "title", "UF_CRM_1_SOURCE"]))
    expect(listCall(portal).body.select).not.toContain("UF_CRM_2_ROOMS")
    expect(ran.json().items).toEqual([
      { id: "7", provider_metadata: { UF_CRM_1_SOURCE: { label: "Lead source", value: "Fair", option_id: "45" } } },
    ])
  })

  it("selects every custom field for provider_metadata alone, leaving empty ones out", async () => {
    const portal = portalWith()
    const ran = await b24(["work", "deals", "list", "--json=id,provider_metadata"], { portal })
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
    const ran = await b24(["work", "deals", "list", "--json=id,provider_metadata.UF_CRM_9_GONE"], { portal })
    expect(ran.code).toBe(2)
    expect(ran.json().error).toMatchObject({ reason: "field.unknown" })
    expect(portal.calls.map((call) => call.method)).not.toContain("crm.deal.list")
  })

  it("leaves the list's select alone without a custom field", async () => {
    const portal = portalWith()
    await b24(["work", "deals", "list", "--json=id,title"], { portal })
    expect(portal.calls.map((call) => call.method)).toEqual(["crm.deal.list"])
  })
})
