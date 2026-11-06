import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { CliError } from "@wirecat/cli-base"
import type { RequestEvent } from "@wirecat/cli-core/cli"
import { Pacer } from "@wirecat/cli-core/sends"
import { describe, expect, it } from "vitest"
import { FAKE_HOOK, FAKE_SECRET, FAKE_WEBHOOK, fakePortal, ok } from "../testing/fake-portal.js"
import { bitrixError } from "./errors.js"
import { KNOWN_METHODS, methodOf } from "./methods.js"
import { BitrixTransport } from "./transport.js"
import { parseWebhook } from "./webhook.js"

const transportOf = (
  portal: ReturnType<typeof fakePortal>,
  extra: Partial<ConstructorParameters<typeof BitrixTransport>[0]> = {},
) => {
  const waits: number[] = []
  const transport = new BitrixTransport({
    webhook: FAKE_WEBHOOK,
    fetch: portal.fetch,
    sleep: async (ms) => {
      waits.push(ms)
    },
    random: () => 0,
    ...extra,
  })
  return { transport, waits }
}

const failureOf = async (promise: Promise<unknown>): Promise<CliError> => {
  try {
    await promise
  } catch (error) {
    if (error instanceof CliError) return error
    throw error
  }
  throw new Error("expected a failure")
}

const leaks = (error: CliError) =>
  JSON.stringify({ message: error.message, details: error.details }).includes(FAKE_SECRET)

describe("parseWebhook", () => {
  it("takes the address as Bitrix24 shows it, with a method or the api segment pasted after it", () => {
    for (const raw of [FAKE_HOOK, `${FAKE_HOOK}user.current.json`, FAKE_HOOK.replace("/rest/", "/rest/api/")])
      expect(parseWebhook(raw)).toEqual({ origin: "https://example.bitrix24.test", userId: "7", secret: FAKE_SECRET })
  })

  it("refuses anything else without quoting it", () => {
    for (const raw of [
      "not a url",
      FAKE_HOOK.replace("https", "http"),
      "https://example.test/rest/x/y/",
      `${FAKE_HOOK}?a=1`,
    ]) {
      const error = (() => {
        try {
          parseWebhook(raw)
        } catch (thrown) {
          return thrown as CliError
        }
        throw new Error("parsed")
      })()
      expect(error.code).toBe("validation_error")
      expect(leaks(error)).toBe(false)
    }
  })
})

describe("methodOf", () => {
  it("sends CRM objects to REST 3.0 and the rest to REST 2", () => {
    expect(methodOf("crm.deal.list")).toMatchObject({ api: 3, effect: "read", scope: "crm" })
    expect(methodOf("crm.contact.delete")).toMatchObject({ api: 3, effect: "destructive" })
    expect(methodOf("crm.lead.update")).toMatchObject({ api: 3, effect: "write" })
    expect(methodOf("crm.status.list")).toMatchObject({ api: 2, effect: "read" })
    expect(methodOf("crm.deal.userfield.list")).toMatchObject({ api: 2, effect: "read" })
    expect(methodOf("crm.deal.field.list")).toMatchObject({ api: 3, effect: "read" })
    expect(methodOf("user.current")).toMatchObject({ api: 2, effect: "read", scope: "user" })
    expect(methodOf("profile")).toMatchObject({ api: 2, scope: "basic" })
    expect(KNOWN_METHODS.length).toBeGreaterThan(20)
  })
})

