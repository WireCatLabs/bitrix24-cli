import {
  backoffMs,
  CliError,
  isCliError,
  type RetryConfig,
  realSleep,
  type SleepLike,
  wallClock,
} from "@wirecat/cli-base"
import { providerWaitMs, readJsonResponse } from "@wirecat/cli-base/http"
import { apiJson, currentAttempt, type EventSink, providerEvent, providerRequest } from "@wirecat/cli-core/cli"
import type { Pacer } from "@wirecat/cli-core/sends"
import { type BitrixFailure, bitrixError } from "./errors.js"
import { methodOf, type RestVersion } from "./methods.js"
import { methodUrl, type Webhook } from "./webhook.js"

/**
 * A third of a one-shot command's 30 s deadline (cli-core `DEFAULT_COMMAND_MS`), so a read that timed out can still be
 * tried again before the command ends. cli-core does not hand the run's remaining time to a transport.
 */
const DEFAULT_TIMEOUT_MS = 10_000
const LARGEST_ANSWER = 16 * 1024 * 1024
const RETRY: RetryConfig = { retries: 3, baseDelayMs: 1_000, maxDelayMs: 10_000, maxRetryAfterMs: 30_000 }
/** A pace wait longer than this ends the run instead of sitting in it, as cli-core's messenger pacing does. */
const LONGEST_PACE_WAIT_MS = 60_000

/** What a reader needs of the transport: a source call passes one that counts its requests. */
export type BitrixCaller = Pick<BitrixTransport, "call">

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>

export interface BitrixTransportOptions {
  webhook: Webhook
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
  readonly #webhook: Webhook
  readonly #fetch: FetchLike
  readonly #timeoutMs: number
  readonly #signal: AbortSignal | undefined
  readonly #events: EventSink | undefined
  readonly #pacer: Pacer | undefined
  readonly #sleep: SleepLike
  readonly #now: () => number
  readonly #random: () => number

  constructor(options: BitrixTransportOptions) {
    this.#webhook = options.webhook
    this.#fetch = options.fetch ?? fetch
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.#signal = options.signal
    this.#events = options.events
    this.#pacer = options.pacer
    this.#sleep = options.sleep ?? realSleep
    this.#now = options.now ?? Date.now
    this.#random = options.random ?? Math.random
  }

  /** The employee the webhook acts as. */
  get userId(): string {
    return this.#webhook.userId
  }

  /**
   * Reads are tried again on a refused rate or a lost answer. A write is sent once: whether Bitrix24 honours
   * `Idempotency-Key` is not checked on a live portal, so a write that got no answer is `outcome_unknown` and the
   * owner repeats it by hand.
   */
  async call(method: string, params: Record<string, unknown> = {}, options: CallOptions = {}): Promise<BitrixAnswer> {
    const known = methodOf(method)
    const api = known.api
    const reads = known.effect === "read"
    const key = api === 3 && !reads ? options.idempotencyKey : undefined
    let waited: number | undefined
    for (let attempt = 1; ; attempt++) {
      try {
        await this.#turn(method)
        return await this.#once(method, params, { api, reads, key, attempt, waited })
      } catch (error) {
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

  async #turn(method: string) {
    if (!this.#pacer) return
    const at = await this.#pacer.reserve()
    const wait = at - this.#now()
    if (wait <= 0) return
    if (wait > LONGEST_PACE_WAIT_MS)
      throw new CliError("rate_limited", `this profile must wait ${Math.ceil(wait / 1000)} s before ${method}`, {
        operation: method,
        retry_after_ms: wait,
        remembered: true,
      })
    await this.#wait(wait, method)
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
    run: { api: RestVersion; reads: boolean; key: string | undefined; attempt: number; waited: number | undefined },
  ): Promise<BitrixAnswer> {
    // Not AbortSignal.timeout: its timer holds the run's async context until the deadline (tg-cli, 2026-11-05).
    const deadline = new AbortController()
    const timer = setTimeout(
      () => deadline.abort(new DOMException(`${method} timed out`, "TimeoutError")),
      this.#timeoutMs,
    )
    timer.unref()
    const end = providerRequest(method, this.#events ?? providerEvent, {
      method: "POST",
      endpointTemplate: `/rest/${run.api === 3 ? "api/" : ""}:user/:token/${method}`,
      transport: "http",
      ...(currentAttempt()
        ? {}
        : { attempt: run.attempt, ...(run.waited === undefined ? {} : { waitMs: run.waited }) }),
    })
    const signal = AbortSignal.any([deadline.signal, ...(this.#signal ? [this.#signal] : [])])
    try {
      let response: Response
      try {
        response = await this.#fetch(methodUrl(this.#webhook, run.api, method), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            ...(run.key ? { "Idempotency-Key": run.key } : {}),
          },
          body: apiJson(params),
          // A redirect would carry the secret path to another host.
          redirect: "error",
          signal,
        })
      } catch (error) {
        const failure = this.#unanswered(method, error, run)
        end({ errorCode: failure.code })
        throw failure
      }
      let body: unknown
      try {
        body = await readJsonResponse(response, { maxBytes: LARGEST_ANSWER, signal })
      } catch (error) {
        if (signal.aborted) {
          const failure = this.#unanswered(method, error, run)
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
      const answer = (body ?? {}) as BitrixAnswer & BitrixFailure
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
    if (this.#signal?.aborted && (this.#signal.reason as { name?: string })?.name !== "TimeoutError")
      return new CliError("cancelled", `${method} was cancelled`, { operation: method })
    const timedOut = (error as { name?: string })?.name === "TimeoutError"
    return new CliError(
      timedOut ? "timeout" : "network_error",
      timedOut ? `${method} got no answer within ${this.#timeoutMs} ms` : `${method} could not reach Bitrix24`,
      { operation: method, retryable: true },
    )
  }
}
