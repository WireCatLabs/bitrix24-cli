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
    "crm.deal.add": ok({ id: 77 }),
    "crm.contact.add": ok({ id: 78 }),
    "crm.lead.add": ok({ id: 79 }),
    "crm.company.add": ok({ id: 80 }),
  })

describe("create", () => {
  it("creates a deal on REST 3.0 with the operation id as its Idempotency-Key", async () => {
    const portal = added()
    const ran = await b24(
      [
        "work",
        "deals",
        "create",
        "--title",
        "WireCat test deal",
        "--body",
        '{"opportunity":15000,"currencyId":"EUR"}',
        "--json",
      ],
      { portal },
    )
    expect(ran.code).toBe(0)
    const item = ran.json().item as Record<string, unknown>
    expect(item).toMatchObject({ id: "77", created: true })
    const call = portal.calls[0] as PortalCall
    expect(call).toMatchObject({ api: 3, method: "crm.deal.add" })
    expect(call.body).toEqual({ fields: { opportunity: 15000, currencyId: "EUR", title: "WireCat test deal" } })
    expect(call.headers["Idempotency-Key"]).toBe(item.operation_id)
  })

  it("repeats with the --operation-id it is given", async () => {
    const portal = added()
    await b24(
      ["work", "people", "create", "--first-name", "WireCat", "--last-name", "test", "--operation-id", "op-7"],
      { portal },
    )
    expect(portal.calls[0]?.headers["Idempotency-Key"]).toBe("op-7")
    expect(portal.calls[0]?.body).toEqual({ fields: { name: "WireCat", lastName: "test" } })
  })

  it("leads and organizations take their own name options", async () => {
    const portal = added()
    expect((await b24(["work", "leads", "create", "--title", "WireCat test lead"], { portal })).code).toBe(0)
    expect((await b24(["work", "organizations", "create", "--name", "WireCat test org"], { portal })).code).toBe(0)
    expect(portal.calls.map((call) => call.body)).toEqual([
      { fields: { title: "WireCat test lead" } },
      { fields: { title: "WireCat test org" } },
    ])
  })

  it("refuses a create without its name, a bad --body and a bad --operation-id, before the portal", async () => {
    const portal = added()
    expect((await b24(["work", "people", "create"], { portal })).code).toBe(2)
    expect((await b24(["work", "deals", "create", "--title", "x", "--body", "{"], { portal })).code).toBe(2)
    expect((await b24(["work", "deals", "create", "--title", "x", "--body", "[1]"], { portal })).code).toBe(2)
    expect(
      (await b24(["work", "deals", "create", "--title", "x", "--operation-id", "two words"], { portal })).code,
    ).toBe(2)
    expect(portal.calls).toHaveLength(0)
  })

  it("denies assigning a record to another employee until the owner allows it", async () => {
    const portal = added()
    const other = ["work", "deals", "create", "--title", "x", "--body", '{"assignedById":9}']
    const refused = await b24([...other, "--json"], { portal })
    expect(refused.code).toBe(5)
    expect(portal.calls).toHaveLength(0)
    await withPermissions({ "crm.assign-others": "allow" }, async () => {
      expect((await b24(other, { portal })).code).toBe(0)
    })
    expect(
      (await b24(["work", "deals", "create", "--title", "x", "--body", '{"assignedById":7}'], { portal })).code,
    ).toBe(0)
  })

  it("refuses under B24_READ_ONLY and under a denied key, and sends nothing", async () => {
    const portal = added()
    expect((await b24(["work", "deals", "create", "--title", "x"], { portal, env: { B24_READ_ONLY: "1" } })).code).toBe(
      5,
    )
    await withPermissions({ "deals.create": "deny" }, async () => {
      expect((await b24(["work", "deals", "create", "--title", "x"], { portal })).code).toBe(5)
    })
    expect(portal.calls).toHaveLength(0)
  })

  it("--dry-run previews and calls nothing", async () => {
    const portal = added()
    const ran = await b24(["work", "deals", "create", "--title", "x", "--dry-run", "--json"], { portal })
    expect(ran.code).toBe(0)
    expect(ran.json().item).toMatchObject({ preview: true })
    expect(portal.calls).toHaveLength(0)
  })

  it("a create that gets no answer is sent once, is outcome_unknown, and names the retry once", async () => {
    const portal = fakePortal({ "crm.deal.add": new TypeError("socket hang up") })
    const ran = await b24(["work", "deals", "create", "--title", "x", "--json"], { portal })
    expect(ran.code).toBe(14)
    const error = ran.json().error as Record<string, unknown>
    expect(String(error.message).split("--operation-id")).toHaveLength(2)
    expect(String(error.message)).not.toContain("check before repeating")
    expect(portal.calls).toHaveLength(1)
  })

  it("an add answered without an id is invalid_response", async () => {
    const portal = fakePortal({ "crm.deal.add": ok({}) })
    expect((await b24(["work", "deals", "create", "--title", "x"], { portal })).code).toBe(13)
  })
})

