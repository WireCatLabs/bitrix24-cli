import * as v from "valibot"
import type { FieldMap } from "./conditions.js"
import type { ItemType } from "./items.js"
import {
  customFields,
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

export const dealSchema = v.strictObject({
  id: v.string(),
  title: v.nullable(v.string()),
  pipeline_id: v.nullable(v.string()),
  stage_id: v.nullable(v.string()),
  outcome: v.picklist(OUTCOMES),
  amount: v.nullable(v.number()),
  currency: v.nullable(v.string()),
  assigned_to: v.nullable(v.string()),
  organization_id: v.nullable(v.string()),
  person_ids: v.array(v.string()),
  closes_on: v.nullable(v.string()),
  created_at: nullableTime,
  updated_at: nullableTime,
  url: v.nullable(v.string()),
  provider_metadata: metadataSchema,
})

export type Deal = v.InferOutput<typeof dealSchema>

export const DEAL_FIELDS: Record<string, FieldMap> = {
  title: { field: "title", kind: "word" },
  pipeline_id: { field: "categoryId", kind: "id" },
  stage_id: { field: "stageId", kind: "text" },
  outcome: { field: "stageSemanticId", kind: "outcome" },
  amount: { field: "opportunity", kind: "number" },
  currency: { field: "currencyId", kind: "text" },
  assigned_to: { field: "assignedById", kind: "id" },
  organization_id: { field: "companyId", kind: "id" },
  created_at: { field: "createdTime", kind: "time" },
  updated_at: { field: "updatedTime", kind: "time" },
}

/** Bitrix24 ⇄ neutral for a deal. REST 3.0 names a deal's contacts `contactsId`, REST 2's crm.item `contactIds`. */
export const fromBitrixDeal = (raw: Raw, custom?: Raw): Deal => ({
  id: id(raw.id) ?? "",
  title: text(raw.title),
  pipeline_id: text(raw.categoryId),
  stage_id: text(raw.stageId),
  outcome: outcomeOf(raw.stageSemanticId),
  amount: number(raw.opportunity),
  currency: text(raw.currencyId),
  assigned_to: id(raw.assignedById),
  organization_id: id(raw.companyId),
  person_ids: ids(raw.contactsId ?? raw.contactIds),
  closes_on: text(raw.closeTime ?? raw.closedate)?.slice(0, 10) ?? null,
  created_at: time(raw.createdTime),
  updated_at: time(raw.updatedTime),
  url: text(raw.url),
  ...(custom && Object.keys(customFields(custom)).length ? { provider_metadata: customFields(custom) } : {}),
})

export const DEAL: ItemType<Deal> = {
  type: "deal",
  entityTypeId: 2,
  word: "deal",
  select: [
    "id",
    "title",
    "categoryId",
    "stageId",
    "stageSemanticId",
    "opportunity",
    "currencyId",
    "assignedById",
    "companyId",
    "contactsId",
    "contactIds",
    "closeTime",
    "closedate",
    "createdTime",
    "updatedTime",
    "url",
  ],
  words: ["title"],
  nameOf: (deal) => deal.title,
  map: fromBitrixDeal,
}
