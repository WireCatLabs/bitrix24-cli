import { foldCode, isRecord } from "./body.js"

/**
 * The keys Bitrix24 puts a file's download link under, folded as `foldCode` folds them: the "Types of Links in
 * Responses" table (apidocs files/how-to-download-files) and the generated document's own (apidocs
 * document-generator-document-get: `printUrlMachine`, `publicUrl`, a link that opens the document with no sign-in).
 * Every `…Machine` key is one too. An object with one of them is a file; a view link alone (`url`, `urlShow`) is not,
 * since a portal's link field holds `{ url, title }` the same way.
 */
const DOWNLOAD_KEYS = new Set(
  ["DOWNLOAD_URL", "downloadUrl", "fileUrl", "CALL_RECORD_URL", "archiveLink", "publicUrl"].map(foldCode),
)

const isDownloadKey = (key: string) => {
  const folded = foldCode(key)
  return DOWNLOAD_KEYS.has(folded) || folded.endsWith("machine")
}

/**
 * The paths a portal's tokened links take: REST (`/rest/…json?auth=`), the old `show_file.php?auth=`, and a webhook's
 * own `/rest/<user>/<code>/`, whose code is the webhook itself. A site the owner typed, `?token=promo` and all, is none.
 */
const WEBHOOK = /\/rest\/\d+\/[^/\s"'?#]+\//i
const PORTAL_PATH = /\/rest\/|show_file\.php/i
// `&amp;` too: a link copied out of HTML, as a comment or a mail body holds one.
const TOKEN_QUERY = /(?:[?&]|&amp;)(?:auth|token|access_token)=[^&#\s]/i

const isTokened = (value: unknown) =>
  typeof value === "string" && (WEBHOOK.test(value) || (PORTAL_PATH.test(value) && TOKEN_QUERY.test(value)))

export const REMOVED = "[link removed]"

/**
 * A custom field's value with every file in it as its id alone: the id is all a later download needs, and its links
 * may carry a token (RISK-2313). Decided by the value's shape, since a webhook without the rights to read field
 * definitions has no field types. A file with no id, and a portal link with a token in it, become `[link removed]`,
 * so the owner sees something was there.
 */
export const fileIdsOf = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(fileIdsOf)
  if (isTokened(value)) return REMOVED
  if (!isRecord(value)) return value
  if (Object.keys(value).some(isDownloadKey)) return value.id ?? value.ID ?? REMOVED
  return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, fileIdsOf(inner)]))
}

/** A link's path for a log or a run record: a webhook's code becomes `:token`, and the query is never part of it. */
export const loggedPath = (url: URL): string => url.pathname.replace(/^\/rest\/(\d+)\/[^/]+\//i, "/rest/:user/:token/")
