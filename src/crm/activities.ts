import { isCliError } from "@wirecat/cli-base"
import type { CrmActivity, CrmActivityKind } from "@wirecat/cli-core"
import type { CrmCallContext, CrmPage } from "@wirecat/cli-core/crm"
import type { BitrixCaller } from "../bitrix/transport.js"
import { epoch, fieldOf, id, isRaw, outcomeOf, portalTime, type Raw, rawsOf, text, yes } from "./values.js"
import { rest3Rows } from "./walk.js"

/** A change made while the last read ran is read again rather than missed: the portal's clock is not ours. */
const OVERLAP_MS = 10 * 60_000

/** CRM owner types (apidocs crm data-types): 1 lead, 2 deal. */
const OWNERS = { "1": "lead", "2": "deal" } as const

/** `TYPE_ID` (apidocs crm.activity.fields): 1 meeting, 2 call, 3 task, 4 e-mail; a to-do is told by its provider. */
const kindOf = (raw: Raw): CrmActivityKind => {
  if (raw.PROVIDER_ID === "CRM_TODO") return "todo"
  return ({ "1": "meeting", "2": "call", "3": "task", "4": "email" } as const)[String(raw.TYPE_ID)] ?? "other"
}

/** `COMMUNICATIONS` (the client's phone or e-mail) is never selected: it would bypass the daily limit on contacts. */
const ACTIVITY_SELECT = [
  "ID",
  "OWNER_ID",
  "OWNER_TYPE_ID",
  "TYPE_ID",
  "PROVIDER_ID",
  "SUBJECT",
  "DESCRIPTION",
  "DESCRIPTION_TYPE",
  "DEADLINE",
  "COMPLETED",
  "RESPONSIBLE_ID",
  "CREATED",
  "LAST_UPDATED",
]

const TASK_SELECT = [
  "ID",
  "TITLE",
  "DESCRIPTION",
  "DEADLINE",
  "STATUS",
  "RESPONSIBLE_ID",
  "CREATED_DATE",
  "CHANGED_DATE",
  "UF_CRM_TASK",
]

/** Task `status` 5 is completed (apidocs tasks.task.list, REAL_STATUS). */
const TASK_DONE = "5"

