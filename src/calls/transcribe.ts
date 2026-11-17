import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { isCliError } from "@wirecat/cli-base"
import type { QueryAst } from "@wirecat/cli-base/query"
import {
  formatMeetingReference,
  type MeetingRecognitionSegment,
  type MeetingStore,
  type MeetingTranscriptionSource,
  type MeetingTranscriptReceiptStore,
  transcribeMeeting,
} from "@wirecat/cli-core/meetings"
import type { Pcm, TimedText } from "@wirecat/cli-core/speech"
import { attachmentOf, type Recordings } from "./recordings.js"
import type { CallRecord } from "./source.js"

export type Recognize = (pcm: Pcm) => Promise<TimedText[]>

export interface Recognition {
  engine: string
  model: string
  version?: string
}

export interface TranscribeOptions {
  /** Which stored calls, in `meetings list`'s query language. */
  query: QueryAst
  limit: number
  /** Calls that already have a transcript are transcribed again too. */
  replace?: boolean
  now?: () => number
  progress?: (line: string) => void
  /** Checked before each call: once it aborts, the run stops after the call it is on and keeps what it did. */
  signal?: AbortSignal
}

export interface TranscribeReport {
  transcribed: number
  audio_ms: number
  failed: FailedCall[]
  remaining: number
  /** True when the run stopped on its signal before reaching --max-meetings. */
  stopped: boolean
}

export interface FailedCall {
  meeting: number
  ref: string
  reason: string
  message: string
}

export interface TranscribePorts {
  store: MeetingStore & MeetingTranscriptReceiptStore
  accountId: number
  /** The call read again from the portal, for a fresh recording link. */
  record: (callId: string) => Promise<CallRecord | null>
  recordings: Recordings
  /** Keeps a recording downloaded for transcription, when `download_recordings` is on. */
  keep: boolean
  /** The channels of a recording: two when they are separate, else one. */
  decode: (bytes: Uint8Array) => Promise<Pcm[]>
  recognize: Recognize
  recognition: Recognition
}

/** cli-core's decoder reads at most an hour of audio (`LONGEST_AUDIO_SECONDS`). */
export const LONGEST_CALL_MS = 60 * 60 * 1000

const durationMsOf = (channels: readonly Pcm[]) =>
  Math.floor(channels.reduce((longest, { samples, rate }) => Math.max(longest, (samples.length / rate) * 1000), 0))

/**
 * The channels as one dialogue, in order of who started speaking. Bitrix24 does not say which side its stereo
 * recordings put on which channel, so two channels are named by number and one has no speaker.
 */
export const dialogue = (channels: readonly TimedText[][], durationMs: number): MeetingRecognitionSegment[] =>
  channels
    .flatMap((pieces, channel) =>
      pieces.map(({ start, end, text }) => ({
        startMs: Math.floor(start * 1000),
        endMs: Math.min(durationMs, Math.ceil(end * 1000)),
        text,
        speaker: channels.length > 1 ? `Channel ${channel + 1}` : null,
      })),
    )
    .filter(({ startMs, endMs, text }) => endMs > startMs && text.trim())
    .sort((a, b) => a.startMs - b.startMs)

const transcriptionSource = (
  bytes: Uint8Array,
  format: string,
  channels: readonly Pcm[],
  recognize: Recognize,
  recognition: Recognition,
): MeetingTranscriptionSource => {
  const durationMs = durationMsOf(channels)
  const hash = createHash("sha256").update(bytes).digest("hex")
  return {
    describe: async () => ({
      id: hash.slice(0, 32),
      contentHash: hash,
      size: bytes.byteLength,
      durationMs,
      format,
      sampleRate: channels[0]?.rate ?? 8000,
      channels: channels.length,
      recognition: { ...recognition, timing: "recognition-segments" },
    }),
    async *segments() {
      const pieces: TimedText[][] = []
      for (const channel of channels) pieces.push(await recognize(channel))
      yield* dialogue(pieces, durationMs)
    },
  }
}

