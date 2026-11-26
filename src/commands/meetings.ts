import { CliError } from "@wirecat/cli-base"
import { annotate, metaOf } from "@wirecat/cli-base/commands"
import {
  environmentOf,
  fetchesOnly,
  fromFile,
  hasSharedContract,
  inCommandRun,
  itemOf,
  listOf,
  NO_EFFECTS,
  outputFor,
  overrideSharedContract,
  pagingOf,
  readsOverMcp,
  renderAnswer,
  runBudgetOf,
  snakeKeys,
  writeNewFile,
  writesNewFileOnlyWith,
} from "@wirecat/cli-core/cli"
import type { MeetingSource, MeetingStore } from "@wirecat/cli-core/meetings"
import { addMeetingCommands, type MeetingCommandDeps } from "@wirecat/cli-core/meetings/cli"
import type { AccountKey, MessageStore } from "@wirecat/cli-core/store"
import { Command } from "commander"
import type { BitrixTransport } from "../bitrix/transport.js"
import type { Recordings } from "../calls/recordings.js"
import { DOWNLOAD_RECORDINGS, PHONE_REGION } from "../config.js"
import { IDENTITY } from "../identity.js"
import { contextOf, signInOf, storedSignIn, transportFor } from "../portal.js"
import { transcribeCommand } from "./transcribe.js"

interface Opened {
  store: MessageStore
  accountId: number
  portal: () => BitrixTransport
  source: () => MeetingSource
  recordings: () => Recordings
  close: () => Promise<void>
}

const leaves = (command: Command): Command[] => (command.commands.length ? command.commands.flatMap(leaves) : [command])
const pathOf = (command: Command): string[] =>
  command.parent?.parent ? [...pathOf(command.parent), command.name()] : [command.name()]
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
const LIST_KEYS = new Set(["items", "page", "limit", "hasMore", "meta"])
const ITEM_KEYS = new Set(["item", "missing", "meta"])

const EXAMPLES: Record<string, string> = {
  "meetings list": "--limit 50",
  "meetings show": "1",
  "meetings transcript": "1",
  "meetings export": "1 --format markdown",
  "meetings people": '"Anna Example"',
  "meetings sync": "--since-time 2026-11-01T00:00:00Z",
  "meetings repair": "",
  "events list": "",
}

/** Bitrix24's call history has no summaries and no transcript files to import. */
const UNUSED = new Set(["summary", "import"])

const withExample = (leaf: Command) => {
  const path = pathOf(leaf).join(" ")
  const args = EXAMPLES[path]
  if (args === undefined) return
  const change = (one: Command) => {
    annotate(one, { examples: [[IDENTITY.command, "work", path, args, "--json"].filter(Boolean).join(" ")] })
  }
  if (hasSharedContract(leaf)) overrideSharedContract(leaf, "b24's examples name its profile and a call id.", change)
  else change(leaf)
}

const goOn = (command: string, step: string, why: string, safe: boolean) => ({
  meta: { complete: false },
  next: [{ kind: "command" as const, step, command, args: {}, why, safe_to_auto_execute: safe }],
})

/** cli-core's reads answer `{ items, page, limit, hasMore, meta? }` or one value; b24 prints both in its envelope. */
const bodyOf = (command: Command, value: unknown) => {
  if (isRecord(value) && Array.isArray(value.items) && isRecord(value.page))
    return value as Parameters<typeof renderAnswer>[2]
  if (isRecord(value) && Array.isArray(value.items) && Object.keys(value).every((key) => LIST_KEYS.has(key))) {
    const { next, ...list } = listOf(pathOf(command).join(" "), {
      items: snakeKeys(value.items) as unknown[],
      limit: Math.max(1, typeof value.limit === "number" ? value.limit : value.items.length),
      has_more: value.hasMore === true,
      ...(isRecord(value.meta) ? { meta: snakeKeys(value.meta) as Parameters<typeof listOf>[1]["meta"] } : {}),
    })
    const kept = next?.filter((one) => one.step !== "page.next") ?? []
    return { ...list, ...(kept.length > 0 ? { next: kept } : {}) }
  }
  if (pathOf(command).join(" ") === "meetings sync" && isRecord(value) && value.stopped)
    return itemOf(
      snakeKeys(value),
      goOn("meetings sync", "sync.continue", `${value.remaining} calls were not reached before the run stopped`, true),
    )
  if (isRecord(value) && isRecord(value.item) && Object.keys(value).every((key) => ITEM_KEYS.has(key)))
    return itemOf(snakeKeys(value.item), {
      ...(Array.isArray(value.missing) ? { missing: value.missing } : {}),
      ...(isRecord(value.meta) ? { meta: value.meta } : {}),
    })
  return itemOf(snakeKeys(value))
}

const regionsOf = (value: unknown): string[] =>
  typeof value === "string"
    ? [
        ...new Set(
          value
            .toLowerCase()
            .split(/[\s,]+/)
            .filter(Boolean),
        ),
      ]
    : []

