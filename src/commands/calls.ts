import { existsSync } from "node:fs"
import { CliError } from "@wirecat/cli-base"
import { annotate } from "@wirecat/cli-base/commands"
import {
  fromFile,
  itemOf,
  outputFor,
  REMOTE_WRITE,
  readOnlyLockOf,
  readOnlyRefusal,
  renderAnswer,
  snakeKeys,
  terminalAsker,
} from "@wirecat/cli-core/cli"
import { guardedWrite, guardFor, keyedGuard, levelFor, newOperationId } from "@wirecat/cli-core/sends"
import { Command } from "commander"
import { CALLS_LOG_KEYS, EXPORT_CALLS, permissions } from "../config.js"
import { IDENTITY } from "../identity.js"
import { contextOf, storedSignIn, transportFor } from "../portal.js"

const B24 = IDENTITY.command
const KEY = "calls.export"

const whole = (name: string) => (text: string) => {
  const value = Number(text)
  if (!Number.isSafeInteger(value) || value <= 0) throw new CliError("validation_error", `${name} takes a record id`)
  return value
}

const sinceOf = (text: string, now: number) => {
  const relative = /^(\d+)([hd])$/.exec(text.trim())
  if (relative) return now - Number(relative[1]) * (relative[2] === "h" ? 3_600_000 : 86_400_000)
  const at = Date.parse(text)
  if (Number.isNaN(at)) throw new CliError("validation_error", "--since-time takes an ISO time, or 12h or 7d back")
  return at
}

const phoneOf = (text: string) => {
  if (!/^\+\d{7,15}$/.test(text.trim()))
    throw new CliError("validation_error", "--phone takes a number in international form, such as +79000000001")
  return text.trim()
}

interface Options {
  sinceTime?: string
  meeting?: number
  contact?: number
  phone?: string
  dryRun?: boolean
}

/** The calls that would land on the portal at `host`, those the ledger says are written already left out. */
const planFor = async (env: NodeJS.ProcessEnv, host: string, options: Options) => {
  const { openB24Store } = await import("../store.js")
  const { ledgerPath, openLedger, planCalls } = await import("../calls/log.js")
  const ledger = await openLedger(ledgerPath(env, host))
  const store = await openB24Store(env, { readOnly: true })
  try {
    const plan = await planCalls(store, {
      host,
      ...(options.sinceTime ? { since: sinceOf(options.sinceTime, Date.now()) } : {}),
      ...(options.meeting === undefined ? {} : { meeting: options.meeting }),
      ...(options.contact === undefined ? {} : { contact: options.contact }),
      ...(options.phone === undefined ? {} : { phone: options.phone }),
    })
    const pending = plan.planned.filter((call) => !ledger.get(call.key)?.finished_at)
    return { ledger, pending, skipped: plan.skipped, alreadyExported: plan.planned.length - pending.length }
  } finally {
    await store.close()
  }
}

/**
 * Every Bitrix24 portal in the store, since a preview reads no sign-in (the keyring stays closed until a real run),
 * so it cannot tell which portal this profile is; each one's calls are listed under its name.
 */
const portalsOf = async (env: NodeJS.ProcessEnv) => {
  const { storePath } = await import("@wirecat/cli-core/store")
  if (!existsSync(storePath(env))) return []
  const { openB24Store } = await import("../store.js")
  const store = await openB24Store(env, { readOnly: true })
  try {
    return (await store.accounts.storedAccounts())
      .filter((one) => one.provider === "bitrix24")
      .map((one) => one.account)
  } finally {
    await store.close()
  }
}

