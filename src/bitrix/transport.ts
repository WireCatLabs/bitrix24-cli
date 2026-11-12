import {
  backoffMs,
  CliError,
  isCliError,
  type RetryConfig,
  realSleep,
  type SleepLike,
  wallClock,
} from "@wirecat/cli-base"
import { hostFetch, providerWaitMs, readJsonResponse } from "@wirecat/cli-base/http"
import { apiJson, currentAttempt, type EventSink, providerEvent, providerRequest } from "@wirecat/cli-core/cli"
import { type Pacer, waitForTurn } from "@wirecat/cli-core/sends"
import { type EmployeeRule, employeeRuleOf } from "../api-keys.js"
import { isRecord } from "../body.js"
import { isAdmin } from "../crm/clients.js"
import { bitrixError } from "./errors.js"
import { methodOf, type RestVersion } from "./methods.js"
import type { AppAuth } from "./oauth.js"
import { methodUrl, type Webhook } from "./webhook.js"

/**
 * A third of a one-shot command's 30 s deadline (cli-core `DEFAULT_COMMAND_MS`), so a read that timed out can still be
 * tried again before the command ends. cli-core does not hand the run's remaining time to a transport.
 */
const DEFAULT_TIMEOUT_MS = 10_000
const LARGEST_ANSWER = 16 * 1024 * 1024
const RETRY: RetryConfig = { retries: 3, baseDelayMs: 1_000, maxDelayMs: 10_000, maxRetryAfterMs: 30_000 }
/** An agent usually waits on b24: past a minute the run ends with retry_after_ms instead of sitting silent. */
const LONGEST_PACE_WAIT_MS = 60_000

const EMPLOYEE_REFUSALS: Record<EmployeeRule, (method: string) => string> = {
  delete: (method) => `${method} deletes from the CRM`,
  clear: (method) => `${method} sets a field to nothing (an empty value, null, [] or a 0 link)`,
  batch: () => "batch can hold deletes and cleared fields b24 cannot see into",
  unbind: (method) => `${method} unlinks records in the CRM`,
  merge: (method) => `${method} merges duplicates, deleting all but one of them`,
}

/** What a reader needs of the transport: a source call passes one that counts its requests. */
export type BitrixCaller = Pick<BitrixTransport, "call">

const isTimeout = (error: unknown) =>
  (error instanceof Error && error.name === "TimeoutError") || (isCliError(error) && error.code === "timeout")

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>

export interface BitrixTransportOptions {
  auth: Webhook | AppAuth
  fetch?: FetchLike
  timeoutMs?: number
  signal?: AbortSignal
  events?: EventSink
  /** Shared by every `b24` process of the profile: the portal's limit is per portal, not per process. */
  pacer?: Pacer
  sleep?: SleepLike
  now?: () => number
  random?: () => number
}

export interface CallOptions {
  /** A write's operation id, sent as REST 3.0's `Idempotency-Key`; a live portal still did a repeat again. */
  idempotencyKey?: string
}

/** REST 2 lists carry `total` and `next` beside `result`; REST 3.0 answers carry neither. */
export interface BitrixAnswer {
  result: unknown
  total?: number
  next?: number
}

/**
 * Bitrix24's REST API over an incoming webhook, method by method.
 *
 * ⚠ **The webhook's secret is part of every address** — `/rest/<user>/<secret>/<method>` — so the address never
 * leaves this class: not in an error, not in a run record, and never by passing on a failed request's own error,
 * whose text may hold it. Modelled on tg-cli's Bot API transport, which has the same problem.
 */
export class BitrixTransport {
  readonly #auth: Webhook | AppAuth
  readonly #fetch: FetchLike
  readonly #timeoutMs: number
  readonly #signal: AbortSignal | undefined
  readonly #events: EventSink | undefined
  readonly #pacer: Pacer | undefined
  readonly #sleep: SleepLike
  readonly #now: () => number
  readonly #random: () => number

