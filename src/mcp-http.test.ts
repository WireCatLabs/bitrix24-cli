import { expect, it } from "vitest"
import { run } from "./program.js"

const started = (argv: string[], signal?: AbortSignal, env?: NodeJS.ProcessEnv) => {
  const out: string[] = []
  const err: string[] = []
  const code = run(argv, {
    streams: { data: (text) => out.push(text), diagnostic: (text) => err.push(text) },
    tty: false,
    ...(signal ? { signal } : {}),
    ...(env ? { env } : {}),
  })
  return { code, out, err }
}

const answer = async (argv: string[]) => {
  const one = started(argv)
  expect(await one.code).toBe(0)
  return JSON.parse(one.out.join("")).item
}

it("refuses mcp serve --http without the tunnel's address", async () => {
  const one = started(["personal", "mcp", "serve", "--http", "--json"])
  expect(await one.code).not.toBe(0)
  expect(one.err.join("\n")).toContain("--public-url")
})

it("forgets every browser login on mcp revoke", async () => {
  expect(await answer(["personal", "mcp", "revoke", "--json"])).toEqual({ revoked: true, profile: "personal" })
})

it("refuses mcp revoke under the read-only lock", async () => {
  const one = started(["personal", "mcp", "revoke", "--json"], undefined, { ...process.env, B24_READ_ONLY: "1" })
  expect(await one.code).toBe(5)
})