describe("BitrixTransport", () => {
  it("posts JSON to the REST version the method lives on and records no secret", async () => {
    const portal = fakePortal({ "crm.deal.list": ok({ items: [] }), "user.current": ok({ ID: "7" }) })
    const events: RequestEvent[] = []
    const { transport } = transportOf(portal, { events: (event) => events.push(event as RequestEvent) })
    expect(await transport.call("crm.deal.list", { select: ["id"] })).toEqual({ result: { items: [] } })
    await transport.call("user.current")
    expect(portal.calls.map(({ api, method }) => [api, method])).toEqual([
      [3, "crm.deal.list"],
      [2, "user.current"],
    ])
    expect(portal.calls[0]?.body).toEqual({ select: ["id"] })
    expect(JSON.stringify(events)).not.toContain(FAKE_SECRET)
    expect(JSON.stringify(events)).toContain("/rest/api/:user/:token/crm.deal.list")
  })

  it("keeps REST 2's total and next", async () => {
    const portal = fakePortal({ "user.get": ok([{ ID: "1" }], { total: 120, next: 50 }) })
    expect(await transportOf(portal).transport.call("user.get")).toEqual({
      result: [{ ID: "1" }],
      total: 120,
      next: 50,
    })
  })

  it("sends the operation id as Idempotency-Key on a REST 3.0 write only", async () => {
    const portal = fakePortal({ "crm.contact.add": ok({ id: 5 }), "crm.status.list": ok([]) })
    const { transport } = transportOf(portal)
    await transport.call("crm.contact.add", { fields: { name: "WireCat test" } }, { idempotencyKey: "op-1" })
    await transport.call("crm.status.list", {}, { idempotencyKey: "op-2" })
    expect(portal.calls[0]?.headers["Idempotency-Key"]).toBe("op-1")
    expect(portal.calls[1]?.headers["Idempotency-Key"]).toBeUndefined()
  })

  it("waits out the portal's 503 rate refusal on a read, then goes on", async () => {
    const portal = fakePortal({
      "crm.deal.get": [
        { status: 503, body: { error: "QUERY_LIMIT_EXCEEDED", error_description: "Too many requests" } },
        ok({ item: { id: 1 } }),
      ],
    })
    const { transport, waits } = transportOf(portal)
    expect(await transport.call("crm.deal.get", { id: 1 })).toEqual({ result: { item: { id: 1 } } })
    expect(waits).toEqual([1000])
  })

  it("never repeats a write without a key, and calls a lost answer outcome_unknown", async () => {
    const portal = fakePortal({ "crm.status.add": new TypeError(`fetch failed for ${FAKE_HOOK}`) })
    const error = await failureOf(transportOf(portal).transport.call("crm.status.add", {}))
    expect(error.code).toBe("outcome_unknown")
    expect(portal.calls).toHaveLength(1)
    expect(leaks(error)).toBe(false)
  })

  it("sends a keyed REST 3.0 write once, and a lost answer is outcome_unknown", async () => {
    const portal = fakePortal({ "crm.deal.update": new TypeError("socket hang up") })
    const error = await failureOf(
      transportOf(portal).transport.call("crm.deal.update", { id: 1, fields: {} }, { idempotencyKey: "op-9" }),
    )
    expect(error.code).toBe("outcome_unknown")
    expect(error.details.retryable).toBe(false)
    expect(error.message).not.toContain("check before repeating")
    expect(portal.calls).toHaveLength(1)
    expect(portal.calls[0]?.headers["Idempotency-Key"]).toBe("op-9")
  })

  it("does not repeat a keyed write on a 429", async () => {
    const portal = fakePortal({
      "crm.deal.add": { status: 429, body: { error: "QUERY_LIMIT_EXCEEDED", error_description: "Too many requests" } },
    })
    const error = await failureOf(transportOf(portal).transport.call("crm.deal.add", {}, { idempotencyKey: "op-1" }))
    expect(error.code).toBe("rate_limited")
    expect(portal.calls).toHaveLength(1)
  })

  it("does not repeat a write without a key on a 429", async () => {
    const portal = fakePortal({
      "crm.status.update": {
        status: 429,
        body: { error: "OPERATION_TIME_LIMIT", error_description: "Method is blocked" },
      },
    })
    const error = await failureOf(transportOf(portal).transport.call("crm.status.update", {}))
    expect(error.code).toBe("rate_limited")
    expect(portal.calls).toHaveLength(1)
  })

  it("keeps the secret out of a refusal that quotes it", async () => {
    const portal = fakePortal({
      "user.current": { status: 401, body: { error: "INVALID_CREDENTIALS", error_description: `bad ${FAKE_HOOK}` } },
    })
    const error = await failureOf(transportOf(portal).transport.call("user.current"))
    expect(error.code).toBe("authentication_error")
    expect(leaks(error)).toBe(false)
  })

  it("names a body that is not JSON", async () => {
    const portal = fakePortal({ "user.current": { text: "<html>" }, "user.get": { status: 502, text: "<html>" } })
    const { transport } = transportOf(portal, { timeoutMs: 1000 })
    expect((await failureOf(transport.call("user.current"))).code).toBe("invalid_response")
    expect((await failureOf(transport.call("user.get"))).code).toBe("provider_unavailable")
  })

  it("stops on cancel without asking again", async () => {
    const stop = new AbortController()
    stop.abort()
    const portal = fakePortal({ "user.current": new DOMException("aborted", "AbortError") })
    const error = await failureOf(transportOf(portal, { signal: stop.signal }).transport.call("user.current"))
    expect(error.code).toBe("cancelled")
  })

  it("times out a read that never answers and tries it again", async () => {
    const portal = fakePortal({ "user.current": new DOMException("timed out", "TimeoutError") })
    const error = await failureOf(transportOf(portal).transport.call("user.current"))
    expect(error.code).toBe("timeout")
    expect(portal.calls).toHaveLength(4)
  })

  it("keeps the profile's pace across calls through the shared pacer", async () => {
    const now = 1_000_000
    const pacer = new Pacer(
      join(mkdtempSync(join(tmpdir(), "pace-")), "pace.json"),
      { perMinute: 120, burst: 1 },
      () => now,
    )
    const portal = fakePortal({ "user.current": () => ok({ ID: "7" }) })
    const { transport, waits } = transportOf(portal, { pacer, now: () => now })
    await transport.call("user.current")
    await transport.call("user.current")
    await transport.call("user.current")
    expect(waits).toEqual([500])
  })
})

