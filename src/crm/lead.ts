import * as v from "valibot"
import type { FieldMap } from "./conditions.js"
import type { ItemType } from "./items.js"
import {
  contactSchema,
  contacts,
  customFields,
  fullName,
  id,
  ids,
  metadataSchema,
  nullableTime,
  number,
  OUTCOMES,
  outcomeOf,
  type Raw,
  text,
  time,
} from "./values.js"

export const leadSchema = v.strictObject({
  id: v.string(),
  title: v.nullable(v.string()),
  name: v.nullable(v.string()),
  organization_name: v.nullable(v.string()),
  stage_id: v.nullable(v.string()),
  outcome: v.picklist(OUTCOMES),
  amount: v.nullable(v.number()),
  currency: v.nullable(v.string()),
  assigned_to: v.nullable(v.string()),
  organization_id: v.nullable(v.string()),
  person_ids: v.array(v.string()),
  phones: v.optional(v.array(contactSchema)),
  emails: v.optional(v.array(contactSchema)),
  source_id: v.nullable(v.string()),
  created_at: nullableTime,
  updated_at: nullableTime,
  url: v.nullable(v.string()),
  provider_metadata: metadataSchema,
})

export type Lead = v.InferOutput<typeof leadSchema>

export const LEAD_FIELDS: Record<string, FieldMap> = {
  title: { field: "title", kind: "word" },
  stage_id: { field: "stageId", kind: "text" },
  outcome: { field: "stageSemanticId", kind: "outcome" },
  amount: { field: "opportunity", kind: "number" },
  currency: { field: "currencyId", kind: "text" },
  assigned_to: { field: "assignedById", kind: "id" },
  organization_id: { field: "companyId", kind: "id" },
  source_id: { field: "sourceId", kind: "text" },
  created_at: { field: "createdTime", kind: "time" },
  updated_at: { field: "updatedTime", kind: "time" },
}

/** Phones and emails come from REST 3.0 only; REST 2's crm.item.list leaves them out, so they are left out here too. */
export const fromBitrixLead = (raw: Raw, custom?: Raw): Lead => ({
  id: id(raw.id) ?? "",
  title: text(raw.title),
  name: fullName(raw.name, raw.secondName, raw.lastName),
  organization_name: text(raw.companyTitle),
  stage_id: text(raw.stageId),
  outcome: outcomeOf(raw.stageSemanticId),
  amount: number(raw.opportunity),
  currency: text(raw.currencyId),
  assigned_to: id(raw.assignedById),
  organization_id: id(raw.companyId),
  person_ids: ids(raw.contactsId ?? raw.contactIds),
  ...(Array.isArray(raw.phone) ? { phones: contacts(raw.phone) } : {}),
  ...(Array.isArray(raw.email) ? { emails: contacts(raw.email) } : {}),
  source_id: text(raw.sourceId),
  created_at: time(raw.createdTime),
  updated_at: time(raw.updatedTime),
  url: text(raw.url),
  ...(custom && Object.keys(customFields(custom)).length ? { provider_metadata: customFields(custom) } : {}),
})

export const LEAD: ItemType<Lead> = {
  type: "lead",
  entityTypeId: 1,
  word: "lead",
  select: [
    "id",
    "title",
    "name",
    "secondName",
    "lastName",
    "companyTitle",
    "stageId",
    "stageSemanticId",
    "opportunity",
    "currencyId",
    "assignedById",
    "companyId",
    "contactsId",
    "contactIds",
    "phone",
    "email",
    "sourceId",
    "createdTime",
    "updatedTime",
    "url",
  ],
  words: ["title"],
  nameOf: (lead) => lead.title,
  map: fromBitrixLead,
}
