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
