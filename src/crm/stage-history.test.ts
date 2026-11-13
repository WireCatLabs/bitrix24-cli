import { describe, expect, it } from "vitest"
import { readStageHistory } from "./stage-history.js"

const SINCE = Date.UTC(2026, 10, 12)

const portal = (rows: Record<string, unknown>[]) => {
  const calls: Record<string, unknown>[] = []
  return {
    calls,
    call: async (_method: string, params: Record<string, unknown> = {}) => {
      calls.push(params)
      return { result: { items: rows } }
    },
  }
}

const row = (fields: Record<string, unknown>) => ({
  ID: "101",
  TYPE_ID: "2",
  OWNER_ID: "12",
  CREATED_TIME: "2026-11-12T10:00:00+03:00",
  ...fields,
})

describe("Bitrix24 stage history", () => {
  it("gives each deal's entry into a stage with its pipeline, never a creation, from the time on a first read", async () => {
    const fake = portal([
      row({ ID: "100", TYPE_ID: "1", STAGE_ID: "NEW", CATEGORY_ID: "0" }),
      row({ ID: "101", STAGE_ID: "C7:QUOTE", CATEGORY_ID: "7" }),
      row({ ID: "102", TYPE_ID: "3", STAGE_ID: "WON", CATEGORY_ID: "0" }),
    ])
    const page = await readStageHistory(fake, "deal", SINCE, undefined)
    expect(page).toEqual({
      items: [
        {
          externalId: "101",
          kind: "deal",
          item: "12",
          pipeline: "7",
          stage: "C7:QUOTE",
          at: Date.parse("2026-11-12T07:00:00Z"),
        },
        {
          externalId: "102",
          kind: "deal",
          item: "12",
          pipeline: "0",
          stage: "WON",
          at: Date.parse("2026-11-12T07:00:00Z"),
        },
      ],
      hasMore: false,
      cursor: "102",
    })
    expect(fake.calls[0]).toMatchObject({ entityTypeId: 2, order: { ID: "ASC" } })
    expect(Object.keys(fake.calls[0]?.filter as object)).toEqual([">=CREATED_TIME"])
  })

  it("reads a lead's STATUS_ID in the one lead pipeline, after the last row read, and keeps the place when none came", async () => {
    const fake = portal([row({ ID: "7", STATUS_ID: "IN_PROCESS" })])
    expect((await readStageHistory(fake, "lead", SINCE, "6")).items).toEqual([
      expect.objectContaining({ kind: "lead", pipeline: "0", stage: "IN_PROCESS" }),
    ])
    expect(fake.calls[0]).toMatchObject({ entityTypeId: 1, filter: { ">ID": 6 } })
    expect(await readStageHistory(portal([]), "lead", SINCE, "7")).toEqual({ items: [], hasMore: false, cursor: "7" })
  })

  it("asks for the next page after a full one", async () => {
    const rows = Array.from({ length: 50 }, (_, at) => row({ ID: String(at + 1), STAGE_ID: "NEW", CATEGORY_ID: "0" }))
    expect(await readStageHistory(portal(rows), "deal", SINCE, undefined)).toMatchObject({
      hasMore: true,
      nextCursor: "50",
    })
  })
})
