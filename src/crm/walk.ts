import type { BitrixCaller } from "../bitrix/transport.js"
import { fieldOf, type Raw, rawsOf } from "./values.js"

/** One page as the portal gave it, and whether it said more come after. */
export interface Rows<T> {
  rows: T[]
  more: boolean
}

export interface Window {
  offset: number
  /** Absent under `--all`: every row, page by page. */
  limit?: number
}

/**
 * The rows of one answer page, read from the portal in its own page sizes: one more than asked, so `has_more` is
 * known without a total, which REST 3.0 does not give.
 */
export const walk = async <T>(
  window: Window,
  largest: number,
  fetchPage: (offset: number, size: number) => Promise<Rows<T>>,
): Promise<{ items: T[]; has_more: boolean }> => {
  const want = window.limit === undefined ? Number.POSITIVE_INFINITY : window.limit + 1
  const rows: T[] = []
  let at = window.offset
  while (rows.length < want) {
    const size = Math.min(largest, want - rows.length)
    const page = await fetchPage(at, size)
    for (const row of page.rows) rows.push(row)
    at += page.rows.length
    if (!page.more || page.rows.length === 0) break
  }
  if (window.limit === undefined) return { items: rows, has_more: false }
  return { items: rows.slice(0, window.limit), has_more: rows.length > window.limit }
}

/** A list's rows: REST 2 gives them as the result, REST 3.0 and `crm.item.list` under `items`. */
export const rowsOf = (result: unknown): Raw[] => {
  return Array.isArray(result) ? rawsOf(result) : rawsOf(fieldOf(result, "items"))
}

/** A REST 2 list: pages of 50, `start` the rows before, `next` while more come (apidocs list methods). */
export const rest2Rows = (
  portal: BitrixCaller,
  method: string,
  params: Record<string, unknown>,
  window: Window = { offset: 0 },
) =>
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
  window: Window = { offset: 0 },
) =>
  walk(window, largest, async (offset, limit) => {
    const rows = rowsOf((await portal.call(method, { ...params, pagination: { limit, offset } })).result)
    return { rows, more: rows.length === limit }
  })