/** An e-mail's body is HTML when `DESCRIPTION_TYPE` is 3: kept as its text. */
const plain = (raw: Raw): string | null => {
  const body = text(raw.DESCRIPTION)
  if (body === null || String(raw.DESCRIPTION_TYPE) !== "3") return body
  return text(
    body
      .replace(/<(br|\/p|\/div|\/li)\b[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, "&")
      .replace(/\n{3,}/g, "\n\n"),
  )
}

/** The deal or lead an activity's own owner is, if it is one. */
const ownerOf = (raw: Raw): CrmActivity["on"] => {
  const kind = OWNERS[String(raw.OWNER_TYPE_ID) as keyof typeof OWNERS]
  const on = id(raw.OWNER_ID)
  return kind && on ? [{ kind, externalId: on }] : []
}

const activityOf = (raw: Raw, on: CrmActivity["on"] = ownerOf(raw)): CrmActivity | null => {
  const externalId = id(raw.ID)
  const updatedAt = epoch(raw.LAST_UPDATED)
  if (!externalId || on.length === 0 || updatedAt === null) return null
  return {
    externalId: `activity:${externalId}`,
    kind: kindOf(raw),
    subject: text(raw.SUBJECT) ?? "",
    body: plain(raw),
    dueAt: epoch(raw.DEADLINE),
    done: yes(raw.COMPLETED),
    assignee: id(raw.RESPONSIBLE_ID),
    createdAt: epoch(raw.CREATED) ?? updatedAt,
    updatedAt,
    on,
  }
}

/** `D_12` a deal, `L_7` a lead (apidocs tasks fields, ufCrmTask); a task on a contact or company only is left out. */
const boundTo = (value: unknown): CrmActivity["on"] =>
  (Array.isArray(value) ? value : []).flatMap((one) => {
    const match = /^(D|L)_(\d+)$/.exec(String(one))
    return match
      ? [{ kind: match[1] === "D" ? ("deal" as const) : ("lead" as const), externalId: match[2] as string }]
      : []
  })

const taskOf = (raw: Raw): CrmActivity | null => {
  const externalId = id(raw.id)
  const updatedAt = epoch(raw.changedDate)
  const on = boundTo(raw.ufCrmTask)
  if (!externalId || updatedAt === null || on.length === 0) return null
  return {
    externalId: `task:${externalId}`,
    kind: "task",
    subject: text(raw.title) ?? "",
    body: text(raw.description),
    dueAt: epoch(raw.deadline),
    done: String(raw.status) === TASK_DONE,
    assignee: id(raw.responsibleId),
    createdAt: epoch(raw.createdDate) ?? updatedAt,
    updatedAt,
    on,
  }
}

const refused = (error: unknown) =>
  isCliError(error) && (error.code === "permission_error" || error.code === "not_found")

/** The deals and leads whose activities are read, by owner type; absent, those on every deal and lead. */
export interface ActivityOwners {
  deal: readonly string[]
  lead: readonly string[]
  /** The won or lost ones (`deal:12`), with when each last changed: their comments are read only after a change. */
  closed?: ReadonlyMap<string, number>
}

/** The deals and leads assigned to these users: the ones a `mine` copy keeps. */
export const ownersOf = async (caller: BitrixCaller, assignees: readonly number[]): Promise<ActivityOwners> => {
  const closed = new Map<string, number>()
  const listed = async (type: "deal" | "lead") => {
    const params = {
      select: ["id", "stageSemanticId", "updatedTime"],
      filter: [["assignedById", "in", assignees]],
      order: { id: "ASC" },
    }
    const { items } = await rest3Rows(caller, `crm.${type}.list`, params, 500)
    return items.flatMap((raw) => {
      const one = id(raw.id)
      if (one === null) return []
      if (outcomeOf(raw.stageSemanticId) !== "open") closed.set(`${type}:${one}`, epoch(raw.updatedTime) ?? 0)
      return [one]
    })
  }
  return { deal: await listed("deal"), lead: await listed("lead"), closed }
}

/**
 * An activity found by its bindings may belong to a contact or company and only be bound to the deal, as an e-mail
 * often is (FIND-2594): its deals and leads are then asked for, one request each.
 */
const boundActivity = async (caller: BitrixCaller, raw: Raw) => {
  const own = ownerOf(raw)
  if (own.length > 0) return activityOf(raw, own)
  const answer = await caller.call("crm.activity.binding.list", { activityId: Number(raw.ID) })
  const on = rawsOf(answer.result).flatMap((one) => {
    const kind = OWNERS[String(one.entityTypeId) as keyof typeof OWNERS]
    const externalId = id(one.entityId)
    return kind && externalId ? [{ kind, externalId }] : []
  })
  return activityOf(raw, on)
}

/** Ids per `BINDINGS` filter: one list of activities per this many deals or leads. */
const OWNERS_PER_READ = 50

const groupsOf = (owners: Pick<ActivityOwners, "deal" | "lead">) =>
  (["deal", "lead"] as const).flatMap((kind) => {
    const all = [...owners[kind]]
    return Array.from({ length: Math.ceil(all.length / OWNERS_PER_READ) }, (_, at) => ({
      type: kind === "deal" ? 2 : 1,
      ids: all.slice(at * OWNERS_PER_READ, (at + 1) * OWNERS_PER_READ),
    }))
  })

/** A task's binding to a deal is `D_<id>`, to a lead `L_<id>`; the filter takes a list of them (seen live 2026-11-13). */
const taskGroupsOf = (owners: ActivityOwners) => {
  const all = [...owners.deal.map((one) => `D_${one}`), ...owners.lead.map((one) => `L_${one}`)]
  return Array.from({ length: Math.ceil(all.length / OWNERS_PER_READ) }, (_, at) =>
    all.slice(at * OWNERS_PER_READ, (at + 1) * OWNERS_PER_READ),
  )
}

/** A comment's text keeps its words: `[B]`, `[URL=…]` and the other BB codes are dropped, a link's address too. */
const words = (value: unknown) => text(String(value ?? "").replace(/\[\/?[a-z]+(=[^\]]*)?\]/gi, ""))

