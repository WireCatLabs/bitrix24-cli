import { CliError, isCliError } from "@wirecat/cli-base"
import {
  type CrmCallContext,
  type CrmField,
  type CrmFileOwner,
  type CrmFileSourceKind,
  type CrmFiles,
  type CrmOpenableFile,
  crmFileId,
  crmValues,
  walk,
} from "@wirecat/cli-core"
import type { BitrixCaller } from "../bitrix/transport.js"
import { EVERY, rest2Rows } from "./rows.js"
import type { Raw } from "./values.js"

const { epoch, fieldOf, id, isRaw, rawsOf, text } = crmValues

/** CRM object types (apidocs crm data-types, object_type): the number `crm.item.*` takes, the name the timeline does. */
const ENTITIES: Record<CrmFileOwner["kind"], { type: number; name: string }> = {
  lead: { type: 1, name: "lead" },
  deal: { type: 2, name: "deal" },
  person: { type: 3, name: "contact" },
  organization: { type: 4, name: "company" },
}

const PDF = "application/pdf"
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"

export interface FilePortal extends BitrixCaller {
  openFile(link: string, signal?: AbortSignal): Promise<ReadableStream<Uint8Array>>
}

/** A file kind the sign-in may not read: its scope missing, or the employee's rights. The other kinds still list. */
const refusedKind = (kind: string, error: unknown) =>
  isCliError(error) &&
  (error.code === "permission_error" ||
    (error.code === "not_found" && error.details.reason === "method.unknown") ||
    // The document generator answers a missing module or a missing right with code 0 (apidocs document-list), which
    // reads as a refused call.
    (kind === "document" && error.code === "validation_error"))

/** No such object, or one the webhook's employee may not see; an unknown method is a missing scope instead. */
const unseen = (error: unknown) =>
  isCliError(error) &&
  ((error.code === "not_found" && error.details.reason !== "method.unknown") ||
    (error.code === "permission_error" && error.details.reason === "bitrix.access-denied"))

const gone = (what: string) =>
  new CliError("not_found", `the portal no longer has ${what}`, { reason: "crm.file-unavailable" })

const linkOf = (value: unknown, what: string): string => {
  const link = text(value)
  if (!link) throw gone(what)
  return link
}

/** A file in a custom field: `{ id, url, urlMachine }`, alone or in a list (apidocs files/how-to-download-files#crm). */
const fieldFilesOf = (value: unknown): Raw[] =>
  (Array.isArray(value) ? value : [value]).filter(
    (one): one is Raw => isRaw(one) && id(one.id) !== null && typeof one.urlMachine === "string",
  )

/**
 * One record's files on a portal (apidocs files/how-to-download-files): its file fields from `crm.item.get`, its
 * generated documents, and the Drive files of its activities and timeline comments. Each `open` asks for a fresh link,
 * since a link may be single-use, and fetches it from the portal alone; no link leaves this file.
 */
