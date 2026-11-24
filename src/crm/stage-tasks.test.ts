import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { fakeCrm } from "../testing/fake-crm.js"
import { ok } from "../testing/fake-portal.js"
import { b24 } from "../testing/harness.js"

const RULES = "crm.bitrix24:example.bitrix24.test.stage-tasks"

describe("stage tasks from the portal's stage history", () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
  })

  it("opens a task when a deal moves into a stage the rules name, as bin/b24-live checks", async () => {
    vi.stubEnv("MESSAGING_STORE", join(mkdtempSync(join(tmpdir(), "stage-tasks-")), "store.db"))
    const history: Record<string, unknown>[] = []
    const portal = fakeCrm({
      "crm.stagehistory.list": ({ body }) => ok({ items: body.entityTypeId === 2 ? history : [] }),
    })
    const deal = portal.put("deal", { title: "Example kitchen", categoryId: 0, stageId: "NEW" })
    expect((await b24(["work", "sync", "--json"], { portal })).code).toBe(0)
    // The portal keeps whole seconds: a move in the second the rules were set reads as made before them.
    vi.useFakeTimers({ toFake: ["Date"], now: Date.parse("2026-11-19T21:43:07.300Z") })
    const rules = JSON.stringify({ PREPARATION: { title: "Example task", due_days: 0 } })
    expect((await b24(["work", "config", "set", RULES, rules, "--json"])).code).toBe(0)
    portal.put("deal", { ...portal.row("deal", deal), stageId: "PREPARATION" })
    vi.setSystemTime(Date.parse("2026-11-19T21:43:09.000Z"))
    const moved = "2026-11-19T22:43:07+01:00"
    history.push({
      ID: "11",
      TYPE_ID: "2",
      OWNER_ID: String(deal),
      CREATED_TIME: moved,
      STAGE_ID: "PREPARATION",
      CATEGORY_ID: "0",
    })
    const synced = await b24(["work", "sync", "--json"], { portal })
    expect(synced.code).toBe(0)
    expect((synced.json() as { item: { stage_tasks: number } }).item.stage_tasks).toBe(1)
  })
})
