import { describe, expect, it } from "vitest"
import { DEAL } from "./deal.js"
import type { ItemType } from "./items.js"
import { LEAD } from "./lead.js"
import { ORGANIZATION } from "./organization.js"
import { PERSON } from "./person.js"
import { REST3_FIELDS } from "./rest3-fields.js"
import { LIVE_FIELDS } from "./source.js"

const TYPES: [Pick<ItemType, "type" | "select">, Readonly<Record<string, string>>][] = [
  [DEAL, {}],
  [LEAD, {}],
  [PERSON, LIVE_FIELDS.person],
  [ORGANIZATION, LIVE_FIELDS.organization],
]
/** What the sync filters by, and what a deal or lead write sets. */
const SYNC = ["id", "updatedTime"]
const WRITES = ["title", "categoryId", "stageId", "opportunity", "currencyId", "closeTime", "companyId", "assignedById"]

describe("REST 3.0 field names", () => {
  it.each(TYPES)("selects and filters only documented fields of $type", (type, fields) => {
    const known = REST3_FIELDS[type.type]
    const filtered = Object.values(fields)
    expect([...type.select, ...SYNC, ...filtered].filter((name) => !known.includes(name))).toEqual([])
  })

  it("writes only documented deal fields, and a lead's less its close date and pipeline", () => {
    expect(WRITES.filter((name) => !REST3_FIELDS.deal.includes(name))).toEqual([])
    expect(WRITES.filter((name) => !REST3_FIELDS.lead.includes(name))).toEqual(["categoryId", "closeTime"])
  })
})
