import type { CrmItem, CrmPipeline } from "@wirecat/cli-core"
import { crmValues } from "@wirecat/cli-core/crm"
import { contactsOn } from "./deal.js"
import type { ItemType } from "./items.js"
import { fullName, type Raw } from "./values.js"

const { amountOf, epoch, id, text } = crmValues

/** Bitrix24's leads have no pipelines, only the one list of lead stages: core gets one pipeline of b24's making. */
export const LEAD_PIPELINE: Omit<CrmPipeline, "stages"> = { externalId: "0", name: "Leads" }

export const fromBitrixLead = (raw: Raw, metadata?: CrmItem["metadata"]): CrmItem => {
  const item: CrmItem = {
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

export const LEAD: ItemType = {
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
}
