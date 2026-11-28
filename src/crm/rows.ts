import { type CrmPage, type CrmWindow, crmValues, walk } from "@wirecat/cli-core"
import type { BitrixCaller } from "../bitrix/transport.js"
import type { Raw } from "./values.js"

/** Every row: core's `walk` reads on while the portal says more come. */
export const EVERY: CrmWindow = { offset: 0, limit: Number.POSITIVE_INFINITY }

/** A list's rows: REST 2 gives them as the result, REST 3.0 and `crm.item.list` under `items`. */
export const rowsOf = (result: unknown): Raw[] =>
  Array.isArray(result) ? crmValues.rawsOf(result) : crmValues.rawsOf(crmValues.fieldOf(result, "items"))

/** A REST 2 list: pages of 50, `start` the rows before, `next` while more come (apidocs list methods). */
export const rest2Rows = (
  portal: BitrixCaller,
  method: string,
  params: Record<string, unknown>,
  window: CrmWindow = EVERY,
): Promise<CrmPage<Raw>> =>
  walk(window, 50, async (start) => {
    const answer = await portal.call(method, { ...params, start })
    return { rows: rowsOf(answer.result), more: answer.next !== undefined }
  })

/** A REST 3.0 list by offset; it gives no total, so a short page is the last (apidocs crm.<type>.list). */
export const rest3Rows = (
  portal: BitrixCaller,
  method: string,
  params: Record<string, unknown>,
  largest: number,
  window: CrmWindow = EVERY,
): Promise<CrmPage<Raw>> =>
  walk(window, largest, async (offset, limit) => {
    const rows = rowsOf((await portal.call(method, { ...params, pagination: { limit, offset } })).result)
    return { rows, more: rows.length === limit }
  })
