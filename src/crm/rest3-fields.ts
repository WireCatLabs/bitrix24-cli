import type { ItemType } from "./items.js"

/**
 * The REST 3.0 fields b24 may name, per type, from the field pages: REST 3.0 refuses the whole call over one unknown
 * field (BITRIX_REST_V3_EXCEPTION_UNKNOWNDTOPROPERTYEXCEPTION, seen live 2026-11-06).
 * https://apidocs.bitrix24.com/api-reference/crm/rest-v3/items/fields-deal.html (and fields-lead, -contact, -company)
 */
const COMMON = ["id", "title", "createdTime", "updatedTime", "assignedById", "url", "phone", "email"]
export const REST3_FIELDS: Record<ItemType<unknown>["type"], readonly string[]> = {
  deal: [
    ...COMMON,
    "categoryId",
    "stageId",
    "stageSemanticId",
    "opportunity",
    "currencyId",
    "companyId",
    "contactId",
    "contactsId",
    "leadId",
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
    "contactId",
    "contactsId",
    "sourceId",
  ],
  contact: [...COMMON, "name", "secondName", "lastName", "post", "companyId", "companiesId", "typeId", "sourceId"],
  company: [...COMMON, "typeId", "industryId", "revenue", "currencyId", "contactsId"],
}