/** The shared `meetings` commands over the portal's call history: one call is one meeting, for this profile only. */
export const meetingsMount = () => {
  const commands = new Set<Command>()
  let action: Command | undefined
  let opened: Opened | undefined
  const answers: (() => void)[] = []
  const need = (): Opened => {
    if (!opened) throw new CliError("configuration_error", "the call store is not open for this command")
    return opened
  }
  const deps: MeetingCommandDeps = {
    get store(): MeetingStore {
      return need().store.meetings
    },
    get accountId() {
      return need().accountId
    },
    get source() {
      return need().source()
    },
    inRun: inCommandRun,
    newFileOutput: writesNewFileOnlyWith,
    writeFile: writeNewFile,
    budgetOf: runBudgetOf,
    pagingOf,
    write: (value) => {
      const at = action
      if (!at) throw new CliError("configuration_error", "no command is running")
      const body = bodyOf(at, value)
      answers.push(() => renderAnswer(at, outputFor(at), body))
    },
  }
  return {
    commands: (): Command[] => {
      const holder = new Command(IDENTITY.command)
      addMeetingCommands(holder, deps)
      const meetings = holder.commands.find((group) => group.name() === "meetings")
      if (meetings) {
        overrideSharedContract(meetings, "Bitrix24 gives no summaries and no transcript files to import.", (group) => {
          const mounted = group.commands as Command[]
          for (const one of mounted.filter((leaf) => UNUSED.has(leaf.name()))) mounted.splice(mounted.indexOf(one), 1)
        })
        meetings.addCommand(
          transcribeCommand({
            store: () => need().store.meetings,
            accountId: () => need().accountId,
            record: () => {
              const portal = need().portal()
              return async (callId) => (await import("../calls/source.js")).callRecord(portal, callId)
            },
            recordings: () => need().recordings(),
            signal: () => (action ? environmentOf(action).signal : undefined),
            progress: (line) => (action ? environmentOf(action).streams?.diagnostic(line) : undefined),
            write: (report, command) => {
              const resume = report.stopped
                ? goOn(
                    "meetings transcribe",
                    "transcribe.continue",
                    `${report.remaining} calls still have no transcript`,
                    false,
                  )
                : {}
              answers.push(() => renderAnswer(command, outputFor(command), itemOf(report, resume)))
            },
          }),
        )
      }
      for (const group of holder.commands) {
        if (group.commands.length && !hasSharedContract(group)) annotate(group, { effects: NO_EFFECTS })
        for (const leaf of leaves(group)) {
          withExample(leaf)
          commands.add(leaf)
        }
      }
      return [...holder.commands]
    },
    configure: (program: Command) => {
      program.hook("preAction", (_root, chosen) => {
        action = chosen
      })
      // WC-LIFE-4: a close that fails can change the answer, so the store closes before anything is printed.
      program.hook("postAction", async () => {
        await opened?.close()
        for (const answer of answers.splice(0)) answer()
      })
    },
    prepare: async () => {
      const at = action
      if (!at || !commands.has(at)) return
      const run = environmentOf(at)
      const { env, profile, settings } = contextOf(at)
      const [{ openCrmStore }, { openB24Store, PROVIDER }, { crmIdentityId }, calls, recordings, crm, memory] =
        await Promise.all([
          import("@wirecat/cli-core/crm/cli"),
          import("../store.js"),
          import("@wirecat/cli-core/store/areas"),
          import("../calls/source.js"),
          import("../calls/recordings.js"),
          import("../crm/source.js"),
          import("../crm/own-memory.js"),
        ])
      const reads = metaOf(at).effects?.local === "read" || (readsOverMcp(at) && !fetchesOnly(at))
      const { store, account } = await openCrmStore({
        app: IDENTITY,
        env,
        profile,
        readOnly: reads,
        provider: PROVIDER.name,
        open: openB24Store,
        account: (): AccountKey => ({ provider: PROVIDER.name, account: new URL(storedSignIn(at).origin).host }),
      })
      let closed: Promise<void> | undefined
      const close = () => (closed ??= store.close())
      // Still tracked: a command that fails never reaches postAction.
      run.trackCloseable?.({ close })
      const { id: accountId } = await store.accounts.storedAccount(account)
      let transport: BitrixTransport | undefined
      const portal = () => (transport ??= transportFor(at, signInOf(at)))
      // The CRM sync's own rule decides whose calls are copied: the signed-in user, or the users chosen in
      // `unassigned` that rule keeps. A stored `all` refuses, as the CRM sync does: a copy is never the whole portal.
      const users = async () => {
        const { crmSettingKey } = await import("@wirecat/cli-core/store/areas")
        const scope = await store.crm.scope(account)
        const source = crm.bitrixCrmSource(portal, Date.now, memory.NO_MEMORY, async () => ({
          mode: scope.mode,
          setting: crmSettingKey(account, "scope"),
          chosen: crmSettingKey(account, "unassigned"),
        }))
        const self = (await source.self?.()) ?? portal().userId
        const chosen =
          scope.mode === "mine" && scope.also.length ? ((await source.unassigned?.(scope.also))?.kept ?? []) : [self]
        return [...new Set(chosen.map(Number))].filter(Number.isSafeInteger)
      }
      let kept: Recordings | undefined
      const keptRecordings = () =>
        (kept ??= recordings.recordingsAt(recordings.recordingsFolder(env, profile), (link, maxBytes) =>
          portal().download(link, maxBytes),
        ))
      let source: MeetingSource | undefined
      opened = {
        store,
        accountId,
        close,
        portal,
        recordings: keptRecordings,
        source: () =>
          (source ??= calls.callSource({
            portal,
            account,
            manager: (userId) => crmIdentityId(account, userId, "user"),
            users,
            phoneRegions: regionsOf(fromFile<string>(settings, PHONE_REGION, "").value),
            recordings:
              fromFile<boolean>(settings, DOWNLOAD_RECORDINGS, false).value === true ? keptRecordings() : null,
            missed: (callId, error) =>
              run.streams?.diagnostic(
                `the recording of call ${callId} was not downloaded (${error instanceof Error ? error.message : "failed"}); ` +
                  "meetings transcribe downloads it when it needs it\n",
              ),
          })),
      }
    },
  }
}
