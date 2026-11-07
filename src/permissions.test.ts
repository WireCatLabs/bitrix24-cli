import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { mcpOverStdio } from "@wirecat/cli-core/testing"
import { describe, expect, it } from "vitest"
import { run } from "./program.js"
import { seededCrm } from "./testing/fake-crm.js"
import { fakePortal, ok } from "./testing/fake-portal.js"
import { b24, signedIn, synced } from "./testing/harness.js"

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

describe("a denied command key", () => {
  it("stops a read before any request", async () => {
    const portal = seededCrm()
    await withPermissions({ "deals.list": "deny", "people.list": "deny", sync: "deny" }, async () => {
      for (const argv of [["deals", "list"], ["people", "list"], ["sync"]]) {
        const ran = await b24(["work", ...argv, "--json"], { portal })
        expect(ran.code).toBe(5)
        expect(ran.json().error).toMatchObject({ code: "permission_error" })
      }
    })
    expect(portal.calls).toHaveLength(0)
  })

  it("api.crm.deal.update: deny stops deals update, move and close before any request", async () => {
    const { ref, calls } = await synced()
    const before = calls()
    await withPermissions({ "api.crm.deal.update": "deny" }, async () => {
      for (const argv of [
        ["update", ref("deals", 102), "--title", "x"],
        ["move", ref("deals", 102), "New"],
        ["close", ref("deals", 102), "won"],
      ])
        expect((await b24(["work", "deals", ...argv, "--json"])).code).toBe(5)
    })
    expect(calls()).toBe(before)
  })

  it("api.crm.deal.update: ask makes deals update ask, and --yes answers it", async () => {
    const { portal, ref, calls } = await synced()
    const before = calls()
    await withPermissions({ "api.crm.deal.update": "ask" }, async () => {
      expect(
        (await b24(["work", "deals", "update", ref("deals", 102), "--title", "x", "--json"], { portal })).code,
      ).toBe(7)
      expect(calls()).toBe(before)
      expect(
        (await b24(["work", "deals", "update", ref("deals", 102), "--title", "x", "--yes", "--json"], { portal })).code,
      ).toBe(0)
    })
  })
})

describe("--dry-run", () => {
  it("deals update names its key, the keys its options imply and the api key its request checks", async () => {
    const portal = fakePortal()
    const ran = await b24(["work", "deals", "update", "deal:1", "--title", "x", "--dry-run", "--json"], { portal })
    expect(ran.code).toBe(0)
    expect(ran.json().item).toMatchObject({
      permission: {
        key: "deals.update",
        level: "allow",
        also: [
          { key: "deals.move", level: "allow", when: "--stage" },
          { key: "deals.close", level: "allow", when: "a won or lost stage" },
          { key: "crm.assign-others", level: "deny", when: "--owner other than the sign-in's user" },
          { key: "api.crm.deal.update", level: "allow" },
        ],
      },
    })
    expect(portal.calls).toHaveLength(0)
  })

  it("api call crm.deal.delete names api.crm.deal.delete and deals.delete beside it, both at ask", async () => {
    const portal = fakePortal()
    const ran = await b24(["work", "api", "call", "crm.deal.delete", "--body", '{"id":5}', "--dry-run", "--json"], {
      portal,
    })
    expect(ran.code).toBe(0)
    expect(ran.json().item).toMatchObject({
      preview: true,
      permission: { key: "api.crm.deal.delete", level: "ask" },
      permissions: [
        { key: "api.crm.deal.delete", level: "ask" },
        { key: "deals.delete", level: "ask" },
      ],
    })
    expect(portal.calls).toHaveLength(0)
  })

  it("api call refuses a preview the profile denies", async () => {
    await withPermissions({ "api.crm.deal.delete": "deny" }, async () => {
      const ran = await b24(["work", "api", "call", "crm.deal.delete", "--body", '{"id":5}', "--dry-run", "--json"])
      expect(ran.code).toBe(5)
    })
  })

  it("still works with one of b24's own keys in the config", async () => {
    await withPermissions({ "deals.list": "deny", "api.crm.deal.update": "ask" }, async () => {
      const ran = await b24(["work", "deals", "update", "deal:1", "--title", "x", "--dry-run", "--json"])
      expect(ran.code).toBe(0)
      expect(ran.json().item).toMatchObject({
        permission: {
          key: "deals.update",
          level: "allow",
          also: [
            { key: "deals.move", level: "allow", when: "--stage" },
            { key: "deals.close", level: "allow", when: "a won or lost stage" },
            { key: "crm.assign-others", level: "deny", when: "--owner other than the sign-in's user" },
            { key: "api.crm.deal.update", level: "ask" },
          ],
        },
      })
    })
  })
})

