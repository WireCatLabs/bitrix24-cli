import type { CrmItem, CrmPipeline } from "@wirecat/cli-core"
import { contactsOn } from "./deal.js"
import type { ItemType } from "./items.js"
import { amountOf, epoch, fullName, id, type Metadata, type Raw, text } from "./values.js"

/** Bitrix24's leads have no pipelines, only the one list of lead stages: core gets one pipeline of b24's making. */
export const LEAD_PIPELINE: Omit<CrmPipeline, "stages"> = { externalId: "0", name: "Leads" }

// TODO(cli-core#2869): drop the intersection once the pinned cli-core's CrmItem has both fields.
type LeadItem = CrmItem & { contactName?: string | null; companyName?: string | null }

export const fromBitrixLead = (raw: Raw, metadata?: Metadata): CrmItem => {
  const item: LeadItem = {
    externalId: id(raw.id) ?? "",
    title: text(raw.title) ?? "",
    pipeline: LEAD_PIPELINE.externalId,
    stage: text(raw.stageId) ?? "",
    ...amountOf(raw.opportunity, raw.currencyId),
    organization: id(raw.companyId),
    people: contactsOn(raw),
    contactName: fullName(raw.name, raw.secondName, raw.lastName),
    companyName: text(raw.companyTitle),
    createdAt: epoch(raw.createdTime),
    updatedAt: epoch(raw.updatedTime),
    url: text(raw.url),
    assignee: id(raw.assignedById),
    ...(metadata ? { metadata } : {}),
  }
  return item
}

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
    "name",
    "secondName",
    "lastName",
    "companyTitle",
    "companyId",
    "contactId",
    "contactsId",
    "createdTime",
    "updatedTime",
    "url",
    "assignedById",
  ],
  words: ["title"],
  nameOf: (lead) => lead.title,
  map: fromBitrixLead,
}
