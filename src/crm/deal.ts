import type { CrmItem } from "@wirecat/cli-core"
import type { ItemType } from "./items.js"
import { amountOf, epoch, id, ids, type Metadata, type Raw, text } from "./values.js"

/** The contacts on a deal or lead; the main one is `contactId`, which REST 3.0 keeps first in `contactsId`. */
export const contactsOn = (raw: Raw): NonNullable<CrmItem["people"]> => {
  const listed = ids(raw.contactsId)
  const primary = id(raw.contactId) ?? listed[0]
  return listed.map((externalId) => ({
    externalId,
    role: "contact",
    ...(externalId === primary ? { primary: true } : {}),
  }))
}

/** Bitrix24 ⇄ neutral for a deal: its pipeline is its category, `0` the default one. */
export const fromBitrixDeal = (raw: Raw, metadata?: Metadata): CrmItem => ({
  externalId: id(raw.id) ?? "",
  title: text(raw.title) ?? "",
  pipeline: text(raw.categoryId) ?? "0",
  stage: text(raw.stageId) ?? "",
  ...amountOf(raw.opportunity, raw.currencyId),
  closeDate: text(raw.closeTime)?.slice(0, 10) ?? null,
  organization: id(raw.companyId),
  people: contactsOn(raw),
  createdAt: epoch(raw.createdTime),
  updatedAt: epoch(raw.updatedTime),
  url: text(raw.url),
  assignee: id(raw.assignedById),
  ...(metadata ? { metadata } : {}),
})

export const DEAL: ItemType<CrmItem> = {
  type: "deal",
  entityTypeId: 2,
  word: "deal",
  select: [
    "id",
    "title",
    "categoryId",
    "stageId",
    "opportunity",
    "currencyId",
    "companyId",
    "contactId",
    "contactsId",
    "closeTime",
    "createdTime",
    "updatedTime",
    "url",
    "assignedById",
  ],
  words: ["title"],
  nameOf: (deal) => deal.title,
  map: fromBitrixDeal,
}