describe("bitrixError", () => {
  const code = (status: number, body: unknown) => bitrixError("m", status, body as never)

  it("maps Bitrix24's refusals to stable codes", () => {
    expect(code(429, { error: "OPERATION_TIME_LIMIT", time: { operating_reset_at: 1030 } })).toMatchObject({
      code: "rate_limited",
    })
    expect(
      bitrixError("m", 429, { error: "OPERATION_TIME_LIMIT", time: { operating_reset_at: 1030 } }, { now: 1_000_000 })
        .details.retry_after_ms,
    ).toBe(30_000)
    expect(code(401, { error: "insufficient_scope" }).code).toBe("permission_error")
    expect(code(403, { error: { code: "BITRIX_REST_V3_EXCEPTION_ACCESSDENIEDEXCEPTION", message: "x" } }).code).toBe(
      "permission_error",
    )
    expect(code(401, { error: "ACCESS_DENIED" }).code).toBe("permission_error")
    expect(code(401, { error: "NO_AUTH_FOUND" }).code).toBe("authentication_error")
    expect(code(401, { error: "expired_token" }).code).toBe("authentication_error")
    expect(code(403, { error: "PORTAL_DELETED" }).code).toBe("authentication_error")
    expect(code(404, { error: "ERROR_METHOD_NOT_FOUND" }).details.reason).toBe("method.unknown")
    expect(code(400, { error: "", error_description: "Not found" }).code).toBe("not_found")
    expect(code(400, { error: { code: "BITRIX_REST_V3_EXCEPTION_ENTITYNOTFOUNDEXCEPTION" } }).code).toBe("not_found")
    expect(code(422, { error: { code: "BITRIX_REST_V3_EXCEPTION_IDEMPOTENCYKEYREUSEDEXCEPTION" } }).code).toBe(
      "conflict",
    )
    expect(code(500, { error: "INTERNAL_SERVER_ERROR" }).code).toBe("provider_unavailable")
    expect(code(409, { error: "SOMETHING" }).code).toBe("provider_error")
    expect(code(200, { error: "SOMETHING_ELSE" }).code).toBe("provider_error")
  })

  it("names the fields a validation refused, never their values", () => {
    const error = code(400, {
      error: {
        code: "BITRIX_REST_V3_EXCEPTION_VALIDATION_REQUESTVALIDATIONEXCEPTION",
        message: "Ivan Petrov is not valid",
        validation: [{ field: "fields.name", message: "Ivan Petrov" }],
      },
    })
    expect(error.code).toBe("validation_error")
    expect(error.details.fields).toEqual(["fields.name"])
    expect(error.message).not.toContain("Ivan")
  })
})