const overMcp = (portal: ReturnType<typeof fakePortal>, flags: string[] = []) =>
  mcpOverStdio((streams) =>
    run(["work", "mcp", "serve", ...flags], {
      tty: false,
      streams: { data: () => {}, diagnostic: () => {} },
      keyring: signedIn(),
      fetch: portal.fetch,
      sleep: async () => {},
      ...streams,
    } as Parameters<typeof run>[1]),
  )

it("an MCP read of a denied command is listed as unavailable and refused", async () => {
  const portal = seededCrm()
  await withPermissions({ "people.list": "deny" }, async () => {
    const mcp = await overMcp(portal)
    try {
      const found = await mcp.call("b24_tools_search", { query: "people list" })
      expect((found.body as { items: unknown[] }).items).toContainEqual(
        expect.objectContaining({
          command: "people list",
          availability: expect.objectContaining({ available: false }),
        }),
      )
      const answer = await mcp.call("b24_read", { command: "people list" })
      expect(JSON.stringify(answer)).toContain("permission_error")
    } finally {
      await mcp.close()
    }
  })
  expect(portal.calls).toHaveLength(0)
})

it("an MCP update to another stage checks deals.move, and a stage set as a custom field is refused", async () => {
  const { portal, ref, calls } = await synced()
  const before = calls()
  await withPermissions({ "deals.move": "deny" }, async () => {
    const mcp = await overMcp(portal)
    try {
      const moved = await mcp.call("b24_write", {
        command: "deals update",
        arguments: { ref: ref("deals", 102), stage: "New" },
      })
      expect(JSON.stringify(moved)).toContain("permission_error")
      const aliased = await mcp.call("b24_write", {
        command: "deals update",
        arguments: { ref: ref("deals", 102), field: ["stageId=NEW"] },
      })
      expect(JSON.stringify(aliased)).toContain("validation_error")
    } finally {
      await mcp.close()
    }
  })
  expect(calls()).toBe(before)
})

it.each([
  ["deals.move=deny", { stage: "New" }],
  ["deals.close=deny", { stage: "Won" }],
  ["api.crm.deal.update=deny", { title: "Example renamed" }],
  ["crm.assign-others=deny", { owner: "9" }],
])("mcp serve --permission %s holds on the keys a deal write checks inside itself", async (level, typed) => {
  const { portal, ref, calls } = await synced()
  const before = calls()
  await withPermissions({ "crm.assign-others": "allow" }, async () => {
    const mcp = await overMcp(portal, ["--permission", level])
    try {
      const answer = await mcp.call("b24_write", {
        command: "deals update",
        arguments: { ref: ref("deals", 102), ...typed },
      })
      expect(JSON.stringify(answer)).toContain("permission_error")
    } finally {
      await mcp.close()
    }
  })
  expect(calls()).toBe(before)
})

it("api call is not offered over MCP", async () => {
  const portal = fakePortal({ "crm.deal.delete": ok(true) })
  const mcp = await overMcp(portal)
  try {
    const answer = await mcp.call("b24_write", {
      command: "api call",
      arguments: { method: "crm.deal.delete", body: '{"id":5}' },
    })
    expect(answer.isError).toBe(true)
  } finally {
    await mcp.close()
  }
  expect(portal.calls).toHaveLength(0)
})