const exportCommand = () =>
  annotate(new Command("export"), {
    effects: REMOTE_WRITE,
    offline: false,
    examples: [`${B24} work calls export --since-time 7d --dry-run`, `${B24} work calls export --since-time 7d`],
  })
    .summary("write the calls of other phone systems onto the client's contact in Bitrix24")
    .description(
      "write each stored call of another phone system, such as pbx, to the Bitrix24 contact its client is linked " +
        "to, once; off until export_calls is on and the two telephony.externalcall permissions are allowed",
    )
    .addHelpText(
      "after",
      `\nA call lands on a contact only when its client is linked to exactly one contact of this portal and its ` +
        `employee to one portal user; any other is listed as skipped, with the reason. Bitrix24 lets only an ` +
        `application write a call, so the profile needs the application sign-in (${B24} <profile> session start ` +
        `--portal … --client-id …), not a webhook.`,
    )
    .option("--since-time <time>", "calls from this ISO time, or this far back (12h, 7d)")
    .option("--meeting <id>", "only this stored call (its id in meetings list)", whole("--meeting"))
    .option("--contact <person>", "write onto this contact id, whatever the client is linked to", whole("--contact"))
    .option("--phone <phone>", "with --contact: the number to send instead of the caller's", phoneOf)
    .option("--dry-run", "show each call with the fields it would send, and the gates; send nothing")
    .action(async function (this: Command, options: Options) {
      if (options.phone !== undefined && options.contact === undefined)
        throw new CliError("validation_error", "--phone goes with --contact: it replaces the caller's number")
      const { env, settings, run } = contextOf(this)
      const on = fromFile<boolean>(settings, EXPORT_CALLS, false).value === true
      const levelOf = (key: string) => levelFor(settings.permissions, key, permissions.defaults).level
      const checked = [KEY, ...CALLS_LOG_KEYS].map((key) => ({ key, level: levelOf(key) }))
      if (options.dryRun) {
        const portals = []
        for (const host of await portalsOf(env)) {
          const plan = await planFor(env, host, options)
          portals.push({
            portal: host,
            // Bitrix24's own field names, exactly as they would be sent.
            would_export: plan.pending.map(({ meeting, register, finish }) => ({ meeting, register, finish })),
            already_exported: plan.alreadyExported,
            skipped: plan.skipped,
          })
        }
        return renderAnswer(
          this,
          outputFor(this),
          itemOf({
            ...(snakeKeys({
              preview: true,
              permission: checked[0],
              gates: { exportCalls: on, signIn: "an application's, checked when it runs", permissions: checked },
              effects: { actionInvoked: false, serviceContacted: false, keyringRead: false },
            }) as Record<string, unknown>),
            portals,
          }),
        )
      }
      const auth = storedSignIn(this)
      const plan = await planFor(env, new URL(auth.origin).host, options)
      const { ledger, pending } = plan
      const application = "accessToken" in auth
      if (!on)
        throw new CliError(
          "configuration_error",
          `calls export is off for this profile; turn it on with ${B24} <profile> config set ${EXPORT_CALLS} true`,
          { reason: "calls-export.off" },
        )
      if (!application)
        throw new CliError(
          "permission_error",
          `Bitrix24 lets only an application write a call, and this profile signs in with a webhook; sign in with ` +
            `${B24} <profile> session start --portal <portal> --client-id <id>`,
          { reason: "webhook.app-only" },
        )
      const lock = readOnlyLockOf(IDENTITY, env)
      if (lock) throw readOnlyRefusal(lock, "write calls to the Bitrix24 portal")
      const denied = checked.find(({ level }) => level === "deny" || level === "readonly")
      if (denied)
        throw new CliError("permission_error", `this profile does not permit ${denied.key}`, {
          permission: denied.key,
        })
      const guard = keyedGuard(
        (ask) =>
          guardFor(
            IDENTITY,
            { ...settings, sendsPerHour: Number.MAX_SAFE_INTEGER, permissionDefaults: permissions.defaults },
            outputFor(this).renderer.warn,
            env,
            ask,
          ),
        terminalAsker(this),
        levelOf,
        CALLS_LOG_KEYS,
      )
      const { logCalls } = await import("../calls/log.js")
      const report = await run((events) => {
        const portal = transportFor(this, auth, events)
        return logCalls({ planned: pending, skipped: plan.skipped }, ledger, async (method, body) => {
          const request = { chatId: null, kind: "edit" as const, key: KEY, operationId: newOperationId() }
          guard.refuse(request)
          const answer = await guardedWrite(guard, request, () =>
            portal.call(method, body, { idempotencyKey: request.operationId }),
          )
          return (answer.result ?? {}) as Record<string, unknown>
        })
      })
      renderAnswer(
        this,
        outputFor(this),
        itemOf({ ...report, already_exported: report.already_exported + plan.alreadyExported }),
      )
    })

export const callsCommand = (): Command =>
  annotate(new Command("calls"), { effects: REMOTE_WRITE })
    .description("write calls of other phone systems into Bitrix24")
    .addCommand(exportCommand())
