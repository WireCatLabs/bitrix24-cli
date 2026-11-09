import { parseWebhook, type Webhook } from "../bitrix/webhook.js"

/** Fake, and spelled so the gitleaks rule for webhook addresses lets it through. */
export const FAKE_SECRET = "wirecatfake0secret42"
export const FAKE_HOOK = `https://example.bitrix24.test/rest/7/${FAKE_SECRET}/`
export const FAKE_WEBHOOK: Webhook = parseWebhook(FAKE_HOOK)

export interface PortalCall {
  api: 2 | 3
  method: string
  body: Record<string, unknown>
  /** The body as sent, for numbers `JSON.parse` would round. */
  text: string
  headers: Record<string, string>
  url: string
}

/** apidocs.bitrix24.com/api-reference/crm/outdated/products/crm-product-fields.html */
const PRODUCT_FIELDS = new Set(
  "ID CATALOG_ID PRICE CURRENCY_ID NAME CODE DESCRIPTION DESCRIPTION_TYPE ACTIVE SECTION_ID SORT VAT_ID VAT_INCLUDED MEASURE XML_ID PREVIEW_PICTURE DETAIL_PICTURE DATE_CREATE TIMESTAMP_X MODIFIED_BY CREATED_BY".split(
    " ",
  ),
)
/** apidocs.bitrix24.com/api-reference/user/user-fields.html, and the filters user-get.html adds. */
const USER_FIELDS = new Set(
  "ID XML_ID ACTIVE NAME LAST_NAME SECOND_NAME TITLE EMAIL LAST_LOGIN DATE_REGISTER TIME_ZONE IS_ONLINE TIMESTAMP_X LAST_ACTIVITY_DATE PERSONAL_GENDER PERSONAL_PROFESSION PERSONAL_WWW PERSONAL_BIRTHDAY PERSONAL_PHOTO PERSONAL_PHONE PERSONAL_MOBILE PERSONAL_CITY PERSONAL_COUNTRY WORK_PHONE WORK_COMPANY WORK_POSITION WORK_DEPARTMENT UF_EMPLOYMENT_DATE UF_DEPARTMENT UF_PHONE_INNER USER_TYPE NAME_SEARCH".split(
    " ",
  ),
)
/** REST 2 filter keys carry their comparison in front (apidocs user-get.html). */
const PREFIX = /^(>=|<=|!=%|!%=|!@|!%|=%|%=|!=|>|<|@|%|=|!)/

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
const namesOf = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.map(String)
    : isObject(value)
      ? Object.keys(value).map((key) => key.replace(PREFIX, ""))
      : []

/**
 * REST 2 skips a name it does not know without an error (apidocs user-get.html), so a misspelt field would read as
 * nothing at all; the fake fails the test instead of answering.
 */
const DOCUMENTED: Record<string, (body: Record<string, unknown>) => string[]> = {
  "crm.product.list": ({ select, filter, order }) =>
    [...namesOf(select), ...namesOf(filter), ...namesOf(order)].filter((name) => !PRODUCT_FIELDS.has(name)),
  "crm.product.get": (body) => Object.keys(body).filter((name) => name !== "id"),
  "user.get": ({ FILTER, sort }) =>
    [...namesOf(FILTER), ...(sort === undefined ? [] : [String(sort)])].filter((name) => !USER_FIELDS.has(name)),
}

export type Reply = { status?: number; body?: unknown; text?: string; headers?: Record<string, string> } | Error

/**
 * A portal that answers each method from a script, shaped as the API reference shows (apidocs.bitrix24.com); a
 * method with no script answers ERROR_METHOD_NOT_FOUND. Never real portal data.
 */
export const fakePortal = (script: Record<string, Reply | Reply[] | ((call: PortalCall) => Reply)> = {}) => {
  const calls: PortalCall[] = []
  const fetch = async (url: string, init: RequestInit): Promise<Response> => {
    const path = new URL(url).pathname
    const api = path.startsWith("/rest/api/") ? 3 : 2
    const method = path.slice(path.lastIndexOf("/") + 1)
    const call: PortalCall = {
      api,
      method,
      url,
      body: JSON.parse(String(init.body ?? "{}")) as Record<string, unknown>,
      text: String(init.body ?? ""),
      headers: init.headers as Record<string, string>,
    }
    // Every contact and company read asks whether the user is an administrator first; a test that scripts no answer
    // reads as one, and that question stays out of `calls`, which then hold only what the test scripted.
    if (method === "user.admin" && !(method in script))
      return new Response(JSON.stringify({ result: true }), { headers: { "content-type": "application/json" } })
    calls.push(call)
    const undocumented = DOCUMENTED[method]?.(call.body) ?? []
    if (undocumented.length) throw new Error(`fake portal: ${method} has no ${undocumented.join(", ")} in its docs`)
    const entry = script[method]
    const reply: Reply =
      typeof entry === "function"
        ? entry(call)
        : Array.isArray(entry)
          ? (entry.shift() ?? { status: 500, body: { error: "EXHAUSTED" } })
          : (entry ?? methodNotFound(api, method))
    if (reply instanceof Error) throw reply
    return new Response(reply.text ?? JSON.stringify(reply.body ?? {}), {
      status: reply.status ?? 200,
      headers: { "content-type": "application/json", ...reply.headers },
    })
  }
  return { fetch, calls }
}

export const ok = (result: unknown, extra: Record<string, unknown> = {}): Reply => ({
  body: { result, ...extra, time: { start: 0, finish: 0, duration: 0 } },
})

/** Each API's answer to a method it does not have (apidocs error-codes; REST 3.0 method pages: HTTP 404). */
export const methodNotFound = (api: 2 | 3, method: string): Reply =>
  api === 3
    ? {
        status: 404,
        body: {
          error: {
            code: "BITRIX_REST_V3_EXCEPTION_METHODNOTFOUNDEXCEPTION",
            message: `Method "${method}" was not found.`,
          },
        },
      }
    : { status: 404, body: { error: "ERROR_METHOD_NOT_FOUND", error_description: "Method not found!" } }
