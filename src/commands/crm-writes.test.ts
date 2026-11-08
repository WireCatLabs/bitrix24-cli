import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { fakePortal, ok, type PortalCall } from "../testing/fake-portal.js"
import { b24 } from "../testing/harness.js"

/** Runs `body` with the profile's permissions saved in the config file, as the owner sets them. */
const withPermissions = async (permissions: Record<string, string>, body: () => Promise<void>) => {
  const dir = process.env.B24_CONFIG_DIR ?? ""
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "config.json"), JSON.stringify({ profiles: { work: { permissions } } }))
  try {
    await body()
  } finally {
    rmSync(join(dir, "config.json"))
  }
}

const added = () =>
  fakePortal({
    "crm.contact.add": ok({ id: 78 }),
    "crm.lead.add": ok({ id: 79 }),
    "crm.company.add": ok({ id: 80 }),
  })

describe("create", () => {
  it("creates a company on REST 3.0 with the operation id as its Idempotency-Key", async () => {
    const portal = added()
    const ran = await b24(
      ["work", "organizations", "create", "--name", "WireCat test org", "--body", '{"revenue":15000}', "--json"],
      { portal },
    )
    expect(ran.code).toBe(0)
    const item = ran.json().item as Record<string, unknown>
    expect(item).toEqual({ operation_id: expect.any(String), id: "80", created: true })
    const call = portal.calls[0] as PortalCall
    expect(call).toMatchObject({ api: 3, method: "crm.company.add" })
    expect(call.body).toEqual({ fields: { revenue: 15000, title: "WireCat test org" } })
    expect(call.headers["Idempotency-Key"]).toBe(item.operation_id)
  })

  it("refuses a create without its name, a bad --body and --operation-id, before the portal", async () => {
    const portal = added()
    expect((await b24(["work", "people", "create"], { portal })).code).toBe(2)
    expect((await b24(["work", "organizations", "create", "--name", "x", "--body", "{"], { portal })).code).toBe(2)
    expect((await b24(["work", "organizations", "create", "--name", "x", "--body", "[1]"], { portal })).code).toBe(2)
    expect(
      (await b24(["work", "organizations", "create", "--name", "x", "--operation-id", "op-7"], { portal })).code,
    ).toBe(2)
    expect(portal.calls).toHaveLength(0)
  })

  it("denies assigning a record to another employee until the owner allows it", async () => {
    const portal = added()
    const other = ["work", "organizations", "create", "--name", "x", "--body", '{"assignedById":9}']
    const refused = await b24([...other, "--json"], { portal })
    expect(refused.code).toBe(5)
    expect(portal.calls).toHaveLength(0)
    await withPermissions({ "crm.assign-others": "allow" }, async () => {
      expect((await b24(other, { portal })).code).toBe(0)
    })
    expect(
      (await b24(["work", "organizations", "create", "--name", "x", "--body", '{"assignedById":7}'], { portal })).code,
    ).toBe(0)
  })

  it("refuses under B24_READ_ONLY and under a denied key, and sends nothing", async () => {
    const portal = added()
    const create = ["work", "organizations", "create", "--name", "x"]
    expect((await b24(create, { portal, env: { B24_READ_ONLY: "1" } })).code).toBe(5)
    await withPermissions({ "organizations.create": "deny" }, async () => {
      expect((await b24(create, { portal })).code).toBe(5)
    })
    expect(portal.calls).toHaveLength(0)
  })

  it("--dry-run previews and calls nothing", async () => {
    const portal = added()
    const ran = await b24(["work", "organizations", "create", "--name", "x", "--dry-run", "--json"], { portal })
    expect(ran.code).toBe(0)
    expect(ran.json().item).toMatchObject({ preview: true })
    expect(portal.calls).toHaveLength(0)
  })

  it("a create that gets no answer is sent once, is outcome_unknown, and says to look before writing again", async () => {
    const portal = fakePortal({ "crm.company.add": new TypeError("socket hang up") })
    const ran = await b24(["work", "organizations", "create", "--name", "x", "--json"], { portal })
    expect(ran.code).toBe(14)
    const error = ran.json().error as Record<string, unknown>
    expect(String(error.message)).toContain("check the portal before you write it again")
    expect(String(error.message)).not.toContain("--operation-id")
    expect(portal.calls).toHaveLength(1)
  })

  it("an add answered without an id is invalid_response", async () => {
    const portal = fakePortal({ "crm.company.add": ok({}) })
    expect((await b24(["work", "organizations", "create", "--name", "x"], { portal })).code).toBe(13)
  })
})