const call = (method: string, body: unknown, ...rest: string[]) => [
  "work",
  "api",
  "call",
  method,
  "--body",
  JSON.stringify(body),
  ...rest,
]

describe("api call maps crm.item to the command keys", () => {
  const portal = () =>
    fakePortal({ "crm.item.add": ok({ item: { id: 1 } }), "crm.item.update": ok({ item: { id: 1 } }) })

  it.each([
    ["crm.item.add", 2, "deals.create"],
    ["crm.item.update", 2, "deals.update"],
    ["crm.item.update", 1, "leads.update"],
    ["crm.item.update", 3, "people.update"],
    ["crm.item.update", 4, "organizations.update"],
  ])("%s with entityTypeId %i checks %s", async (method, entityTypeId, key) => {
    const fake = portal()
    await withPermissions({ [key]: "deny" }, async () => {
      const ran = await b24(call(method, { entityTypeId, id: 1, fields: { title: "x" } }, "--yes"), { portal: fake })
      expect(ran.code).toBe(5)
    })
    expect(fake.calls).toHaveLength(0)
  })

  it("crm.item.delete asks, and deals.delete: deny refuses it even with --yes", async () => {
    const fake = fakePortal({ "crm.item.delete": ok(true) })
    expect((await b24(call("crm.item.delete", { entityTypeId: 2, id: 5 }), { portal: fake })).code).toBe(7)
    await withPermissions({ "deals.delete": "deny" }, async () => {
      expect((await b24(call("crm.item.delete", { entityTypeId: 2, id: 5 }, "--yes"), { portal: fake })).code).toBe(5)
    })
    expect(fake.calls).toHaveLength(0)
  })

  it("any method ending in delete asks", async () => {
    const fake = fakePortal({ "crm.quote.delete": ok(true) })
    expect((await b24(call("crm.quote.delete", { id: 5 }), { portal: fake })).code).toBe(7)
    expect(fake.calls).toHaveLength(0)
  })

  it("a .json suffix or capitals do not get round the keys, and the request goes by the plain name", async () => {
    const fake = fakePortal({ "crm.deal.delete": ok(true) })
    await withPermissions({ "deals.delete": "deny" }, async () => {
      expect((await b24(call("CRM.Deal.Delete.json", { id: 5 }, "--yes"), { portal: fake })).code).toBe(5)
    })
    expect(fake.calls).toHaveLength(0)
    expect((await b24(call("crm.deal.delete.json", { id: 5 }, "--yes"), { portal: fake })).code).toBe(0)
    expect(fake.calls.map((one) => one.method)).toEqual(["crm.deal.delete"])
  })
})