  constructor(options: BitrixTransportOptions) {
    this.#auth = options.auth
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    // The portal is the one host b24 reaches (identity `userHosts`); our own deadline below fires first.
    this.#fetch = hostFetch({
      hosts: [new URL(options.auth.origin).hostname],
      ...(options.fetch ? { fetch: options.fetch as typeof fetch } : {}),
      timeoutMs: this.#timeoutMs * 2,
    }) as FetchLike
    this.#signal = options.signal
    this.#events = options.events
    this.#pacer = options.pacer
    this.#sleep = options.sleep ?? realSleep
    this.#now = options.now ?? Date.now
    this.#random = options.random ?? Math.random
  }

  /** The portal's address, without the webhook's secret. */
  get origin(): string {
    return this.#auth.origin
  }

  /** The employee the webhook or the application's sign-in acts as. */
  get userId(): string {
    return this.#auth.userId
  }

  /**
   * Reads are tried again on a refused rate or a lost answer. A write is sent once: on a live portal, a create repeated
   * with the same `Idempotency-Key` made a second record, so a write that got no answer is `outcome_unknown` and the
   * owner looks at the portal before repeating it.
   */
  async call(method: string, params: Record<string, unknown> = {}, options: CallOptions = {}): Promise<BitrixAnswer> {
    const known = methodOf(method)
    const api = known.api
    const reads = known.effect === "read"
    const key = api === 3 && !reads ? options.idempotencyKey : undefined
    if (!reads) await this.#refuseForEmployee(method, params)
    let waited: number | undefined
    let refresh: boolean | undefined
    for (let attempt = 1; ; attempt++) {
      try {
        await this.#turn(method)
        const renew = refresh === true
        if (renew) refresh = false
        return await this.#once(method, params, { api, reads, key, attempt, waited, refresh: renew })
      } catch (error) {
        // A refused token did nothing, so even a write is sent again, once, with a refreshed one (apidocs auto-renewal).
        // REST 2 names it `expired_token`; REST 3.0 documents no code for it, so any 401 counts.
        if (refresh === undefined && "accessToken" in this.#auth && isCliError(error)) {
          if (error.details.provider_error === "EXPIRED_TOKEN" || error.details.status === 401) {
            refresh = true
            continue
          }
        }
        if (!isCliError(error) || !reads) throw error
        const asked = error.details.retry_after_ms
        const wait = typeof asked === "number" ? asked : backoffMs(attempt, RETRY, this.#random)
        const again = error.code === "rate_limited" || error.details.retryable === true
        if (!again || wait > RETRY.maxRetryAfterMs || attempt > RETRY.retries) throw error
        if (error.code === "rate_limited") await this.#pacer?.holdFor(wait)
        await this.#wait(wait, method)
        waited = wait
      }
    }
  }

  /** Here, where every write passes, so neither a command nor its permission level can get round it. */
  async #refuseForEmployee(method: string, params: Record<string, unknown>) {
    const rule = employeeRuleOf(method, params)
    if (rule === undefined || (await isAdmin(this))) return
    throw new CliError(
      "permission_error",
      `${EMPLOYEE_REFUSALS[rule](method)}, which b24 lets only a Bitrix24 administrator do: an employee's webhook ` +
        "deletes, unlinks and merges nothing and clears no field, whatever the permissions say. Sign in with an administrator's webhook " +
        "(session start) to do it",
      { reason: `employee.${rule}`, operation: method, sent: false },
    )
  }

  async #turn(method: string) {
    if (!this.#pacer) return
    await waitForTurn(this.#pacer, {
      name: "Bitrix24",
      operation: method,
      now: this.#now,
      sleep: (ms) => this.#wait(ms, method),
      longestWaitMs: LONGEST_PACE_WAIT_MS,
    })
  }

  async #wait(ms: number, method: string) {
    try {
      await this.#sleep(ms, this.#signal, "retry")
    } catch {
      throw new CliError("cancelled", `stopped while waiting to call ${method}`, { operation: method })
    }
  }

  async #once(
    method: string,
    params: Record<string, unknown>,
    run: {
      api: RestVersion
      reads: boolean
      key: string | undefined
      attempt: number
      waited: number | undefined
      refresh: boolean
    },
  ): Promise<BitrixAnswer> {
    const auth = this.#auth
    const app = "accessToken" in auth
    const token = app ? await auth.accessToken(run.refresh) : undefined
    const path = `/rest/${run.api === 3 ? "api/" : ""}`
    // Not AbortSignal.timeout: its timer holds the run's async context until the deadline (tg-cli, 2026-11-05).
    const deadline = new AbortController()
    const timer = setTimeout(
      () => deadline.abort(new DOMException(`${method} timed out`, "TimeoutError")),
      this.#timeoutMs,
    )
    timer.unref()
    const end = providerRequest(method, this.#events ?? providerEvent, {
      method: "POST",
      endpointTemplate: `${path}${app ? "" : ":user/:token/"}${method}`,
      transport: "http",
      ...(currentAttempt()
        ? {}
        : { attempt: run.attempt, ...(run.waited === undefined ? {} : { waitMs: run.waited }) }),
    })
    const signal = AbortSignal.any([deadline.signal, ...(this.#signal ? [this.#signal] : [])])
    try {
      let response: Response
      try {
        response = await this.#fetch(app ? `${auth.origin}${path}${method}` : methodUrl(auth, run.api, method), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            ...(run.key ? { "Idempotency-Key": run.key } : {}),
          },
          // In the body, never the address: apidocs how-to-call-rest-api/authorization and rest-v3.
          body: apiJson(token === undefined ? params : { ...params, auth: token }),
          // A redirect would carry the secret path to another host.
          redirect: "error",
          signal,
        })
      } catch (error) {
        const failure = this.#unanswered(method, signal.aborted ? signal.reason : error, run)
        end({ errorCode: failure.code })
        throw failure
      }
      let body: unknown
      try {
        body = await readJsonResponse(response, { maxBytes: LARGEST_ANSWER, signal })
      } catch {
        if (signal.aborted) {
          const failure = this.#unanswered(method, signal.reason, run)
          end({ status: response.status, errorCode: failure.code })
          throw failure
        }
        end({ status: response.status, errorCode: "invalid_response" })
        if (!response.ok) throw this.#refused(method, bitrixError(method, response.status, undefined), run.reads)
        throw new CliError("invalid_response", `Bitrix24 answered ${method} with something that is not JSON`, {
          operation: method,
          status: response.status,
        })
      }
      const answer = isRecord(body) ? body : {}
      if (!response.ok || answer.error !== undefined) {
        const refusal = bitrixError(method, response.status, answer, {
          now: this.#now(),
          waitMs: providerWaitMs(response.headers, wallClock),
        })
        end({
          status: response.status,
          errorCode: refusal.code,
          providerError: String(refusal.details.provider_error ?? ""),
        })
        throw this.#refused(method, refusal, run.reads)
      }
      end({ status: response.status })
      return {
        result: answer.result,
        ...(typeof answer.total === "number" ? { total: answer.total } : {}),
        ...(typeof answer.next === "number" ? { next: answer.next } : {}),
      }
    } finally {
      clearTimeout(timer)
    }
  }

  /** A gateway or server failure may come after a write was made; only a refusal says it was not. */
  #refused(method: string, refusal: CliError, reads: boolean): CliError {
    if (reads || refusal.code !== "provider_unavailable") return refusal
    return new CliError("outcome_unknown", `Bitrix24 failed on ${method}; it may or may not have carried it out`, {
      ...refusal.details,
      retryable: false,
    })
  }

  #unanswered(method: string, error: unknown, run: { reads: boolean; key: string | undefined }): CliError {
    // A cut write may have reached the portal: never "cancelled", which a caller would repeat (WC-LIFE-9). A keyed
    // write's caller names how to repeat it; a REST 2 write has no key to repeat it safely with.
    if (!run.reads)
      return new CliError(
        "outcome_unknown",
        `${method} got no answer; Bitrix24 may or may not have carried it out${run.key ? "" : " — check before repeating it"}`,
        { operation: method, retryable: false },
      )
    if (this.#signal?.aborted && !isTimeout(this.#signal.reason))
      return new CliError("cancelled", `${method} was cancelled`, { operation: method })
    const timedOut = isTimeout(error)
    return new CliError(
      timedOut ? "timeout" : "network_error",
      timedOut ? `${method} got no answer within ${this.#timeoutMs} ms` : `${method} could not reach Bitrix24`,
      { operation: method, retryable: true },
    )
  }
}
