import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { seededCrm } from "../testing/fake-crm.js"
import { b24 } from "../testing/harness.js"

const storedUnder = async (tz: string) => {
  vi.stubEnv("TZ", tz)
  vi.stubEnv("MESSAGING_STORE", join(mkdtempSync(join(tmpdir(), "zone-")), "store.db"))
  const portal = seededCrm()
  expect((await b24(["work", "sync", "--json"], { portal })).code).toBe(0)
  const items = async (kind: string) =>
    ((await b24(["work", kind, "list", "--offline", "--json"], { portal })).json() as { items: unknown[] }).items
  return { deals: await items("deals"), leads: await items("leads") }
}

describe("time zones (WC-TIME-6)", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("stores the same portal answers identically under two zones", async () => {
    const east = await storedUnder("Asia/Vladivostok")
    const west = await storedUnder("America/Los_Angeles")
    expect(east.deals.length).toBeGreaterThan(0)
    expect(east.leads.length).toBeGreaterThan(0)
    expect(west).toEqual(east)
  })
})
