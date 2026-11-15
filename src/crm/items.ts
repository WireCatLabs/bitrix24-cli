import type { CrmPage, CrmWindow } from "@wirecat/cli-core/crm"
import type { BitrixCaller } from "../bitrix/transport.js"
import { type Condition, needsRest2, rest2Filter, rest3Filter } from "./conditions.js"
import { rest2Rows, rest3Rows } from "./rows.js"
import type { Raw } from "./values.js"

/** A CRM object REST 3.0 serves as `crm.<type>.*`, and REST 2 as `crm.item.*` with its `entityTypeId`. */
export interface ItemType {
  type: "deal" | "lead" | "contact" | "company"
  entityTypeId: number
  /** What a person calls one, in a message: `deal`, `person`. */
  word: string
  select: readonly string[]
  /** The fields a list's free words are matched against. */
  words: readonly string[]
}

const REST3_PAGE = 1000

/** Newest first; REST 3.0 adds `id` itself for stable pages. */
const ORDER = { id: "DESC" }

/** One window of a live list: REST 3.0 by its filter, or REST 2 for a substring match, which REST 3.0 does not have. */
export const listedRows = (
  portal: BitrixCaller,
  type: ItemType,
  conditions: readonly Condition[],
  window: CrmWindow,
  select: readonly string[],
): Promise<CrmPage<Raw>> =>
  needsRest2(conditions)
    ? rest2Rows(
        portal,
        "crm.item.list",
        {
          entityTypeId: type.entityTypeId,
          select,
          filter: rest2Filter(conditions, { [type.words[0] ?? "title"]: type.words }),
          order: ORDER,
          useOriginalUfNames: "Y",
        },
        window,
      )
    : rest3Rows(
        portal,
        `crm.${type.type}.list`,
        { select, filter: rest3Filter(conditions), order: ORDER },
        REST3_PAGE,
        window,
      )
