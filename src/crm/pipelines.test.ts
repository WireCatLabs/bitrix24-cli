import { describe, expect, it } from "vitest"
import { BitrixTransport } from "../bitrix/transport.js"
import { FAKE_WEBHOOK, fakePortal, ok } from "../testing/fake-portal.js"
import { bitrixPipelines } from "./pipelines.js"

const stagesFrom = async (rows: Record<string, unknown>[]) => {
  const portal = fakePortal({
    "crm.category.list": ok({ categories: [{ id: 7, name: "Example sales" }] }),
    "crm.status.list": ok(rows, { total: rows.length }),
  })
  const transport = new BitrixTransport({ auth: FAKE_WEBHOOK, fetch: portal.fetch, sleep: async () => {} })
  const [pipeline] = await bitrixPipelines(transport, "deal")
  return pipeline?.stages.map(({ externalId, outcome }) => [externalId, outcome])
}

describe("stage outcomes", () => {
  // b24restdocs tutorials/crm/how-to-get-lists/how-to-get-deal-funnels.md: no top-level SEMANTICS, only EXTRA.
  it("reads won and lost from EXTRA.SEMANTICS when the stage has no short SEMANTICS", async () => {
    const extra = (id: string, semantics: string) => ({
      ENTITY_ID: "DEAL_STAGE_7",
      STATUS_ID: id,
      NAME: id,
      EXTRA: { SEMANTICS: semantics, COLOR: "#39A8EF" },
    })
    expect(
      await stagesFrom([
        extra("NEW", "process"),
        extra("WON", "success"),
        extra("LOSE", "failure"),
        extra("APOLOGY", "apology"),
      ]),
    ).toEqual([
      ["NEW", "open"],
      ["WON", "won"],
      ["LOSE", "lost"],
      ["APOLOGY", "lost"],
    ])
  })

  // b24restdocs tutorials/crm/how-to-get-lists/how-to-get-elements-by-stage-filter.md: both forms, SEMANTICS null when open.
  it("reads the short SEMANTICS beside EXTRA as before", async () => {
    const both = (id: string, short: string | null, semantics: string) => ({
      ENTITY_ID: "DEAL_STAGE_7",
      STATUS_ID: id,
      NAME: id,
      SEMANTICS: short,
      EXTRA: { SEMANTICS: semantics, COLOR: "#39A8EF" },
    })
    expect(
      await stagesFrom([
        both("C7:NEW", null, "process"),
        both("C7:WON", "S", "success"),
        both("C7:LOSE", "F", "failure"),
        both("C7:APOLOGY", "F", "apology"),
      ]),
    ).toEqual([
      ["C7:NEW", "open"],
      ["C7:WON", "won"],
      ["C7:LOSE", "lost"],
      ["C7:APOLOGY", "lost"],
    ])
  })
})