describe("a write that sets a stage checks the move key, and a won or lost one the close key", () => {
  it.each([
    ["deals.move", ["update", 102, "--stage", "New"]],
    ["deals.move", ["create", "--title", "x", "--pipeline", "Example sales", "--stage", "Quote sent"]],
    ["deals.close", ["update", 102, "--stage", "Won"]],
    ["deals.close", ["move", 102, "Lost"]],
  ] as const)("%s: deny refuses deals %j", async (key, argv) => {
    const { ref, calls } = await synced()
    const before = calls()
    await withPermissions({ [key]: "deny" }, async () => {
      const typed = argv.map((one) => (typeof one === "number" ? ref("deals", one) : one))
      expect((await b24(["work", "deals", ...typed])).code).toBe(5)
    })
    expect(calls()).toBe(before)
  })

  it.each(["stageId=NEW", "STAGE_ID=NEW", "categoryId=1", "ASSIGNED_BY_ID=9"])(
    "--field %s is refused as a standard field before any request",
    async (field) => {
      const { ref, calls } = await synced()
      const before = calls()
      expect((await b24(["work", "deals", "update", ref("deals", 102), "--field", field])).code).toBe(2)
      expect(calls()).toBe(before)
    },
  )

  it("a lead's STATUS_ID is refused on the command and checks leads.move through api call", async () => {
    const { ref, calls } = await synced()
    const before = calls()
    expect((await b24(["work", "leads", "update", ref("leads", 104), "--field", "STATUS_ID=JUNK"])).code).toBe(2)
    await withPermissions({ "leads.move": "deny" }, async () => {
      const item = call("crm.item.update", { entityTypeId: 1, id: 5, fields: { STAGE_ID: "WON" } })
      expect((await b24(item)).code).toBe(5)
    })
    expect(calls()).toBe(before)
  })

  it("api call crm.deal.update with a stage checks deals.close", async () => {
    const fake = fakePortal({ "crm.deal.update": ok(true) })
    await withPermissions({ "deals.close": "deny" }, async () => {
      expect((await b24(call("crm.deal.update", { id: 5, fields: { stageId: "WON" } }), { portal: fake })).code).toBe(5)
    })
    expect(fake.calls).toHaveLength(0)
  })

  it("another employee as owner checks crm.assign-others, on the command and through api call", async () => {
    const { ref, calls } = await synced()
    const before = calls()
    expect((await b24(["work", "deals", "update", ref("deals", 102), "--owner", "9"])).code).toBe(5)
    expect((await b24(call("crm.deal.update", { id: 5, fields: { ASSIGNED_BY_ID: 9 } }))).code).toBe(5)
    expect(calls()).toBe(before)
  })
})

describe("api call works from an allow list", () => {
  it.each([
    "imconnector.send.messages",
    "log.blogpost.add",
    "disk.file.getexternallink",
    "disk.folder.getexternallink",
    "event.bind",
  ])("%s is denied, --yes or not", async (method) => {
    const fake = fakePortal({ [method]: ok(true) })
    expect((await b24(call(method, {}, "--yes"), { portal: fake })).code).toBe(5)
    expect(fake.calls).toHaveLength(0)
  })

  it.each(["calendar.event.add", "crm.timeline.comment.add", "user.update", "crm.item.add"])(
    "%s asks, and runs on --yes",
    async (method) => {
      const fake = fakePortal({ [method]: ok(true) })
      const body = { entityTypeId: 31, fields: {} }
      expect((await b24(call(method, body), { portal: fake })).code).toBe(7)
      expect(fake.calls).toHaveLength(0)
      expect((await b24(call(method, body, "--yes"), { portal: fake })).code).toBe(0)
      expect(fake.calls).toHaveLength(1)
    },
  )

  it("a read outside b24's families asks; its own reads do not", async () => {
    const fake = fakePortal({ "disk.folder.getchildren": ok([]), "crm.item.list": ok({ items: [] }), profile: ok({}) })
    expect((await b24(call("disk.folder.getchildren", { id: 1 }), { portal: fake })).code).toBe(7)
    expect(fake.calls).toHaveLength(0)
    expect((await b24(call("disk.folder.getchildren", { id: 1 }, "--yes"), { portal: fake })).code).toBe(0)
    expect((await b24(call("crm.item.list", { entityTypeId: 2 }), { portal: fake })).code).toBe(0)
    expect((await b24(call("profile", {}), { portal: fake })).code).toBe(0)
  })

  it("api show names each level", async () => {
    const levels: Record<string, string> = {}
    for (const method of ["calendar.event.add", "log.blogpost.add", "crm.quote.delete", "crm.item.list", "profile"]) {
      const ran = await b24(["api", "show", method, "--json"])
      levels[method] = String((ran.json().item as Record<string, unknown>).default_level)
    }
    expect(levels).toEqual({
      "calendar.event.add": "ask",
      "log.blogpost.add": "deny",
      "crm.quote.delete": "ask",
      "crm.item.list": "allow",
      profile: "allow",
    })
  })
})

