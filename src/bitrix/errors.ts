import { CliError, type CliErrorDetails, type ErrorCode } from "@wirecat/cli-base"
import { retryableStatus, statusToCode } from "@wirecat/cli-base/http"
import { scopeOf } from "./methods.js"

/** The 503 refusal of a portal over its 2 requests a second (apidocs "REST API limits"). */
const QUERY_LIMIT_WAIT_MS = 1_000
/** A 429 without `operating_reset_at`: the operating limit is counted over ten one-minute baskets. */
const OPERATING_WAIT_MS = 60_000

const SIGN_IN = new Set(["NO_AUTH_FOUND", "INVALID_CREDENTIALS", "EXPIRED_TOKEN", "INVALID_TOKEN", "WRONG_AUTH_TYPE"])
const SCOPE = new Set(["INSUFFICIENT_SCOPE", "BITRIX_REST_V3_EXCEPTION_INSUFFICIENTSCOPEEXCEPTION"])
const DENIED = new Set(["ACCESS_DENIED", "USER_ACCESS_ERROR", "BITRIX_REST_V3_EXCEPTION_ACCESSDENIEDEXCEPTION"])
const NOT_FOUND = new Set(["NOT_FOUND", "BITRIX_REST_V3_EXCEPTION_ENTITYNOTFOUNDEXCEPTION"])

/** REST 2: `{ error, error_description }`, where `error` may be empty; REST 3.0: `{ error: { code, message, validation } }`. */
export interface BitrixFailure {
  error?: string | { code?: unknown; message?: unknown; validation?: unknown }
  error_description?: unknown
  time?: { operating_reset_at?: unknown }
}

const CODE = /^[A-Za-z0-9_]{1,128}$/

/** Only a code-shaped name: a description can quote a field's value, which is somebody's data (WC-SECR-6). */
const codeOf = (body: BitrixFailure | undefined): string | undefined => {
  const raw = typeof body?.error === "object" && body.error !== null ? body.error.code : body?.error
  if (typeof raw === "string" && CODE.test(raw)) return raw.toUpperCase()
  // REST 2 answers a missing record with an empty code and "Not found".
  if (raw === "" && typeof body?.error_description === "string" && /^not found$/i.test(body.error_description.trim()))
    return "NOT_FOUND"
  return undefined
}

const fieldsOf = (body: BitrixFailure | undefined): string[] => {
  const validation = typeof body?.error === "object" && body.error !== null ? body.error.validation : undefined
  if (!Array.isArray(validation)) return []
  return validation
    .map((one) => (one as { field?: unknown })?.field)
    .filter((field): field is string => typeof field === "string" && CODE.test(field.replace(/\./g, "_")))
}

const operatingWaitMs = (body: BitrixFailure | undefined, now: number) => {
  const reset = Number(body?.time?.operating_reset_at)
  return Number.isFinite(reset) && reset * 1000 > now ? reset * 1000 - now : OPERATING_WAIT_MS
}

/**
 * Bitrix24's refusal as one of the stable codes a script branches on. The message names the method and Bitrix24's
 * code, never its description.
 */
export const bitrixError = (
  method: string,
  status: number,
  body: BitrixFailure | undefined,
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
  if (code && SCOPE.has(code))
    return as(
      "permission_error",
      `this webhook has no ${scopeOf(method)} scope for ${method}${named}; add it in Bitrix24`,
      {
        reason: "webhook.scope-missing",
        scope: scopeOf(method),
      },
    )
  if (code === "PORTAL_DELETED") return as("authentication_error", "this Bitrix24 portal was deleted")
  if ((code && DENIED.has(code)) || status === 403)
    return as("permission_error", `the webhook's user may not do ${method}${named}`, { reason: "bitrix.access-denied" })
  if ((code && SIGN_IN.has(code)) || status === 401)
    return as(
      "authentication_error",
      `Bitrix24 refused this webhook${named}; set a working one with \`b24 <profile> session start\``,
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
