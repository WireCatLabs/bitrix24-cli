import type { CrmItem } from "@wirecat/cli-core"
import type { ItemType } from "./items.js"
import { amountOf, epoch, id, ids, type Metadata, type Raw, text } from "./values.js"

/** Bitrix24 ⇄ neutral for a deal: its pipeline is its category, `0` the default one. */
export const fromBitrixDeal = (raw: Raw, metadata?: Metadata): CrmItem => ({
  externalId: id(raw.id) ?? "",
  title: text(raw.title) ?? "",
  pipeline: text(raw.categoryId) ?? "0",
  stage: text(raw.stageId) ?? "",
  ...amountOf(raw.opportunity, raw.currencyId),
  closeDate: text(raw.closeTime)?.slice(0, 10) ?? null,
  organization: id(raw.companyId),
  people: ids(raw.contactsId).map((externalId) => ({ externalId, role: "contact" as const })),
  createdAt: epoch(raw.createdTime),
  updatedAt: epoch(raw.updatedTime),
  url: text(raw.url),
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
    "contactsId",
    "closeTime",
    "createdTime",
    "updatedTime",
    "url",
  ],
  words: ["title"],
  nameOf: (deal) => deal.title,
  map: fromBitrixDeal,
}
