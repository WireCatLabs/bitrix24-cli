import type { CrmItem, CrmPipeline } from "@wirecat/cli-core"
import type { ItemType } from "./items.js"
import { amountOf, epoch, id, ids, type Metadata, type Raw, text } from "./values.js"

/** Bitrix24's leads have no pipelines, only the one list of lead stages: core gets one pipeline of b24's making. */
export const LEAD_PIPELINE: Omit<CrmPipeline, "stages"> = { externalId: "0", name: "Leads" }

export const fromBitrixLead = (raw: Raw, metadata?: Metadata): CrmItem => ({
  externalId: id(raw.id) ?? "",
  title: text(raw.title) ?? "",
  pipeline: LEAD_PIPELINE.externalId,
  stage: text(raw.stageId) ?? "",
  ...amountOf(raw.opportunity, raw.currencyId),
  organization: id(raw.companyId),
  people: ids(raw.contactsId).map((externalId) => ({ externalId, role: "contact" as const })),
  createdAt: epoch(raw.createdTime),
  updatedAt: epoch(raw.updatedTime),
  url: text(raw.url),
  ...(metadata ? { metadata } : {}),
})

export const LEAD: ItemType<CrmItem> = {
  type: "lead",
  entityTypeId: 1,
  word: "lead",
  select: [
    "id",
    "title",
    "stageId",
    "opportunity",
    "currencyId",
    "companyId",
    "contactsId",
    "createdTime",
    "updatedTime",
    "url",
  ],
  words: ["title"],
  nameOf: (lead) => lead.title,
  map: fromBitrixLead,
}
