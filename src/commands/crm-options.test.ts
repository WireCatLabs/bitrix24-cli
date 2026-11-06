import { describe, expect, it } from "vitest"
import { b24, synced } from "../testing/harness.js"

describe("every option of the CRM commands runs against the fake portal", () => {
  it("sync, lists, pipelines and search", async () => {
    const { portal } = await synced()
    for (const argv of [
      ["sync", "--rescan", "--max-pages", "50"],
      ["deals", "list", "--limit", "1", "--page", "2"],
      ["leads", "list", "--limit", "5", "--page", "1"],
      ["pipelines", "list", "kind:deal"],
      ["pipelines", "show", "Example sales"],
      ["search", "all", "kitchen", "--only", "crm", "--limit", "5", "--page", "1", "--exact", "--timezone", "UTC"],
      ["search", "all", "kitchen", "--source", "bitrix24", "--max-meetings", "1"],
    ])
      expect((await b24(["work", ...argv, "--json"], { portal })).code, argv.join(" ")).toBe(0)
  })

  it("deal writes take every field and --operation-id", async () => {
    const { portal, ref } = await synced()
    const deal = ref("deals", 102)
    for (const argv of [
      [
        "create",
        "--title",
        "WireCat test",
        "--pipeline",
        "Example sales",
        "--close-date",
        "2026-12-01",
        "--owner",
        "7",
      ],
      ["create", "--title", "WireCat test", "--pipeline", "Example sales", "--operation-id", "op-create"],
      ["update", deal, "--pipeline", "Example partners", "--stage", "New", "--amount", "10.5", "--currency", "usd"],
      ["update", deal, "--close-date", "2026-12-24"],
      ["move", deal, "New", "--operation-id", "op-move"],
      ["close", deal, "won", "--operation-id", "op-close"],
      ["delete", deal, "--yes", "--operation-id", "op-delete"],
    ])
      expect((await b24(["work", "deals", ...argv, "--json"], { portal })).code, argv.join(" ")).toBe(0)
  })

  it("lead writes take every field a lead has and --operation-id", async () => {
    const { portal, ref } = await synced()
    const lead = ref("leads", 104)
    const run = async (...argv: string[]) => (await b24(["work", "leads", ...argv, "--json"], { portal })).code
    expect(await run("show", lead)).toBe(0)
    expect(
      await run(
        "create",
        "--title",
        "WireCat test",
        "--pipeline",
        "Leads",
        "--stage",
        "In progress",
        "--amount",
        "1",
        "--currency",
        "EUR",
        "--owner",
        "7",
        "--field",
        "Note=Example",
        "--operation-id",
        "op-lead",
      ),
    ).toBe(0)
    expect(await run("create", "--title", "WireCat test", "--close-date", "2026-12-01")).toBe(2)
    expect(
      await run(
        "update",
        lead,
        "--title",
        "Example",
        "--pipeline",
        "Leads",
        "--stage",
        "Unprocessed",
        "--amount",
        "2",
        "--currency",
        "EUR",
        "--owner",
        "7",
        "--operation-id",
        "op-lead-update",
      ),
    ).toBe(0)
    expect(await run("move", lead, "In progress", "--operation-id", "op-lead-move")).toBe(0)
    expect(await run("close", lead, "lost", "--reason", "Example", "--operation-id", "op-lead-close")).toBe(2)
    expect(await run("close", lead, "lost")).toBe(0)
    expect(await run("delete", lead, "--yes", "--operation-id", "op-lead-delete")).toBe(0)
  })

  it("doctor --online answers", async () => {
    expect((await b24(["doctor", "--online", "--json"])).code).toBe(0)
  })
})
