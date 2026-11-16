import { fromFile, outputFor } from "@wirecat/cli-core/cli"
import type { Command } from "commander"
import { PHONE_REGION, SYNC_CALLS } from "../config.js"
import { IDENTITY } from "../identity.js"
import { contextOf } from "../portal.js"

/** The program's own `run`, handed in by program.ts, which mounts this hook. */
type Run = (argv: string[], options?: Record<string, unknown>) => Promise<number>

/**
 * `sync` brings the calls too, as pbx's does, while `sync_calls` is on: the same run as `meetings sync`, its own
 * answer kept off stdout so the CRM sync's stays the one answer. A calls step that fails is a note, never the sync's
 * failure: a webhook without the telephony scope still syncs its CRM.
 */
export const syncCalls = (run: Run) => async (_parent: Command, sync: Command) => {
  const { settings, environment, flags, profile } = contextOf(sync)
  const say = (line: string) => outputFor(sync).renderer.warn(line)
  const { dryRun } = sync.optsWithGlobals<{ dryRun?: boolean }>()
  if (dryRun || flags.offline || fromFile<boolean>(settings, SYNC_CALLS, true).value !== true) return
  const out: string[] = []
  const code = await run([profile, "meetings", "sync", "--json"], {
    streams: { data: (text: string) => out.push(text), diagnostic: () => {} },
    tty: false,
    ...(environment.keyring ? { keyring: environment.keyring } : {}),
    ...(environment.fetch ? { fetch: environment.fetch } : {}),
    ...(environment.sleep ? { sleep: environment.sleep } : {}),
    ...(environment.env ? { env: environment.env } : {}),
  } as Parameters<Run>[1])
  let answer: { item?: { meetings?: number }; error?: { message?: string } } = {}
  try {
    answer = JSON.parse(out.join("").trim() || "{}")
  } catch {}
  if (code !== 0) {
    say(
      `calls not copied: ${answer.error?.message ?? "meetings sync failed"}; ` +
        `${IDENTITY.command} ${profile} meetings sync says more, and ${IDENTITY.command} ${profile} config set ${SYNC_CALLS} false stops trying`,
    )
    return
  }
  const copied = answer.item?.meetings ?? 0
  say(`calls: ${copied} copied`)
  if (copied > 0 && !fromFile<string>(settings, PHONE_REGION, "").value)
    say(
      `a caller's number written without + joins no contact until you name its country: ` +
        `${IDENTITY.command} ${profile} config set ${PHONE_REGION} ru`,
    )
}
