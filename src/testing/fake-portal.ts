import { parseWebhook, type Webhook } from "../bitrix/webhook.js"

/** Fake, and spelled so the gitleaks rule for webhook addresses lets it through. */
export const FAKE_SECRET = "wirecatfake0secret42"
export const FAKE_HOOK = `https://example.bitrix24.test/rest/7/${FAKE_SECRET}/`
export const FAKE_WEBHOOK: Webhook = parseWebhook(FAKE_HOOK)

export interface PortalCall {
  api: 2 | 3
  method: string
  body: Record<string, unknown>
  headers: Record<string, string>
  url: string
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
      headers: init.headers as Record<string, string>,
    }
    calls.push(call)
    const entry = script[method]
    const reply: Reply =
      typeof entry === "function"
        ? entry(call)
        : Array.isArray(entry)
          ? (entry.shift() ?? { status: 500, body: { error: "EXHAUSTED" } })
          : (entry ?? {
              status: 404,
              body: { error: "ERROR_METHOD_NOT_FOUND", error_description: "Method not found!" },
            })
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
