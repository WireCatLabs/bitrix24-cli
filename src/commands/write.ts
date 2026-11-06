import { CliError } from "@wirecat/cli-base"
import {
  environmentOf,
  itemOf,
  outputFor,
  readOnlyLockOf,
  readOnlyRefusal,
  renderAnswer,
  terminalAsker,
} from "@wirecat/cli-core/cli"
import { CRM_ASSIGN_OTHERS_KEY } from "@wirecat/cli-core/crm"
import { guardedWrite, guardFor, keyedGuard, type Level, levelFor, newOperationId } from "@wirecat/cli-core/sends"
import type { Command } from "commander"
import type { BitrixTransport } from "../bitrix/transport.js"
import { permissions } from "../config.js"
import { IDENTITY } from "../identity.js"
import { contextOf, transportFor, webhookOf } from "../portal.js"

/** REST 3.0's `Idempotency-Key`: 1 to 255 printable ASCII characters (apidocs "REST 3.0"). */
const OPERATION_ID = /^[\x21-\x7e]{1,255}$/

export const operationIdOf = (given: string | undefined): string => {
  if (given !== undefined && !OPERATION_ID.test(given))
    throw new CliError("validation_error", "--operation-id takes 1 to 255 printable characters with no spaces", {
      param: "--operation-id",
    })
  return given ?? newOperationId()
}

export interface Write {
  /** The command's own permission key, `deals.create`. */
  key: string
  /** The employee the record is assigned to, when the write sets one. */
  assignee?: string | undefined
  /** False for a REST 2 write, which Bitrix24 does not answer from a record when it is repeated. */
  keyed?: boolean
  /** Keys checked beside `key`, such as the command key a raw `api call` does the same as. */
  extra?: readonly string[]
  /** The built-in levels, when the call adds its own key's (`callDefaults`). */
  defaults?: Readonly<Record<string, Level>>
  operationId?: string | undefined
  /** A lookup the write needs, in its own run before the write is checked and sent, as gcal-cli's `api call` reads. */
  prepare?: (portal: BitrixTransport) => Promise<void>
  act: (portal: BitrixTransport, operationId: string) => Promise<Record<string, unknown>>
}

/**
 * Every write's one path, as gcal-cli's `api call` (src/commands/api.ts): the read-only lock, the profile's levels,
 * one question for every key at `ask`, the send journal, and an `operation_id` in the answer (WC-PERM-13, WC-OUT-10).
 */
export const write = async (
  command: Command,
  {
    key,
    assignee,
    extra: also = [],
    defaults = permissions.defaults,
    keyed = true,
    operationId: given,
    prepare,
    act,
  }: Write,
) => {
  const { env, settings, run } = contextOf(command)
  const lock = readOnlyLockOf(IDENTITY, env)
  if (lock) throw readOnlyRefusal(lock, "change the Bitrix24 portal")
  const operationId = operationIdOf(given)
  const webhook = webhookOf(command)
  const self = webhook.userId
  const extra = [...also, ...(assignee !== undefined && assignee !== self ? [CRM_ASSIGN_OTHERS_KEY] : [])]
  const levelOf = (one: string) => levelFor(settings.permissions, one, defaults).level
  const guard = keyedGuard(
    (ask) =>
      guardFor(
        IDENTITY,
        // The portal limits its own rate; the guard is here for the levels and the journal, not a send limit.
        { ...settings, sendsPerHour: Number.MAX_SAFE_INTEGER, permissionDefaults: defaults },
        outputFor(command).renderer.warn,
        environmentOf(command).env ?? process.env,
        ask,
      ),
    terminalAsker(command),
    levelOf,
    extra,
  )
  const request = { chatId: null, kind: "edit" as const, key, operationId }
  guard.refuse(request)
  if (prepare) await run((events) => prepare(transportFor(command, webhook, events)))
  let done: Record<string, unknown>
  try {
    done = await guardedWrite(guard, request, () =>
      run((events) => act(transportFor(command, webhook, events), operationId)),
    )
  } catch (error) {
    if (keyed && error instanceof CliError && error.code === "outcome_unknown")
      throw new CliError(
        "outcome_unknown",
        `${error.message} — check the portal, and repeat it with --operation-id ${operationId} only if it is not ` +
          "there: Bitrix24's documentation says a repeat with that key is answered from its record, not run again",
        { ...error.details, operation_id: operationId },
      )
    throw error
  }
  renderAnswer(command, outputFor(command), itemOf({ operation_id: operationId, ...done }))
}