const commentOf = (raw: Raw, on: CrmActivity["on"][number]): CrmActivity | null => {
  const externalId = id(raw.ID)
  const createdAt = epoch(raw.CREATED)
  if (!externalId || createdAt === null) return null
  return {
    externalId: `comment:${externalId}`,
    kind: "comment",
    subject: "",
    body: words(raw.COMMENT),
    done: true,
    assignee: id(raw.AUTHOR_ID),
    createdAt,
    updatedAt: createdAt,
    on: [on],
  }
}

/** One page of `crm.timeline.comment.list`, fixed by the portal (apidocs crm.timeline.comment.list). */
const COMMENTS_PAGE = 50

/**
 * The timeline comments on the open deals and leads, and on the closed ones changed since `since`. The portal gives
 * them one deal or lead per request and ignores a filter on their id or time (seen live 2026-11-13), so each is read
 * whole, by offset (`comment:<index>:<start>`), and those older than the read are left out. A comment is not a
 * change of its deal, so one on a deal closed and left alone waits until the deal changes; an edited comment keeps its
 * first text.
 */
const readComments = async (
  caller: BitrixCaller,
  owners: ActivityOwners | null,
  since: number,
  parts: string[],
  cursor: string,
): Promise<CrmPage<CrmActivity>> => {
  const done: CrmPage<CrmActivity> = { items: [], hasMore: false, cursor }
  if (!owners) return done
  const from = since - OVERLAP_MS
  const quiet = (kind: string, one: string) => (owners.closed?.get(`${kind}:${one}`) ?? Infinity) < from
  const read = (["deal", "lead"] as const).flatMap((kind) =>
    owners[kind].filter((one) => !quiet(kind, one)).map((externalId) => ({ kind, externalId })),
  )
  const index = Number(parts[1]) || 0
  const start = Number(parts[2]) || 0
  const on = read[index]
  if (!on) return done
  const answer = await caller.call("crm.timeline.comment.list", {
    filter: { ENTITY_ID: Number(on.externalId), ENTITY_TYPE: on.kind },
    select: ["ID", "CREATED", "AUTHOR_ID", "COMMENT"],
    order: { ID: "ASC" },
    start,
  })
  const rows = rawsOf(answer.result)
  const items = rows
    .map((raw) => commentOf(raw, on))
    .filter((one): one is CrmActivity => one !== null && one.createdAt >= from)
  if (rows.length === COMMENTS_PAGE && answer.next !== undefined)
    return { items, hasMore: true, nextCursor: `comment:${index}:${start + COMMENTS_PAGE}` }
  return index + 1 < read.length ? { items, hasMore: true, nextCursor: `comment:${index + 1}:0` } : { ...done, items }
}

/**
 * The activities on deals and leads, then the tasks bound to them, changed since `since`: REST 2 lists, paged by id
 * (`activity:<last id>`, then `task:<last id>`) so a row changed mid-read never shifts the rest. With `owners`, only
 * the activities and tasks bound to those, `OWNERS_PER_READ` at a time (`activity:<group>:<last id>`,
 * `task:<group>:<last id>`), then their timeline comments: a first read of a large portal otherwise lists every
 * activity and task of 90 days to keep a few (PERF-106, DEBT-348). A webhook without the `task` scope still reads the
 * activities and comments; the tasks are a gap.
 */
