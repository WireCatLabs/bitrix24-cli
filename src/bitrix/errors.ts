import { CliError, type CliErrorDetails, type ErrorCode } from "@wirecat/cli-base"
import { retryableStatus, statusToCode } from "@wirecat/cli-base/http"
import { isRecord } from "../body.js"
import { scopeOf } from "./methods.js"

/*
 * The codes below are documented at https://apidocs.bitrix24.com/error-codes.html (REST 2 and the system errors),
 * https://apidocs.bitrix24.com/settings/oauth/error-codes.html (sign-in), https://apidocs.bitrix24.com/limits.html (the
 * request limits) and https://apidocs.bitrix24.com/api-reference/rest-v3.html (REST 3.0's exceptions).
 */

/** The 503 refusal of a portal over its 2 requests a second (apidocs "REST API limits"). */
const QUERY_LIMIT_WAIT_MS = 1_000
/** A 429 without `operating_reset_at`: the operating limit is counted over ten one-minute baskets. */
const OPERATING_WAIT_MS = 60_000

const SIGN_IN = new Set(["NO_AUTH_FOUND", "INVALID_CREDENTIALS", "EXPIRED_TOKEN", "INVALID_TOKEN"])
const SCOPE = new Set(["INSUFFICIENT_SCOPE", "BITRIX_REST_V3_EXCEPTION_INSUFFICIENTSCOPEEXCEPTION"])
const DENIED = new Set(["ACCESS_DENIED", "USER_ACCESS_ERROR", "BITRIX_REST_V3_EXCEPTION_ACCESSDENIEDEXCEPTION"])
const NOT_FOUND = new Set(["NOT_FOUND", "BITRIX_REST_V3_EXCEPTION_ENTITYNOTFOUNDEXCEPTION"])

const CODE = /^[A-Za-z0-9_]{1,128}$/

const fieldOf = (value: unknown, key: string): unknown => (isRecord(value) ? value[key] : undefined)

/**
 * Only a code-shaped name: a description can quote a field's value, which is somebody's data (WC-SECR-6). REST 2
 * answers `{ error, error_description }`, where `error` may be empty; REST 3.0 `{ error: { code, message, validation } }`.
 */
const codeOf = (body: unknown): string | undefined => {
  const error = fieldOf(body, "error")
  const raw = isRecord(error) ? error.code : error
  if (typeof raw === "string" && CODE.test(raw)) return raw.toUpperCase()
  // REST 2 answers a missing record with an empty code and "Not found".
  const description = fieldOf(body, "error_description")
  if (raw === "" && typeof description === "string" && /^not found$/i.test(description.trim())) return "NOT_FOUND"
  return undefined
}

const fieldsOf = (body: unknown): string[] => {
  const validation = fieldOf(fieldOf(body, "error"), "validation")
  if (!Array.isArray(validation)) return []
  return validation
    .map((one) => fieldOf(one, "field"))
    .filter((field): field is string => typeof field === "string" && CODE.test(field.replace(/\./g, "_")))
}

const operatingWaitMs = (body: unknown, now: number) => {
  const reset = Number(fieldOf(fieldOf(body, "time"), "operating_reset_at"))
  return Number.isFinite(reset) && reset * 1000 > now ? reset * 1000 - now : OPERATING_WAIT_MS
}

/**
 * Bitrix24's refusal as one of the stable codes a script branches on. The message names the method and Bitrix24's
 * code, never its description.
 */
export const bitrixError = (
  method: string,
  status: number,
  body: unknown,
  { now = Date.now(), waitMs }: { now?: number; waitMs?: number | undefined } = {},
): CliError => {
  const code = codeOf(body)
  const details: CliErrorDetails = { operation: method, status, ...(code ? { provider_error: code } : {}) }
  const named = code ? ` (${code})` : ""
  const as = (errorCode: ErrorCode, message: string, more: CliErrorDetails = {}) =>
    new CliError(errorCode, message, { ...details, ...more })

  if (code === "QUERY_LIMIT_EXCEEDED")
    return as("rate_limited", `Bitrix24 asks to slow down before ${method}: the portal's request limit is reached`, {
      retry_after_ms: waitMs ?? QUERY_LIMIT_WAIT_MS,
      retryable: true,
    })
  if (code === "OPERATION_TIME_LIMIT")
    return as("rate_limited", `Bitrix24 holds ${method} for a while: this webhook used up its time on that method`, {
      retry_after_ms: waitMs ?? operatingWaitMs(body, now),
      retryable: true,
    })
  if (code && SCOPE.has(code)) {
    const scope = scopeOf(method)
    const known = scope !== "unknown"
    return as(
      "permission_error",
      `this webhook has no ${known ? `${scope} ` : ""}scope for ${method}${named}; add it in Bitrix24`,
      { reason: "webhook.scope-missing", ...(known ? { scope } : {}) },
    )
  }
  // A method only an installed app may call (https://apidocs.bitrix24.com/api-reference/events/events.html).
  if (code === "WRONG_AUTH_TYPE")
    return as("permission_error", `Bitrix24 lets only an installed app call ${method}, not a webhook${named}`, {
      reason: "webhook.app-only",
    })
  if (code === "PORTAL_DELETED") return as("authentication_error", "this Bitrix24 portal was deleted")
  if ((code && DENIED.has(code)) || status === 403)
    return as("permission_error", `the webhook's user may not do ${method}${named}`, { reason: "bitrix.access-denied" })
  if ((code && SIGN_IN.has(code)) || status === 401)
    return as(
      "authentication_error",
      `Bitrix24 refused this webhook or application sign-in${named}; sign in again with \`b24 <profile> session start\``,
      { reason: "webhook.refused" },
    )
  if (code === "ERROR_METHOD_NOT_FOUND" || code === "BITRIX_REST_V3_EXCEPTION_METHODNOTFOUNDEXCEPTION")
    return as("not_found", `Bitrix24 does not know ${method}, or the webhook has no scope for it${named}`, {
      reason: "method.unknown",
    })
  if (code && NOT_FOUND.has(code)) return as("not_found", `${method}: Bitrix24 has no such record${named}`)
  if (code === "BITRIX_REST_V3_EXCEPTION_IDEMPOTENCYKEYREUSEDEXCEPTION")
    return as(
      "conflict",
      `${method}: Bitrix24 refused this write's operation id as already used for a different request`,
      { reason: "operation.reused" },
    )
  const fields = fieldsOf(body)
  if (status === 400 || code?.startsWith("BITRIX_REST_V3_EXCEPTION_"))
    return as(
      "validation_error",
      `Bitrix24 refused ${method}${named}${fields.length ? `; check ${fields.join(", ")}` : ""}`,
      fields.length ? { fields } : {},
    )
  if (status >= 500)
    return as("provider_unavailable", `Bitrix24 failed on ${method}${named}`, { retryable: retryableStatus(status) })
  return as(status >= 400 ? statusToCode(status) : "provider_error", `Bitrix24 refused ${method}${named}`)
}
