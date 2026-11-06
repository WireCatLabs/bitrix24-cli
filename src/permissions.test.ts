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

it("an MCP read of a denied command is refused before any request", async () => {
  const portal = deals()
  await withPermissions({ "deals.list": "deny" }, async () => {
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
    const answer = await client.callTool({ name: "b24_read", arguments: { command: "deals list" } })
    expect(JSON.stringify(answer)).toContain("permission_error")
  })
  expect(portal.calls).toHaveLength(0)
})
