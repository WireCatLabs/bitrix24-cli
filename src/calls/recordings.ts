import { chmod, mkdir, readdir, rename, stat, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { CliError, resolvePaths } from "@wirecat/cli-base"
import type { MeetingSave } from "@wirecat/cli-core/meetings"
import { IDENTITY } from "../identity.js"
import type { CallRecord } from "./source.js"

/** cli-core's decoder reads a compressed file of at most 64 MB; an hour of call audio is far less. */
export const LARGEST_RECORDING = 64 * 1024 * 1024

const EXTENSIONS: Record<string, string> = {
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/wave": "wav",
  "audio/ogg": "ogg",
  "audio/mp4": "m4a",
}

const mimeOf = (type: string | null) => (type ?? "").split(";")[0]?.trim().toLowerCase() ?? ""

/** A type that names no format, as a telephony provider's server sends a recording (Beeline cloud PBX, live). */
const UNNAMED = new Set(["", "application/octet-stream", "binary/octet-stream"])

/**
 * The audio format the answer names: its type, else, when the type names none, the extension of the file name in
 * `Content-Disposition`. The decoder reads the format from the bytes again, so a wrong name fails there.
 */
const extensionOf = (type: string | null, disposition: string | null | undefined) => {
  const named = EXTENSIONS[mimeOf(type)]
  if (named || !UNNAMED.has(mimeOf(type))) return named
  const extension = /filename\*?=[^;]*\.([a-z0-9]{2,4})["']?\s*(?:;|$)/i.exec(disposition ?? "")?.[1]?.toLowerCase()
  return extension && extension in MIMES ? extension : undefined
}
const MIMES: Record<string, string> = { mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", m4a: "audio/mp4" }

/** b24's own state folder, one folder per profile, so Desktop plays a call from the file `meetings show` names. */
export const recordingsFolder = (env: NodeJS.ProcessEnv, profile: string): string =>
  join(resolvePaths({ appName: IDENTITY.appName, prefix: IDENTITY.envPrefix, env }).state, "recordings", profile)

const baseName = (callId: string) => callId.replace(/[^A-Za-z0-9._-]/g, "_")

export type Attachment = NonNullable<MeetingSave["attachments"]>[number]

export const attachmentOf = (path: string, size: number, record: Pick<CallRecord, "CALL_ID" | "RECORD_FILE_ID">) => {
  const name = path.slice(path.lastIndexOf("/") + 1)
  return {
    position: 0,
    kind: "recording",
    mime: MIMES[name.slice(name.lastIndexOf(".") + 1)] ?? null,
    name,
    title: null,
    url: null,
    size,
    width: null,
    height: null,
    duration: null,
    providerRef: { callId: record.CALL_ID, recordFileId: record.RECORD_FILE_ID ?? null },
    localPath: path,
    text: null,
    normalizedText: null,
    extraction: null,
    extractor: null,
    extractionError: null,
    contentSha256: null,
    extractedAt: null,
  } satisfies Attachment
}

export interface Recordings {
  /** The file kept for this call before, if any. */
  find(callId: string): Promise<string | null>
  /** The recording behind a call's fresh link, its format read from the answer. */
  fetch(record: CallRecord): Promise<{ bytes: Uint8Array; extension: string }>
  /** Writes the recording for the owner only, under the call's id. */
  write(callId: string, bytes: Uint8Array, extension: string): Promise<string>
  /** The call's recording as an attachment: kept before, else downloaded now; null when the call has none. */
  keep(callId: string, fresh: () => Promise<CallRecord | null>): Promise<Attachment | null>
}

export const recordingsAt = (
  folder: string,
  download: (
    link: string,
    maxBytes: number,
  ) => Promise<{ bytes: Uint8Array; type: string | null; disposition?: string | null }>,
): Recordings => {
  let listed: Promise<string[]> | undefined
  const files = () => (listed ??= readdir(folder).catch(() => []))
  const find = async (callId: string) => {
    const found = (await files()).find((name) => name.startsWith(`${baseName(callId)}.`) && !name.endsWith(".partial"))
    return found ? join(folder, found) : null
  }
  const fetch = async (record: CallRecord) => {
    if (!record.CALL_RECORD_URL)
      throw new CliError("not_found", `call ${record.CALL_ID} has no recording on the portal`, {
        reason: "recording.missing",
      })
    const { bytes, type, disposition } = await download(record.CALL_RECORD_URL, LARGEST_RECORDING)
    const extension = extensionOf(type, disposition)
    if (!extension)
      throw new CliError(
        "invalid_response",
        `the portal sent call ${record.CALL_ID}'s recording as ${mimeOf(type) || "an unnamed type"}, not audio`,
        {
          reason: "recording.not-audio",
        },
      )
    return { bytes, extension }
  }
  const write = async (callId: string, bytes: Uint8Array, extension: string) => {
    await mkdir(folder, { recursive: true, mode: 0o700 })
    const path = join(folder, `${baseName(callId)}.${extension}`)
    const partial = `${path}.partial`
    await writeFile(partial, bytes, { mode: 0o600 })
    await chmod(partial, 0o600)
    await rename(partial, path)
    ;(await files()).push(path.slice(folder.length + 1))
    return path
  }
  return {
    find,
    fetch,
    write,
    async keep(callId, fresh) {
      const kept = await find(callId)
      if (kept) return attachmentOf(kept, (await stat(kept)).size, { CALL_ID: callId })
      const record = await fresh()
      if (!record) return null
      const { bytes, extension } = await fetch(record)
      return attachmentOf(await write(callId, bytes, extension), bytes.byteLength, record)
    },
  }
}
