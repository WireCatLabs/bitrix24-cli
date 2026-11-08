import { describeProgram } from "@wirecat/cli-base/commands"
import { changesAuthorityAt, readsOverMcpAt } from "@wirecat/cli-core/cli"
import { toolsFromCommands } from "@wirecat/cli-core/mcp"
import { mcpOverStdio } from "@wirecat/cli-core/testing"
import { expect, it } from "vitest"
import { permissions } from "./config.js"
import { createProgram, run } from "./program.js"
import { signedIn } from "./testing/harness.js"

const serve = () =>
  mcpOverStdio((streams) =>
    run(["personal", "mcp", "serve"], {
      tty: false,
      streams: { data: () => {}, diagnostic: () => {} },
      keyring: signedIn(),
      ...streams,
    } as Parameters<typeof run>[1]),
  )

it("serves search, read and write, and runs a command through the CLI", async () => {
  const mcp = await serve()
  try {
    expect((await mcp.tools()).sort()).toEqual(["b24_read", "b24_tools_search", "b24_write"])
    const doctor = await mcp.call("b24_read", { command: "doctor" })
    expect(doctor.body).toMatchObject({ item: { version: expect.any(String) } })
  } finally {
    expect(await mcp.close()).toBe(0)
  }
})

it("pins the commands an agent can find, and never offers api call or schedule", async () => {
  const program = createProgram()
  const tools = toolsFromCommands(describeProgram(program), {
    includeUnavailable: true,
    exclude: [["mcp"]],
    authority: changesAuthorityAt(program),
    fetchOnly: readsOverMcpAt(program),
    permissions,
  })
  const catalogue = Object.fromEntries(tools.map((tool) => [tool.command, tool.writes ? "write" : "read"]))
  await expect(`${JSON.stringify(catalogue, null, 2)}\n`).toMatchFileSnapshot("../contracts/mcp-catalogue.json")
  expect(Object.keys(catalogue)).not.toContain("api call")
  expect(Object.keys(catalogue).filter((command) => command.startsWith("schedule"))).toEqual([])
  expect(catalogue["deals update"]).toBe("write")
})