describe("a denied family stays denied for reads", () => {
  it.each(["crm.activity.list", "crm.automation.trigger.list", "im.dialog.messages.get", "tasks.task.list"])(
    "%s is refused with --yes, and api show says deny",
    async (method) => {
      const fake = fakePortal({ [method]: ok([]) })
      expect((await b24(call(method, {}, "--yes"), { portal: fake })).code).toBe(5)
      expect(fake.calls).toHaveLength(0)
      const shown = await b24(["api", "show", method, "--json"])
      expect((shown.json().item as Record<string, unknown>).default_level).toBe("deny")
    },
  )
})

describe("a body is read one way, and that is the body sent", () => {
  const twice = '{"assignedById":7,"ASSIGNED_BY_ID":9}'

  it("M1: an MCP people update naming the assignee twice is refused, with no request", async () => {
    const portal = fakePortal({ "crm.contact.update": ok(true) })
    const mcp = await overMcp(portal)
    try {
      const answer = await mcp.call("b24_write", { command: "people update", arguments: { id: "4", body: twice } })
      expect(answer.isError).toBe(true)
      expect(JSON.stringify(answer)).toContain("validation_error")
    } finally {
      await mcp.close()
    }
    expect(portal.calls).toHaveLength(0)
  })

  it.each([
    ["P9", ["work", "people", "update", "4", "--body", twice]],
    ["P9 with --name", ["work", "organizations", "update", "4", "--name", "x", "--body", '{"TITLE":"y"}']],
    ["P10", call("crm.deal.update", { id: 5, fields: { assignedById: 7, ASSIGNED_BY_ID: 9 } })],
    ["P6b", call("crm.deal.update", { id: 5, fields: { title: "x" }, FIELDS: { STAGE_ID: "C1:WON" } })],
    ["P4", call("crm.item.delete", { ENTITY_TYPE_ID: 7, entityTypeId: 2, id: 5 }, "--yes")],
    ["a nested spelling", call("crm.deal.list", { filter: { stage_id: "NEW", STAGEID: "WON" } })],
  ])("%s: two spellings of one key are refused before any request", async (_, argv) => {
    const portal = fakePortal({ "crm.contact.update": ok(true), "crm.deal.update": ok(true) })
    await withPermissions({ "deals.move": "deny", "deals.close": "deny", "deals.delete": "deny" }, async () => {
      const ran = await b24([...argv, "--json"], { portal })
      expect(ran.code).toBe(2)
      expect(ran.json().error).toMatchObject({ code: "validation_error" })
    })
    expect(portal.calls).toHaveLength(0)
  })

  it.each([
    ["P2", "02", ["--yes"], {}],
    ["P2b", "02", ["--yes"], { CLAUDECODE: "1" }],
    ["P3", " 2", ["--yes"], {}],
    ["P5", "02", [], {}],
    ["2.0 as text", "2.0", ["--yes"], {}],
  ])("%s: entityTypeId %j is refused; only a plain integer names the type", async (_, entityTypeId, rest, env) => {
    const portal = fakePortal({ "crm.item.delete": ok(true) })
    await withPermissions({ "deals.delete": "deny" }, async () => {
      const ran = await b24([...call("crm.item.delete", { entityTypeId, id: 5 }, ...rest), "--json"], { portal, env })
      expect(ran.code).toBe(2)
    })
    expect(portal.calls).toHaveLength(0)
  })

  it("2.0 typed as a number in --body is refused rather than read as deal", async () => {
    const portal = fakePortal({ "crm.item.update": ok(true) })
    const argv = ["work", "api", "call", "crm.item.update", "--body", '{"entityTypeId":2.0,"id":5,"fields":{}}']
    expect((await b24([...argv, "--yes"], { portal })).code).toBe(2)
    expect(portal.calls).toHaveLength(0)
  })

  it('P8: a stage move with entityTypeId "2.0" is refused under deals.move: deny', async () => {
    const portal = fakePortal({ "crm.item.update": ok(true) })
    await withPermissions({ "deals.move": "deny" }, async () => {
      const body = { entityTypeId: "2.0", id: 5, fields: { stageId: "WON" } }
      expect((await b24(call("crm.item.update", body, "--yes"), { portal })).code).toBe(2)
    })
    expect(portal.calls).toHaveLength(0)
  })

  it('entityTypeId "2" names deals as 2 does', async () => {
    const portal = fakePortal({ "crm.item.delete": ok(true) })
    await withPermissions({ "deals.delete": "deny" }, async () => {
      expect((await b24(call("crm.item.delete", { entityTypeId: "2", id: 5 }, "--yes"), { portal })).code).toBe(5)
    })
    expect(portal.calls).toHaveLength(0)
  })

  it("a crm.item call without entityTypeId, or with fields that are not an object, is refused", async () => {
    const portal = fakePortal({ "crm.item.update": ok(true), "crm.deal.update": ok(true) })
    expect((await b24(call("crm.item.update", { id: 5, fields: { title: "x" } }, "--yes"), { portal })).code).toBe(2)
    expect(
      (await b24(call("crm.deal.update", { id: 5, fields: [{ STAGE_ID: "WON" }] }, "--yes"), { portal })).code,
    ).toBe(2)
    expect(portal.calls).toHaveLength(0)
  })

  it.each(["crm.deal.delete.xml", "crm.deal.delete.json.json", "CRM.DEAL.DELETE.XML"])(
    "P7: %s is refused; only one .json suffix is taken",
    async (method) => {
      const portal = fakePortal({ "crm.deal.delete.xml": ok(true), "crm.deal.delete": ok(true) })
      await withPermissions({ "deals.delete": "deny" }, async () => {
        expect((await b24(call(method, { id: 5 }, "--yes"), { portal })).code).toBe(2)
      })
      expect(portal.calls).toHaveLength(0)
    },
  )

  it("people update does not read --body - from stdin, which carries MCP's messages", async () => {
    const portal = fakePortal({ "crm.contact.update": ok(true) })
    expect((await b24(["work", "people", "update", "4", "--body", "-"], { portal })).code).toBe(2)
    expect(portal.calls).toHaveLength(0)
  })

  it("an integer past 2^53 in --body is sent with every digit", async () => {
    const portal = fakePortal({ "crm.deal.list": ok([]) })
    const argv = ["work", "api", "call", "crm.deal.list", "--body", '{"filter":{"id":12345678901234567891}}']
    expect((await b24(argv, { portal })).code).toBe(0)
    expect(portal.calls[0]?.text).toContain("12345678901234567891")
  })
})

