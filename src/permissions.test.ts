import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { Client } from "@modelcontextprotocol/client"
import { InMemoryTransport } from "@modelcontextprotocol/server"
import { describeProgram } from "@wirecat/cli-base/commands"
import { changesAuthorityAt } from "@wirecat/cli-core/cli"
import { afterEach, describe, expect, it } from "vitest"
import { configuration } from "./config.js"
import { createMcpServer } from "./mcp.js"
import { createProgram, run } from "./program.js"
import { fakePortal, ok } from "./testing/fake-portal.js"
import { b24, signedIn } from "./testing/harness.js"

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

const deals = () => fakePortal({ "crm.deal.list": ok({ items: [] }), "crm.deal.update": ok({ result: true }) })

describe("a denied command key", () => {
  it("stops a read before any request", async () => {
    const portal = deals()
    await withPermissions({ "deals.list": "deny" }, async () => {
      const ran = await b24(["work", "deals", "list", "--json"], { portal })
      expect(ran.code).toBe(5)
      expect(ran.json().error).toMatchObject({ code: "permission_error" })
    })
    expect(portal.calls).toHaveLength(0)
  })

  it("api.crm.deal.update: deny stops deals update before any request", async () => {
    const portal = deals()
    await withPermissions({ "api.crm.deal.update": "deny" }, async () => {
      expect((await b24(["work", "deals", "update", "5", "--title", "x"], { portal })).code).toBe(5)
      expect((await b24(["work", "deals", "move", "5", "--stage", "WON"], { portal })).code).toBe(5)
    })
    expect(portal.calls).toHaveLength(0)
  })
})

describe("--dry-run", () => {
  it("deals update names its key and the api key its request checks", async () => {
    const portal = deals()
    const ran = await b24(["work", "deals", "update", "5", "--title", "x", "--dry-run", "--json"], { portal })
    expect(ran.code).toBe(0)
    expect(ran.json().item).toMatchObject({
      permission: { key: "deals.update", level: "allow", also: [{ key: "api.crm.deal.update", level: "allow" }] },
    })
    expect(portal.calls).toHaveLength(0)
  })

  it("api call crm.deal.delete names api.crm.deal.delete at ask and deals.delete beside it", async () => {
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
        { key: "deals.delete", level: "allow" },
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
      const ran = await b24(["work", "deals", "update", "5", "--title", "x", "--dry-run", "--json"])
      expect(ran.code).toBe(0)
      expect(ran.json().item).toMatchObject({
        permission: { key: "deals.update", level: "allow", also: [{ key: "api.crm.deal.update", level: "ask" }] },
      })
    })
  })
})

const clients: Client[] = []
afterEach(async () => {
  for (const client of clients.splice(0)) await client.close()
})

const mcpClient = async (portal: ReturnType<typeof fakePortal>) => {
  const program = createProgram()
  const server = createMcpServer({
    profile: "work",
    commands: describeProgram(program),
    levels: () => configuration.resolveSettings({ profile: "work" }).permissions,
    authority: changesAuthorityAt(program),
    run: (argv, options) =>
      run(argv, { ...options, fetch: portal.fetch, keyring: signedIn(), sleep: async () => {} } as Parameters<
        typeof run
      >[1]),
  })
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
  await server.connect(serverSide)
  const client = new Client({ name: "test", version: "1.0.0" })
  await client.connect(clientSide)
  clients.push(client)
  return client
}

it("an MCP read of a denied command is listed as unavailable and refused before any request", async () => {
  const portal = deals()
  await withPermissions({ "deals.list": "deny" }, async () => {
    const client = await mcpClient(portal)
    const found = await client.callTool({ name: "b24_tools_search", arguments: { query: "deals list" } })
    expect((found.structuredContent as { items: unknown[] }).items).toContainEqual(
      expect.objectContaining({ command: "deals list", availability: expect.objectContaining({ available: false }) }),
    )
    const answer = await client.callTool({ name: "b24_read", arguments: { command: "deals list" } })
    expect(JSON.stringify(answer)).toContain("permission_error")
  })
  expect(portal.calls).toHaveLength(0)
})

it("an MCP update that sets a stage checks deals.move", async () => {
  const portal = deals()
  await withPermissions({ "deals.move": "deny" }, async () => {
    const client = await mcpClient(portal)
    const answer = await client.callTool({
      name: "b24_write",
      arguments: { command: "deals update", arguments: { id: "5", body: '{"stageId":"C1:WON"}' } },
    })
    expect(JSON.stringify(answer)).toContain("permission_error")
  })
  expect(portal.calls).toHaveLength(0)
})

it("api call is not offered over MCP", async () => {
  const portal = fakePortal({ "crm.deal.delete": ok(true) })
  const client = await mcpClient(portal)
  const answer = await client.callTool({
    name: "b24_write",
    arguments: { command: "api call", arguments: { method: "crm.deal.delete", body: '{"id":5}' } },
  })
  expect(answer.isError).toBe(true)
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

describe("a write that sets a stage checks the move key", () => {
  it.each([
    [["deals", "update", "5", "--body", '{"stageId":"C1:WON"}']],
    [["deals", "update", "5", "--body", '{"STAGE_ID":"C1:WON"}']],
    [["deals", "create", "--title", "x", "--body", '{"stageId":"C1:WON"}']],
  ])("b24 %j", async (argv) => {
    const fake = fakePortal({ "crm.deal.update": ok(true), "crm.deal.add": ok({ id: 1 }) })
    await withPermissions({ "deals.move": "deny" }, async () => {
      expect((await b24(["work", ...argv], { portal: fake })).code).toBe(5)
    })
    expect(fake.calls).toHaveLength(0)
  })

  it("a lead's STATUS_ID checks leads.move, through the command and api call", async () => {
    const fake = fakePortal({ "crm.lead.update": ok(true), "crm.item.update": ok(true) })
    await withPermissions({ "leads.move": "deny" }, async () => {
      expect(
        (await b24(["work", "leads", "update", "5", "--body", '{"STATUS_ID":"WON"}'], { portal: fake })).code,
      ).toBe(5)
      const item = call("crm.item.update", { entityTypeId: 1, id: 5, fields: { STAGE_ID: "WON" } })
      expect((await b24(item, { portal: fake })).code).toBe(5)
    })
    expect(fake.calls).toHaveLength(0)
  })

  it("ASSIGNED_BY_ID checks crm.assign-others like assignedById", async () => {
    const fake = fakePortal({ "crm.deal.update": ok(true) })
    expect((await b24(["work", "deals", "update", "5", "--body", '{"ASSIGNED_BY_ID":9}'], { portal: fake })).code).toBe(
      5,
    )
    expect((await b24(call("crm.deal.update", { id: 5, fields: { ASSIGNED_BY_ID: 9 } }), { portal: fake })).code).toBe(
      5,
    )
    expect(fake.calls).toHaveLength(0)
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
      expect((await b24(call(method, { fields: {} }), { portal: fake })).code).toBe(7)
      expect(fake.calls).toHaveLength(0)
      expect((await b24(call(method, { fields: {} }, "--yes"), { portal: fake })).code).toBe(0)
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

it("pipeline_id:0 filters the default pipeline", async () => {
  const fake = fakePortal({ "crm.deal.list": ok({ items: [] }) })
  expect((await b24(["work", "deals", "list", "pipeline_id:0", "--json"], { portal: fake })).code).toBe(0)
  expect(JSON.stringify(fake.calls[0]?.body)).toContain('"categoryId"')
})