export const readActivities = async (
  caller: BitrixCaller,
  started: number,
  since: number,
  page: string | undefined,
  context?: CrmCallContext,
  owners?: () => Promise<ActivityOwners>,
): Promise<CrmPage<CrmActivity>> => {
  const after = portalTime(since - OVERLAP_MS)
  const parts = (page ?? "activity").split(":")
  const list = parts[0]
  const cursor = String(started)
  if (list === "activity") {
    const groups = owners ? groupsOf(await owners()) : null
    const group = groups && parts.length === 3 ? Number(parts[1]) || 0 : 0
    const from = groups && parts.length !== 3 ? 0 : Number(parts.at(-1)) || 0
    const at = groups?.[group]
    if (groups && !at) return { items: [], hasMore: true, nextCursor: "task:0" }
    const answer = await caller.call("crm.activity.list", {
      order: { ID: "ASC" },
      filter: {
        ">ID": from,
        ...(at
          ? { BINDINGS: at.ids.map((owner) => ({ OWNER_TYPE_ID: at.type, OWNER_ID: Number(owner) })) }
          : { "@OWNER_TYPE_ID": [1, 2] }),
        ">=LAST_UPDATED": after,
      },
      select: ACTIVITY_SELECT,
      start: 0,
    })
    const rows = rawsOf(answer.result)
    const items = (
      at ? await Promise.all(rows.map((raw) => boundActivity(caller, raw))) : rows.map((raw) => activityOf(raw))
    ).filter((one): one is CrmActivity => one !== null)
    const lastId = id(rows.at(-1)?.ID)
    if (!groups) return { items, hasMore: true, nextCursor: lastId ? `activity:${lastId}` : "task:0" }
    const next = lastId
      ? `activity:${group}:${lastId}`
      : group + 1 < groups.length
        ? `activity:${group + 1}:0`
        : "task:0"
    return { items, hasMore: true, nextCursor: next }
  }
  if (list === "comment") return readComments(caller, owners ? await owners() : null, since, parts, cursor)
  const refs = owners ? taskGroupsOf(await owners()) : null
  const group = refs && parts.length === 3 ? Number(parts[1]) || 0 : 0
  const from = refs && parts.length !== 3 ? 0 : Number(parts.at(-1)) || 0
  const ended: CrmPage<CrmActivity> = refs
    ? { items: [], hasMore: true, nextCursor: "comment:0:0" }
    : { items: [], hasMore: false, cursor }
  const at = refs?.[group]
  if (refs && !at) return ended
  let answer: Awaited<ReturnType<BitrixCaller["call"]>>
  try {
    answer = await caller.call("tasks.task.list", {
      order: { ID: "asc" },
      // Without a copy's deals and leads, tasks bound to neither are dropped here: no filter asks for a binding's type.
      filter: { ">ID": from, ">=CHANGED_DATE": after, ...(at ? { UF_CRM_TASK: at } : {}) },
      select: TASK_SELECT,
      start: 0,
    })
  } catch (error) {
    if (!refused(error)) throw error
    const scope = isCliError(error) ? error.details?.scope : undefined
    context?.gap({
      kind: "activities",
      message: "the sign-in may not read Bitrix24 tasks (the task scope): the activities were read, the tasks were not",
      ...(typeof scope === "string" ? { scope } : { scope: "task" }),
    })
    return ended
  }
  const tasks = rawsOf(fieldOf(answer.result, "tasks")).filter(isRaw)
  const items = tasks.map(taskOf).filter((one): one is CrmActivity => one !== null)
  const lastId = id(tasks.at(-1)?.id)
  if (!refs) return lastId ? { items, hasMore: true, nextCursor: `task:${lastId}` } : { items, hasMore: false, cursor }
  if (lastId) return { items, hasMore: true, nextCursor: `task:${group}:${lastId}` }
  return group + 1 < refs.length ? { items, hasMore: true, nextCursor: `task:${group + 1}:0` } : { ...ended, items }
}