describe("update", () => {
  it("update sends only the named fields", async () => {
    const portal = fakePortal({ "crm.company.update": ok({ result: true }) })
    const ran = await b24(["work", "organizations", "update", "42", "--name", "New", "--json"], { portal })
    expect(ran.json().item).toEqual({ operation_id: expect.any(String), id: "42", updated: ["title"] })
    expect(portal.calls[0]?.body).toEqual({ id: 42, fields: { title: "New" } })
    expect((await b24(["work", "organizations", "update", "42"], { portal })).code).toBe(2)
    expect((await b24(["work", "organizations", "update", "abc", "--name", "x"], { portal })).code).toBe(2)
    expect(
      (
        await b24(["work", "people", "update", "4", "--last-name", "Ivanova"], {
          portal: fakePortal({ "crm.contact.update": ok({ result: true }) }),
        })
      ).code,
    ).toBe(0)
    expect(
      (
        await b24(["work", "organizations", "update", "9", "--name", "Acme"], {
          portal: fakePortal({ "crm.company.update": ok({ result: true }) }),
        })
      ).code,
    ).toBe(0)
  })
})

/** One type's custom fields, as `field.list` and `userfield.list` give them. */
const customFields = (type: string) => ({
  [`crm.${type}.field.list`]: ok({
    items: [
      { name: "title", title: "Title", type: "string", multiple: false, filterable: true },
      { name: "UF_CRM_1_SOURCE", title: "Source", type: "int", multiple: false, filterable: true },
      { name: "UF_CRM_2_TAGS", title: "Tags", type: "int", multiple: true, filterable: true },
      { name: "UF_CRM_3_NOTE", title: "Note", type: "string", multiple: false, filterable: false },
      { name: "UF_CRM_4_NOTE", title: "note", type: "string", multiple: false, filterable: false },
      { name: "UF_CRM_5_LEAD_SOURCE", title: "Lead source", type: "string", multiple: false, filterable: false },
      { name: "UF_CRM_6_CITY", title: "Город", type: "int", multiple: false, filterable: true },
    ],
  }),
  [`crm.${type}.userfield.list`]: ok([
    {
      FIELD_NAME: "UF_CRM_1_SOURCE",
      USER_TYPE_ID: "enumeration",
      MULTIPLE: "N",
      LIST: [
        { ID: "44", VALUE: "Website" },
        { ID: "45", VALUE: "Fair" },
      ],
    },
    {
      FIELD_NAME: "UF_CRM_6_CITY",
      USER_TYPE_ID: "enumeration",
      MULTIPLE: "N",
      LIST: [
        { ID: "60", VALUE: "Орёл" },
        { ID: "61", VALUE: "Йошкар-Ола" },
      ],
    },
    {
      FIELD_NAME: "UF_CRM_2_TAGS",
      USER_TYPE_ID: "enumeration",
      MULTIPLE: "Y",
      LIST: [
        { ID: "50", VALUE: "Hot" },
        { ID: "51", VALUE: "Repeat" },
      ],
    },
  ]),
})

