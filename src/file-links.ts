import { foldCode, isRecord } from "./body.js"

/**
 * The keys Bitrix24 puts a file's links under (apidocs files/how-to-download-files, "Types of Links in Responses"),
 * folded as `foldCode` folds them. `url`, `showUrl` and `urlShow` need a signed-in browser, but sit beside the download
 * link in the same file object, which is how a file value is told apart from any other object.
 */
const DOWNLOAD_KEYS = new Set(
  [
    "urlMachine",
    "DOWNLOAD_URL",
    "downloadMachine",
    "downloadUrlMachine",
    "pdfUrlMachine",
    "imageUrlMachine",
    "downloadUrl",
    "fileUrl",
    "CALL_RECORD_URL",
    "archiveLink",
  ].map(foldCode),
)
const VIEW_KEYS = new Set(["url", "showUrl", "urlShow", "urlDownload", "DETAIL_URL"].map(foldCode))

/** A link that carries the webhook's or the application's access in its query: anyone holding it gets the file. */
const TOKENED = /[?&](auth|token|access_token)=[^&#\s]/i

export const REMOVED = "[link removed]"

const isTokened = (value: unknown) => typeof value === "string" && TOKENED.test(value)

const isFile = (value: Record<string, unknown>) =>
  Object.keys(value).some((key) => DOWNLOAD_KEYS.has(foldCode(key)) || VIEW_KEYS.has(foldCode(key)))

/**
 * A custom field's value with every file in it as its id alone: the id is all a later download needs, and the links may
 * carry a token (RISK-2313). Decided by the value's shape, since a webhook without the rights to read field definitions
 * has no field types. A file with no id, or a string holding a tokened link, is left out; `undefined` when nothing is left.
 */
export const fileIdsOf = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    const kept = value.map(fileIdsOf).filter((one) => one !== undefined)
    return value.length && !kept.length ? undefined : kept
  }
  if (isTokened(value)) return undefined
  if (!isRecord(value)) return value
  if (isFile(value)) return value.id ?? value.ID ?? undefined
  const kept = Object.entries(value).flatMap(([key, inner]) => {
    const one = fileIdsOf(inner)
    return one === undefined ? [] : [[key, one] as const]
  })
  return Object.fromEntries(kept)
}

/**
 * An answer with every download link and every tokened link replaced by `[link removed]`, the rest as the portal gave
 * it: `api call` prints what an agent may read, and the link alone would hand it the file.
 */
export const withoutFileLinks = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(withoutFileLinks)
  if (isTokened(value)) return REMOVED
  if (!isRecord(value)) return value
  return Object.fromEntries(
    Object.entries(value).map(([key, inner]) => [
      key,
      DOWNLOAD_KEYS.has(foldCode(key)) && inner !== null && inner !== "" ? REMOVED : withoutFileLinks(inner),
    ]),
  )
}