/** The recording kept on this computer, else downloaded from the call's fresh link and, when the owner keeps them, kept. */
const recordingOf = async (ports: TranscribePorts, callId: string) => {
  const kept = await ports.recordings.find(callId)
  if (kept) return { bytes: new Uint8Array(await readFile(kept)), format: kept.slice(kept.lastIndexOf(".") + 1), kept }
  const record = await ports.record(callId)
  if (!record?.CALL_RECORD_URL) return null
  const { bytes, extension } = await ports.recordings.fetch(record)
  return { bytes, format: extension, record, extension }
}

/** Calls the query names that have no transcript yet, newest first; one that fails is reported and the rest go on. */
export const transcribeCalls = async (
  ports: TranscribePorts,
  options: TranscribeOptions,
): Promise<TranscribeReport> => {
  const { store, accountId } = ports
  const calls = (await store.meetings({ accountId, query: options.query })).sort(
    (a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0),
  )
  const pending = []
  const report: TranscribeReport = { transcribed: 0, audio_ms: 0, failed: [], remaining: 0, stopped: false }
  const failed = (meeting: number, reason: string, message: string): FailedCall => ({
    meeting,
    ref: formatMeetingReference({ type: "meeting", accountId, meetingId: meeting }),
    reason,
    message,
  })
  for (const call of calls) {
    const details = await store.meeting(call.id)
    if (!details || !(options.replace || details.transcripts.length === 0)) continue
    if ((call.durationMs ?? 0) > LONGEST_CALL_MS)
      report.failed.push(failed(call.id, "recording.too-long", "the call is longer than 60 minutes"))
    else pending.push(call)
  }
  // A call with no recording costs one read of the portal, so it does not count against the limit.
  let tried = 0
  for (const [index, call] of pending.entries()) {
    if (tried >= options.limit || options.signal?.aborted) {
      report.remaining = pending.length - index
      report.stopped = tried < options.limit
      break
    }
    const step = `${tried + 1}/${Math.min(pending.length, options.limit)} meeting ${call.id}`
    try {
      tried++
      const found = await recordingOf(ports, call.externalId)
      if (!found) {
        tried--
        report.failed.push(failed(call.id, "recording.missing", "the call has no recording on the portal"))
        options.progress?.(`${step} failed: recording.missing`)
        continue
      }
      const channels = await ports.decode(found.bytes)
      const source = transcriptionSource(found.bytes, found.format, channels, ports.recognize, ports.recognition)
      const now = (options.now ?? Date.now)()
      await transcribeMeeting(source, store, { accountId, externalId: call.externalId, now }, { apply: true })
      if (ports.keep && found.record && found.extension) {
        const path = await ports.recordings.write(call.externalId, found.bytes, found.extension)
        await keepAttachment(store, call.id, attachmentOf(path, found.bytes.byteLength, found.record), now)
      }
      report.transcribed++
      report.audio_ms += durationMsOf(channels)
      options.progress?.(`${step} transcribed`)
    } catch (error) {
      // The run's deadline stops a download or a recognition halfway, whatever error that throws; the calls finished
      // so far are the answer, not a failure.
      if (options.signal?.aborted) {
        report.remaining = pending.length - index
        report.stopped = true
        break
      }
      if (isCliError(error) && error.code === "cancelled") throw error
      const reason = isCliError(error) ? (error.details.reason ?? error.code) : "unexpected"
      report.failed.push(
        failed(
          call.id,
          String(reason),
          // Only b24's and cli-core's own errors are worded for the answer; any other may carry a path or a link.
          isCliError(error) ? error.message : "the call could not be transcribed",
        ),
      )
      options.progress?.(`${step} failed: ${reason}`)
    }
  }
  return report
}

/** Names the kept file as the call's attachment, so `meetings show` gives its `local_path`. */
const keepAttachment = async (
  store: MeetingStore,
  id: number,
  attachment: ReturnType<typeof attachmentOf>,
  now: number,
) => {
  const details = await store.meeting(id)
  if (!details) return
  const {
    id: _,
    createdAt,
    updatedAt,
    meetingSeriesId,
    eventId,
    participantsCount,
    manager,
    direction,
    clientPhone,
    ...meeting
  } = details.meeting
  await store.saveMeeting({ meeting, attachments: [attachment], now })
}