describe("--field", () => {
  const portal = () => fakePortal({ ...customFields("company"), "crm.company.update": ok({ result: true }) })
  const update = (fake: ReturnType<typeof portal>, ...pairs: string[]) =>
    b24(["work", "organizations", "update", "42", ...pairs.flatMap((one) => ["--field", one]), "--json"], {
      portal: fake,
    })

  it("names a custom field by label or code, a list option by label or id, a multiple field by repeating", async () => {
    const fake = portal()
    const ran = await update(fake, "source=website", "UF_CRM_2_TAGS=Hot", "Tags=51", "lead_source=Ads")
    expect(ran.code).toBe(0)
    expect(fake.calls.map((call) => call.method)).toEqual([
      "crm.company.field.list",
      "crm.company.userfield.list",
      "crm.company.update",
    ])
    expect(fake.calls[2]?.body).toEqual({
      id: 42,
      fields: { UF_CRM_1_SOURCE: 44, UF_CRM_2_TAGS: [50, 51], UF_CRM_5_LEAD_SOURCE: "Ads" },
    })
    expect(fake.calls[2]?.headers["Idempotency-Key"]).toBe((ran.json().item as Record<string, unknown>).operation_id)
  })

  it("takes е for ё and a decomposed й for a composed one, in a label and in an option", async () => {
    const fake = portal()
    expect((await update(fake, "ГОРОД=Орел")).code).toBe(0)
    expect((await update(fake, "город=Йошкар-Ола".normalize("NFD"))).code).toBe(0)
    const sent = fake.calls.filter((call) => call.method === "crm.company.update").map((call) => call.body)
    expect(sent).toEqual([
      { id: 42, fields: { UF_CRM_6_CITY: 60 } },
      { id: 42, fields: { UF_CRM_6_CITY: 61 } },
    ])
  })

  it("wins over --body for the same field, and named options win over both", async () => {
    const fake = portal()
    await b24(
      [
        "work",
        "organizations",
        "update",
        "42",
        "--body",
        '{"UF_CRM_1_SOURCE":"45","title":"body","revenue":1}',
        "--field",
        "Source=Website",
        "--name",
        "named",
      ],
      { portal: fake },
    )
    expect(fake.calls[2]?.body).toEqual({
      id: 42,
      fields: { UF_CRM_1_SOURCE: 44, title: "named", revenue: 1 },
    })
  })

  it("refuses an ambiguous label with the codes, an unknown name with close ones, and sends nothing", async () => {
    const fake = portal()
    const ambiguous = await update(fake, "Note=x")
    expect(ambiguous.code).toBe(2)
    expect(ambiguous.json().error).toMatchObject({
      code: "validation_error",
      reason: "field.ambiguous",
      details: {
        candidates: [
          { code: "UF_CRM_3_NOTE", label: "Note" },
          { code: "UF_CRM_4_NOTE", label: "note" },
        ],
      },
    })
    const unknown = await update(fake, "Sourc=x")
    expect(unknown.json().error).toMatchObject({
      reason: "field.unknown",
      details: {
        candidates: [
          { code: "UF_CRM_1_SOURCE", label: "Source" },
          { code: "UF_CRM_5_LEAD_SOURCE", label: "Lead source" },
        ],
      },
    })
    expect(fake.calls.map((call) => call.method)).not.toContain("crm.company.update")
  })

  it("refuses a standard field, an option the list does not have, and two values for a single field", async () => {
    const fake = portal()
    expect((await update(fake, "Title=x")).json().error).toMatchObject({ reason: "field.unknown" })
    expect((await update(fake, "Source=Radio")).json().error).toMatchObject({
      reason: "field.unknown-option",
      details: { field: "UF_CRM_1_SOURCE" },
    })
    expect((await update(fake, "Source=Fair", "Source=Website")).code).toBe(2)
    expect((await update(fake, "no-equals-sign")).code).toBe(2)
    expect(fake.calls.map((call) => call.method)).not.toContain("crm.company.update")
  })

  it("--dry-run looks nothing up", async () => {
    const fake = portal()
    const ran = await b24(
      ["work", "organizations", "update", "42", "--field", "Source=Website", "--dry-run", "--json"],
      {
        portal: fake,
      },
    )
    expect(ran.code).toBe(0)
    expect(fake.calls).toHaveLength(0)
  })
})

describe("every write takes its options", () => {
  const TYPES: Record<string, string> = { people: "contact", organizations: "company" }
  const NAMES: Record<string, string[]> = {
    people: ["--first-name", "WireCat", "--last-name", "test"],
    organizations: ["--name", "WireCat test"],
  }
  for (const [noun, type] of Object.entries(TYPES))
    it(`${noun} create and update take their names and --body, each with its own operation id`, async () => {
      const portal = fakePortal({
        ...customFields(type),
        [`crm.${type}.add`]: ok({ id: 1 }),
        [`crm.${type}.update`]: ok({ result: true }),
      })
      const options = [...(NAMES[noun] ?? []), "--body", '{"comments":"x"}', "--field", "Source=Fair"]
      expect((await b24(["work", noun, "create", ...options], { portal })).code).toBe(0)
      expect((await b24(["work", noun, "update", "1", ...options], { portal })).code).toBe(0)
      const writes = portal.calls.filter((call) => !call.method.includes("field"))
      const keys = writes.map((call) => call.headers["Idempotency-Key"])
      expect(keys).toHaveLength(2)
      expect(keys[0]).not.toBe(keys[1])
      expect(writes[1]?.body).toMatchObject({ id: 1, fields: { comments: "x", UF_CRM_1_SOURCE: 45 } })
    })
})
