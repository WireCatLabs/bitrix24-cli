import { describe, expect, it } from "vitest"
import type { FieldMap } from "./conditions.js"
import { DEAL, DEAL_FIELDS } from "./deal.js"
import type { ItemType } from "./items.js"
import { LEAD, LEAD_FIELDS } from "./lead.js"
import { ORGANIZATION, ORGANIZATION_FIELDS } from "./organization.js"
import { PERSON, PERSON_FIELDS } from "./person.js"

// REST 3.0 refuses the whole call over one unknown field (BITRIX_REST_V3_EXCEPTION_UNKNOWNDTOPROPERTYEXCEPTION), and
// the fake portal accepts anything, so names are checked against the field pages:
// https://apidocs.bitrix24.com/api-reference/crm/rest-v3/items/fields-deal.html (and fields-lead, -contact, -company)
const COMMON = ["id", "title", "createdTime", "updatedTime", "assignedById", "url", "phone", "email"]
const DOCUMENTED: Record<string, readonly string[]> = {
  deal: [
    ...COMMON,
    "categoryId",
    "stageId",
    "stageSemanticId",
    "opportunity",
    "currencyId",
    "companyId",
    "contactsId",
    "closeTime",
    "sourceId",
    "typeId",
  ],
  lead: [
    ...COMMON,
    "name",
    "secondName",
    "lastName",
    "companyTitle",
    "stageId",
    "stageSemanticId",
    "opportunity",
    "currencyId",
    "companyId",
    "contactsId",
    "sourceId",
  ],
  contact: [...COMMON, "name", "secondName", "lastName", "post", "companyId", "companiesId", "typeId", "sourceId"],
  company: [...COMMON, "typeId", "industryId", "revenue", "currencyId", "contactsId"],
}

const TYPES: [Pick<ItemType<never>, "type" | "select">, Record<string, FieldMap>][] = [
  [DEAL, DEAL_FIELDS],
  [LEAD, LEAD_FIELDS],
  [PERSON, PERSON_FIELDS],
  [ORGANIZATION, ORGANIZATION_FIELDS],
]

describe("REST 3.0 field names", () => {
  it.each(TYPES)("selects and filters only documented fields of $type", (type, fields) => {
    const known = DOCUMENTED[type.type] ?? []
    const filtered = Object.values(fields).map((map) => map.field)
    expect([...type.select, ...filtered].filter((name) => !known.includes(name))).toEqual([])
  })
})