export const recordFiles = async (
  caller: BitrixCaller,
  portal: () => FilePortal,
  owner: CrmFileOwner,
  fields: () => Promise<readonly CrmField[]>,
  context?: CrmCallContext,
): Promise<CrmFiles | null> => {
  if (!/^[1-9]\d*$/.test(owner.id)) return null
  const entity = ENTITIES[owner.kind]
  const record = { entityTypeId: entity.type, id: Number(owner.id), useOriginalUfNames: "Y" }
  const read = async (via: BitrixCaller) => fieldOf((await via.call("crm.item.get", record)).result, "item")
  let item: unknown
  try {
    item = await read(caller)
  } catch (error) {
    if (unseen(error)) return null
    throw error
  }
  if (!isRaw(item)) return null
  const file = (
    source: CrmFileSourceKind,
    providerId: string,
    shown: { name: string; size?: unknown; mime?: string | null; created?: unknown },
    link: (signal?: AbortSignal) => Promise<string>,
  ): CrmOpenableFile => {
    const size = Number(shown.size)
    return {
      id: crmFileId(owner, source, providerId),
      name: shown.name,
      size: shown.size === undefined || shown.size === null || !Number.isFinite(size) ? null : size,
      mime: shown.mime ?? null,
      created: epoch(shown.created),
      owner,
      source,
      open: async (signal) => portal().openFile(await link(signal), signal),
    }
  }
  /** A Drive file's own link (apidocs disk.file.get `DOWNLOAD_URL`), asked for at each download. */
  const driveLink = async (fileId: string) => {
    let answer: unknown
    try {
      answer = (await portal().call("disk.file.get", { id: Number(fileId) })).result
    } catch (error) {
      if (unseen(error)) throw gone(`the Drive file ${fileId}`)
      throw error
    }
    return linkOf(fieldOf(answer, "DOWNLOAD_URL"), `the Drive file ${fileId}`)
  }

  const kinds: Record<Exclude<CrmFileSourceKind, "record">, () => Promise<CrmOpenableFile[]>> = {
    async field() {
      const titles = new Map((await fields()).map((one) => [one.code, one.label]))
      return Object.entries(item).flatMap(([code, value]) =>
        fieldFilesOf(value).map((one) => {
          const fileId = String(id(one.id))
          return file("field", `${code}.${fileId}`, { name: `${titles.get(code) ?? code} ${fileId}` }, async () => {
            const fresh = await read(portal())
            const again = isRaw(fresh) ? fieldFilesOf(fresh[code]).find((other) => id(other.id) === fileId) : undefined
            return linkOf(again?.urlMachine, `the file ${fileId} in ${code}`)
          })
        }),
      )
    },
    // A PDF while the portal has made one, else the Word file; never waited for (apidocs document-get: 30-40 s).
    async document() {
      const { items } = await walk(EVERY, 50, async (start) => {
        const answer = await caller.call("crm.documentgenerator.document.list", {
          select: ["id", "title", "number", "createTime", "pdfId"],
          filter: { entityTypeId: entity.type, entityId: Number(owner.id) },
          order: { id: "ASC" },
          start,
        })
        return { rows: rawsOf(fieldOf(answer.result, "documents")), more: answer.next !== undefined }
      })
      return items.flatMap((raw) => {
        const documentId = id(raw.id)
        if (!documentId) return []
        const pdf = id(raw.pdfId) !== null && id(raw.pdfId) !== "0"
        const title = text(raw.title) ?? text(raw.number) ?? `document ${documentId}`
        const shown = { name: `${title}.${pdf ? "pdf" : "docx"}`, mime: pdf ? PDF : DOCX, created: raw.createTime }
        return [
          file("document", documentId, shown, async () => {
            let answer: unknown
            try {
              answer = (await portal().call("crm.documentgenerator.document.get", { id: Number(documentId) })).result
            } catch (error) {
              if (unseen(error)) throw gone(`the document ${documentId}`)
              throw error
            }
            const document = fieldOf(answer, "document")
            return linkOf(fieldOf(document, pdf ? "pdfUrlMachine" : "downloadUrlMachine"), `the document ${documentId}`)
          }),
        ]
      })
    },
    // `FILES` holds only an id and a link (apidocs crm.activity.list); the name and size come from Drive.
    async activity() {
      const { items } = await rest2Rows(caller, "crm.activity.list", {
        filter: { BINDINGS: [{ OWNER_TYPE_ID: entity.type, OWNER_ID: Number(owner.id) }] },
        select: ["ID", "FILES"],
        order: { ID: "ASC" },
      })
      const found: CrmOpenableFile[] = []
      let unread = 0
      for (const raw of items)
        for (const one of rawsOf(raw.FILES)) {
          const fileId = id(one.id)
          const activityId = id(raw.ID)
          if (!fileId || !activityId) continue
          let drive: unknown
          try {
            drive = (await caller.call("disk.file.get", { id: Number(fileId) })).result
          } catch (error) {
            if (!unseen(error)) throw error
            unread += 1
            continue
          }
          found.push(
            file(
              "activity",
              `${activityId}.${fileId}`,
              {
                name: text(fieldOf(drive, "NAME")) ?? `file ${fileId}`,
                size: fieldOf(drive, "SIZE"),
                created: fieldOf(drive, "CREATE_TIME"),
              },
              () => driveLink(fileId),
            ),
          )
        }
      if (unread)
        context?.gap({
          kind: owner.kind,
          message: `${unread} file(s) of this record's activities are on Drive where the webhook's user may not read them`,
        })
      return found
    },
    // `FILES` is keyed by the Drive file's id, with its name and size; `urlDownload` there is for a browser only.
    async comment() {
      const { items } = await rest2Rows(caller, "crm.timeline.comment.list", {
        filter: { ENTITY_ID: Number(owner.id), ENTITY_TYPE: entity.name },
        select: ["ID", "CREATED"],
        order: { ID: "ASC" },
      })
      return items.flatMap((raw) => {
        const commentId = id(raw.ID)
        const files = fieldOf(raw, "FILES")
        if (!commentId || !isRaw(files)) return []
        return Object.values(files)
          .filter(isRaw)
          .flatMap((one) => {
            const fileId = id(one.id)
            if (!fileId) return []
            const shown = { name: text(one.name) ?? `file ${fileId}`, size: one.size, created: one.date ?? raw.CREATED }
            return [file("comment", `${commentId}.${fileId}`, shown, () => driveLink(fileId))]
          })
      })
    },
  }

  const files: CrmOpenableFile[] = []
  for (const [kind, list] of Object.entries(kinds)) {
    try {
      for (const one of await list()) files.push(one)
    } catch (error) {
      if (!refusedKind(kind, error)) throw error
      const scope = isCliError(error) && typeof error.details.scope === "string" ? error.details.scope : undefined
      context?.gap({
        kind: owner.kind,
        message: `the portal did not list this record's ${kind} files (${isCliError(error) ? error.code : "refused"})${
          scope ? `: add the ${scope} scope to the webhook` : ""
        }; the other files are listed`,
        ...(scope ? { scope } : {}),
      })
    }
  }
  return { assignee: id(item.assignedById), files }
}
