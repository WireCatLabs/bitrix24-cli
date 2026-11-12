import { CliError } from "@wirecat/cli-base"
import { describe, expect, it } from "vitest"
import { readActivities } from "./activities.js"

const NOW = Date.UTC(2026, 10, 12, 12)
const SINCE = Date.UTC(2026, 10, 1)

type Answer = { result: unknown }
const portal = (answers: Record<string, (params: Record<string, unknown>) => Answer>) => {
  const calls: { method: string; params: Record<string, unknown> }[] = []
  return {
    calls,
    call: async (method: string, params: Record<string, unknown> = {}) => {
      calls.push({ method, params })
      const answer = answers[method]
      if (!answer) throw new Error(`unexpected ${method}`)
      return answer(params)
    },
  }
}

const ACTIVITY = {
  ID: "41",
  OWNER_ID: "12",
  OWNER_TYPE_ID: "2",
  TYPE_ID: "4",
  PROVIDER_ID: "CRM_EMAIL",
  SUBJECT: "Example offer",
  DESCRIPTION: "<p>Hello,<br>the offer &amp; terms</p>",
  DESCRIPTION_TYPE: "3",
  DEADLINE: "2026-11-13T10:00:00+03:00",
  COMPLETED: "N",
  RESPONSIBLE_ID: "7",
  CREATED: "2026-11-10T09:00:00+03:00",
  LAST_UPDATED: "2026-11-11T09:00:00+03:00",
}

describe("Bitrix24 activities and tasks", () => {
  it("reads activities on deals and leads by id, never the client's phone or e-mail, then the tasks", async () => {
    const fake = portal({
      "crm.activity.list": ({ filter }) => ({
        result: (filter as Record<string, number>)[">ID"] === 0 ? [ACTIVITY] : [],
      }),
    })
    const first = await readActivities(fake, NOW, SINCE, undefined)
    expect(first).toEqual({
      items: [
        {
          externalId: "activity:41",
          kind: "email",
          subject: "Example offer",
          body: "Hello,\nthe offer & terms",
          dueAt: Date.parse("2026-11-13T07:00:00Z"),
          done: false,
          assignee: "7",
          createdAt: Date.parse("2026-11-10T06:00:00Z"),
          updatedAt: Date.parse("2026-11-11T06:00:00Z"),
          on: [{ kind: "deal", externalId: "12" }],
        },
      ],
      hasMore: true,
      nextCursor: "activity:41",
    })
    expect(fake.calls[0]?.params.select).not.toContain("COMMUNICATIONS")
    expect(fake.calls[0]?.params.filter).toMatchObject({ "@OWNER_TYPE_ID": [1, 2] })

    expect(await readActivities(fake, NOW, SINCE, "activity:41")).toEqual({
      items: [],
      hasMore: true,
      nextCursor: "task:0",
    })
  })

  it("reads only the activities on the given deals and leads, fifty at a time, then the tasks", async () => {
    const fake = portal({
      "crm.activity.list": ({ filter }) => ({
        result: (filter as Record<string, number>)[">ID"] === 0 ? [ACTIVITY] : [],
      }),
    })
    const deals = Array.from({ length: 51 }, (_, at) => String(at + 1))
    const owners = async () => ({ deal: deals, lead: ["9"] })
    const read = (page?: string) => readActivities(fake, NOW, SINCE, page, undefined, owners)

    expect(await read(undefined)).toMatchObject({ nextCursor: "activity:0:41" })
    expect(fake.calls[0]?.params.filter).toMatchObject({
      BINDINGS: deals.slice(0, 50).map((owner) => ({ OWNER_TYPE_ID: 2, OWNER_ID: Number(owner) })),
    })
    expect(await read("activity:0:41")).toMatchObject({ items: [], nextCursor: "activity:1:0" })
    expect(await read("activity:1:0")).toMatchObject({ nextCursor: "activity:1:41" })
    expect(fake.calls[2]?.params.filter).toMatchObject({ BINDINGS: [{ OWNER_TYPE_ID: 2, OWNER_ID: 51 }] })
    await read("activity:1:41")
    expect(await read("activity:2:0")).toMatchObject({ nextCursor: "activity:2:41" })
    expect(fake.calls[4]?.params.filter).toMatchObject({ BINDINGS: [{ OWNER_TYPE_ID: 1, OWNER_ID: 9 }] })
    expect(await read("activity:2:41")).toMatchObject({ nextCursor: "task:0" })
  })

  it("asks a contact's activity bound to a deal for its deals and leads", async () => {
    const fake = portal({
      "crm.activity.list": () => ({ result: [{ ...ACTIVITY, OWNER_TYPE_ID: "3", OWNER_ID: "77" }] }),
      "crm.activity.binding.list": () => ({
        result: [
          { entityTypeId: 3, entityId: 77 },
          { entityTypeId: 2, entityId: 12 },
        ],
      }),
    })
    const owners = async () => ({ deal: ["12"], lead: [] })
    const { items } = await readActivities(fake, NOW, SINCE, undefined, undefined, owners)
    expect(items.map(({ on }) => on)).toEqual([[{ kind: "deal", externalId: "12" }]])
    expect(fake.calls[1]?.params).toEqual({ activityId: 41 })
  })

  it("goes straight to the tasks when the user has no deal or lead", async () => {
    const fake = portal({})
    const none = async () => ({ deal: [], lead: [] })
    expect(await readActivities(fake, NOW, SINCE, undefined, undefined, none)).toEqual({
      items: [],
      hasMore: true,
      nextCursor: "task:0",
    })
    expect(fake.calls).toEqual([])
  })

  it("keeps the tasks bound to a deal or lead, and gives the read's start as the next cursor", async () => {
    const fake = portal({
      "tasks.task.list": ({ filter }) => ({
        result: {
          tasks:
            (filter as Record<string, number>)[">ID"] === 0
              ? [
                  {
                    id: "5",
                    title: "Example contract",
                    description: "Send it",
                    deadline: null,
                    status: "5",
                    responsibleId: "7",
                    createdDate: "2026-11-10T09:00:00+03:00",
                    changedDate: "2026-11-11T09:00:00+03:00",
                    ufCrmTask: ["D_12", "C_3", "L_4"],
                  },
                  { id: "6", title: "Example", changedDate: "2026-11-11T09:00:00+03:00", ufCrmTask: ["C_3"] },
                ]
              : [],
        },
      }),
    })
    const page = await readActivities(fake, NOW, SINCE, "task:0")
    expect(page.items).toEqual([
      expect.objectContaining({
        externalId: "task:5",
        kind: "task",
        done: true,
        dueAt: null,
        on: [
          { kind: "deal", externalId: "12" },
          { kind: "lead", externalId: "4" },
        ],
      }),
    ])
    expect(page).toMatchObject({ hasMore: true, nextCursor: "task:6" })
    expect(await readActivities(fake, NOW, SINCE, "task:6")).toEqual({
      items: [],
      hasMore: false,
      cursor: String(NOW),
    })
  })

  it("a sign-in without the task scope still ends the read, and says the tasks are a gap", async () => {
    const fake = portal({
      "tasks.task.list": () => {
        throw new CliError("permission_error", "insufficient scope", { scope: "task" })
      },
    })
    const gaps: unknown[] = []
    const page = await readActivities(fake, NOW, SINCE, "task:0", { spend: () => {}, gap: (one) => gaps.push(one) })
    expect(page).toEqual({ items: [], hasMore: false, cursor: String(NOW) })
    expect(gaps).toEqual([expect.objectContaining({ kind: "activities", scope: "task" })])
  })
})
