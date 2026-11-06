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
