import type { CrmCallContext, CrmPage } from "@wirecat/cli-core/crm"
import type { BitrixCaller } from "../bitrix/transport.js"
import { LEAD_PIPELINE } from "./lead.js"
import { epoch, fieldOf, id, portalTime, type Raw, rawsOf } from "./values.js"

/** Until cli-core exports it: the shape of `CrmStageEntry`. */
export interface StageEntry {
  externalId: string
  kind: "deal" | "lead"
  item: string
  pipeline: string
  stage: string
  at: number
}

/** A list page of `crm.stagehistory.list` (apidocs: 50 rows). */
const PAGE = 50

/** `TYPE_ID` (apidocs crm.stagehistory.list): 2 an intermediate stage, 3 a final one, 5 another pipeline; 1, creation, is no entry. */
const ENTRIES = new Set(["2", "3", "5"])

const entryOf =
  (kind: "deal" | "lead") =>
  (raw: Raw): StageEntry | null => {
    const externalId = id(raw.ID)
    const item = id(raw.OWNER_ID)
    // Leads name their stage `STATUS_ID` and have one list of stages; a deal's pipeline is its category.
    const stage = kind === "lead" ? raw.STATUS_ID : raw.STAGE_ID
    const at = epoch(raw.CREATED_TIME)
    if (!externalId || !item || typeof stage !== "string" || !stage || at === null) return null
    if (!ENTRIES.has(String(raw.TYPE_ID))) return null
    return {
      externalId,
      kind,
      item,
      pipeline: kind === "lead" ? LEAD_PIPELINE.externalId : (id(raw.CATEGORY_ID) ?? "0"),
      stage,
      at,
    }
  }

/**
 * The portal's record of each deal or lead entering a stage, oldest first: after the row `after`, or from `since`
 * without it. Read across the portal: core keeps the entries on the deals and leads it holds, and a day of moves is a
 * page or two, where asking by the copy's own deals would cost a request per fifty of them on every sync.
 */
export const readStageHistory = async (
  caller: BitrixCaller,
  kind: "deal" | "lead",
  since: number,
  after: string | undefined,
  _context?: CrmCallContext,
): Promise<CrmPage<StageEntry>> => {
  const answer = await caller.call("crm.stagehistory.list", {
    entityTypeId: kind === "lead" ? 1 : 2,
    order: { ID: "ASC" },
    filter: after === undefined ? { ">=CREATED_TIME": portalTime(since) } : { ">ID": Number(after) },
    select: ["ID", "TYPE_ID", "OWNER_ID", "CREATED_TIME", kind === "lead" ? "STATUS_ID" : "STAGE_ID", "CATEGORY_ID"],
    start: 0,
  })
  const rows = rawsOf(fieldOf(answer.result, "items"))
  const items = rows.map(entryOf(kind)).filter((one): one is StageEntry => one !== null)
  const last = id(rows.at(-1)?.ID) ?? after
  if (rows.length === PAGE && last) return { items, hasMore: true, nextCursor: last }
  return last ? { items, hasMore: false, cursor: last } : { items, hasMore: false }
}
