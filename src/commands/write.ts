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
import { contextOf, signInOf, transportFor } from "../portal.js"

export interface Write {
  key: string
  /** The employee the record is assigned to, when the write sets one. */
  assignee?: string | undefined
  /** Keys checked beside `key`, such as the command key a raw `api call` does the same as. */
  extra?: readonly string[]
  /** The built-in levels, when the call adds its own key's (`callDefaults`). */
  defaults?: Readonly<Record<string, Level>>
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
  { key, assignee, extra: also = [], defaults = permissions.defaults, prepare, act }: Write,
) => {
  const { env, settings, run } = contextOf(command)
  const lock = readOnlyLockOf(IDENTITY, env)
  if (lock) throw readOnlyRefusal(lock, "change the Bitrix24 portal")
  const operationId = newOperationId()
  const auth = signInOf(command)
  const self = auth.userId
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
  if (prepare) await run((events) => prepare(transportFor(command, auth, events)))
  let done: Record<string, unknown>
  try {
    done = await guardedWrite(guard, request, () =>
      run((events) => act(transportFor(command, auth, events), operationId)),
    )
  } catch (error) {
    if (error instanceof CliError && error.code === "outcome_unknown")
      throw new CliError(
        "outcome_unknown",
        `${error.message} — check the portal before you write it again: Bitrix24 would make it a second time`,
        { ...error.details, operation_id: operationId },
      )
    throw error
  }
  renderAnswer(command, outputFor(command), itemOf({ operation_id: operationId, ...done }))
}