describe("api call reads check the command key of what they read", () => {
  it.each([
    ["deals", "crm.deal.list", {}],
    ["deals.show", "crm.deal.get", { id: 5 }],
    ["deals", "crm.deal.productrows.get", { id: 5 }],
    ["deals.list", "crm.item.list", { entityTypeId: 2 }],
    ["people", "crm.contact.list", {}],
    ["people.show", "crm.contact.get", { id: 5 }],
    ["organizations.list", "crm.company.list", {}],
    ["leads.show", "crm.item.get", { entityTypeId: 1, id: 5 }],
    ["products.list", "crm.product.list", {}],
    ["products.list", "catalog.product.list", {}],
    ["products.show", "crm.product.get", { id: 5 }],
    ["users.show", "user.get", { ID: 5 }],
    ["fields.list", "crm.deal.fields", {}],
    ["fields.list", "crm.deal.userfield.list", {}],
    ["pipelines.list", "crm.category.list", { entityTypeId: 2 }],
    ["stages.list", "crm.status.list", {}],
  ])("%s: deny refuses api call %s before any request", async (key, method, body) => {
    const portal = fakePortal({ [method]: ok([]) })
    await withPermissions({ [key]: "deny" }, async () => {
      const ran = await b24([...call(method, body), "--json"], { portal })
      expect(ran.code).toBe(5)
      expect(ran.json().error).toMatchObject({ code: "permission_error" })
      expect((await b24([...call(method, body), "--dry-run", "--json"], { portal })).code).toBe(5)
    })
    expect(portal.calls).toHaveLength(0)
  })

  it("crm.item.productrow.list, which takes no entityTypeId, checks every type's list key", async () => {
    const portal = fakePortal({ "crm.item.productrow.list": ok({ productRows: [] }) })
    const body = { filter: { "=ownerType": "D", "=ownerId": 5 } }
    await withPermissions({ deals: "deny" }, async () => {
      expect((await b24(call("crm.item.productrow.list", body), { portal })).code).toBe(5)
    })
    expect(portal.calls).toHaveLength(0)
    expect((await b24(call("crm.item.productrow.list", body), { portal })).code).toBe(0)
    expect(portal.calls).toHaveLength(1)
  })

  it("a body's own isLosslessNumber object is not taken as a number", async () => {
    const portal = fakePortal({ "crm.item.delete": ok(true) })
    const body = { entityTypeId: { isLosslessNumber: true, value: "2" }, id: 5 }
    expect((await b24(call("crm.item.delete", body, "--yes"), { portal })).code).toBe(2)
    expect(portal.calls).toHaveLength(0)
  })

  it("--dry-run and api show name the read's command key", async () => {
    const ran = await b24([...call("crm.deal.list", {}), "--dry-run", "--json"])
    expect(ran.json().item).toMatchObject({
      permissions: [
        { key: "api.crm.deal.list", level: "allow" },
        { key: "deals.list", level: "allow" },
      ],
    })
    const shown = await b24(["api", "show", "crm.contact.get", "--json"])
    expect((shown.json().item as Record<string, unknown>).also_checks).toEqual(["people.show"])
  })
})