describe("update and move", () => {
  it("update sends only the named fields", async () => {
    const portal = fakePortal({ "crm.deal.update": ok({ result: true }) })
    const ran = await b24(["work", "deals", "update", "42", "--title", "New", "--json"], { portal })
    expect(ran.json().item).toMatchObject({ id: "42", updated: ["title"] })
    expect(portal.calls[0]?.body).toEqual({ id: 42, fields: { title: "New" } })
    expect((await b24(["work", "deals", "update", "42"], { portal })).code).toBe(2)
    expect((await b24(["work", "deals", "update", "abc", "--title", "x"], { portal })).code).toBe(2)
    expect(
      (
        await b24(["work", "people", "update", "4", "--last-name", "Ivanova"], {
          portal: fakePortal({ "crm.contact.update": ok({ result: true }) }),
        })
      ).code,
    ).toBe(0)
    expect(
      (
        await b24(["work", "leads", "update", "4", "--first-name", "Ivan"], {
          portal: fakePortal({ "crm.lead.update": ok({ result: true }) }),
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

  it("deals move reads the stage in the deal's own pipeline and answers its outcome", async () => {
    const portal = fakePortal({
      "crm.deal.get": ok({ item: { id: 42, categoryId: 1 } }),
      "crm.status.list": ok([{ ENTITY_ID: "DEAL_STAGE_1", STATUS_ID: "C1:WON", NAME: "Won", SEMANTICS: "S" }]),
      "crm.deal.update": ok({ result: true }),
    })
    const ran = await b24(["work", "deals", "move", "42", "--stage", "won", "--json"], { portal })
    expect(ran.json().item).toMatchObject({ id: "42", stage_id: "C1:WON", outcome: "won" })
    expect(portal.calls[1]?.body.filter).toEqual({ ENTITY_ID: "DEAL_STAGE_1" })
    expect(portal.calls[2]?.body).toEqual({ id: 42, fields: { stageId: "C1:WON" } })
    expect((await b24(["work", "deals", "move", "x", "--stage", "won"], { portal })).code).toBe(2)
  })

  it("leads move reads the lead stages", async () => {
    const portal = fakePortal({
      "crm.status.list": ok([{ ENTITY_ID: "STATUS", STATUS_ID: "IN_PROCESS", NAME: "In progress" }]),
      "crm.lead.update": ok({ result: true }),
    })
    const ran = await b24(["work", "leads", "move", "7", "--stage", "IN_PROCESS", "--operation-id", "op-3", "--json"], {
      portal,
    })
    expect(ran.json().item).toMatchObject({ operation_id: "op-3", outcome: "open" })
    expect(portal.calls[0]?.body.filter).toEqual({ ENTITY_ID: "STATUS" })
  })

  it("deals move of a deal the portal does not have is not_found", async () => {
    const portal = fakePortal({ "crm.deal.get": ok({}) })
    expect((await b24(["work", "deals", "move", "9", "--stage", "won"], { portal })).code).toBe(6)
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
  const portal = () => fakePortal({ ...customFields("deal"), "crm.deal.update": ok({ result: true }) })
  const update = (fake: ReturnType<typeof portal>, ...pairs: string[]) =>
    b24(["work", "deals", "update", "42", ...pairs.flatMap((one) => ["--field", one]), "--json"], { portal: fake })

  it("names a custom field by label or code, a list option by label or id, a multiple field by repeating", async () => {
    const fake = portal()
    const ran = await update(fake, "source=website", "UF_CRM_2_TAGS=Hot", "Tags=51", "lead_source=Ads")
    expect(ran.code).toBe(0)
    expect(fake.calls.map((call) => call.method)).toEqual([
      "crm.deal.field.list",
      "crm.deal.userfield.list",
      "crm.deal.update",
    ])
    expect(fake.calls[2]?.body).toEqual({
      id: 42,
      fields: { UF_CRM_1_SOURCE: 44, UF_CRM_2_TAGS: [50, 51], UF_CRM_5_LEAD_SOURCE: "Ads" },
    })
    expect(fake.calls[2]?.headers["Idempotency-Key"]).toBe((ran.json().item as Record<string, unknown>).operation_id)
  })

  it("wins over --body for the same field, and named options win over both", async () => {
    const fake = portal()
    await b24(
      [
        "work",
        "deals",
        "update",
        "42",
        "--body",
        '{"UF_CRM_1_SOURCE":"45","title":"body","opportunity":1}',
        "--field",
        "Source=Website",
        "--title",
        "named",
      ],
      { portal: fake },
    )
    expect(fake.calls[2]?.body).toEqual({
      id: 42,
      fields: { UF_CRM_1_SOURCE: 44, title: "named", opportunity: 1 },
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
    expect(fake.calls.map((call) => call.method)).not.toContain("crm.deal.update")
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
    expect(fake.calls.map((call) => call.method)).not.toContain("crm.deal.update")
  })

  it("--dry-run looks nothing up", async () => {
    const fake = portal()
    const ran = await b24(["work", "deals", "update", "42", "--field", "Source=Website", "--dry-run", "--json"], {
      portal: fake,
    })
    expect(ran.code).toBe(0)
    expect(fake.calls).toHaveLength(0)
  })
})

describe("every write takes its options", () => {
  const TYPES: Record<string, string> = { deals: "deal", leads: "lead", people: "contact", organizations: "company" }
  const NAMES: Record<string, string[]> = {
    deals: ["--title", "WireCat test"],
    leads: ["--title", "WireCat test", "--first-name", "WireCat", "--last-name", "test"],
    people: ["--first-name", "WireCat", "--last-name", "test"],
    organizations: ["--name", "WireCat test"],
  }
  for (const [noun, type] of Object.entries(TYPES))
    it(`${noun} create and update take their names, --body and --operation-id`, async () => {
      const portal = fakePortal({
        ...customFields(type),
        [`crm.${type}.add`]: ok({ id: 1 }),
        [`crm.${type}.update`]: ok({ result: true }),
      })
      const options = [
        ...(NAMES[noun] ?? []),
        "--body",
        '{"comments":"x"}',
        "--field",
        "Source=Fair",
        "--operation-id",
        `op-${noun}`,
      ]
      expect((await b24(["work", noun, "create", ...options], { portal })).code).toBe(0)
      expect((await b24(["work", noun, "update", "1", ...options], { portal })).code).toBe(0)
      const writes = portal.calls.filter((call) => !call.method.includes("field"))
      expect(writes.map((call) => call.headers["Idempotency-Key"])).toEqual([`op-${noun}`, `op-${noun}`])
      expect(writes[1]?.body).toMatchObject({ id: 1, fields: { comments: "x", UF_CRM_1_SOURCE: 45 } })
    })

  it("deals move takes --operation-id", async () => {
    const portal = fakePortal({
      "crm.deal.get": ok({ item: { id: 1, categoryId: 0 } }),
      "crm.status.list": ok([{ ENTITY_ID: "DEAL_STAGE", STATUS_ID: "WON", NAME: "Won", SEMANTICS: "S" }]),
      "crm.deal.update": ok({ result: true }),
    })
    expect(
      (await b24(["work", "deals", "move", "1", "--stage", "WON", "--operation-id", "op-m"], { portal })).code,
    ).toBe(0)
    expect(portal.calls[1]?.body.filter).toEqual({ ENTITY_ID: "DEAL_STAGE" })
  })
})