describe("an id that is not a number is refused before any request", () => {
  it("deals update --owner anna", async () => {
    const { ref, calls } = await synced()
    const before = calls()
    await withPermissions({ "crm.assign-others": "allow" }, async () => {
      const ran = await b24(["work", "deals", "update", ref("deals", 102), "--owner", "anna", "--yes", "--json"])
      expect(ran.code).toBe(2)
      expect(ran.json().error).toMatchObject({ code: "validation_error" })
    })
    expect(calls()).toBe(before)
  })

  it.each(["users", "products"])("%s show abc", async (noun) => {
    const portal = seededCrm()
    const ran = await b24(["work", noun, "show", "abc", "--json"], { portal })
    expect(ran.code).toBe(2)
    expect(portal.calls).toHaveLength(0)
  })
})

describe("search all under a denied list key", () => {
  it("leaves deals out and names them; with leads denied too it refuses", async () => {
    const { portal } = await synced()
    await withPermissions({ "deals.list": "deny" }, async () => {
      const ran = await b24(["work", "search", "all", "Example", "--only", "crm", "--json"], { portal })
      expect(ran.code).toBe(0)
      const answer = ran.json() as { items: { kind: string }[]; missing?: unknown }
      expect(answer.items.length).toBeGreaterThan(0)
      expect(answer.items.every((item) => item.kind === "lead")).toBe(true)
      expect(answer.missing).toEqual([{ field: "items", why: "deal left out: profile work denies deals.list" }])
      expect(ran.err).toContain("deal left out: profile work denies deals.list")
    })
    await withPermissions({ "deals.list": "deny", "leads.list": "deny" }, async () => {
      const ran = await b24(["work", "search", "all", "Example", "--only", "crm", "--json"], { portal })
      expect(ran.code).toBe(5)
      expect(ran.json().error).toMatchObject({ code: "permission_error", reason: "search.all-denied" })
    })
  })
})
