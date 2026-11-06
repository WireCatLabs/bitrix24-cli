import { CliError } from "@wirecat/cli-base"
import * as v from "valibot"
import type { BitrixTransport } from "../bitrix/transport.js"
import { type Condition, rest2Filter } from "./conditions.js"
import { fullName, id, ids, type Raw, text, yes } from "./values.js"
import { type Window, walk } from "./walk.js"

/** An employee of the portal: who a record is assigned to. */
export const userSchema = v.strictObject({
  id: v.string(),
  name: v.nullable(v.string()),
  email: v.nullable(v.string()),
  position: v.nullable(v.string()),
  active: v.boolean(),
  department_ids: v.array(v.string()),
})

export type User = v.InferOutput<typeof userSchema>

export const USER_FIELDS = {
  name: { field: "NAME_SEARCH", kind: "text" },
  active: { field: "ACTIVE", kind: "text" },
} as const

export const fromBitrixUser = (raw: Raw): User => ({
  id: id(raw.ID) ?? "",
  name: fullName(raw.NAME, raw.LAST_NAME),
  email: text(raw.EMAIL),
  position: text(raw.WORK_POSITION),
  active: yes(raw.ACTIVE),
  department_ids: ids(raw.UF_DEPARTMENT),
})

/** `user.get` filters by whole values: `=NAME_SEARCH` is its own search over the name fields (apidocs user.get). */
const userFilter = (conditions: readonly Condition[]) => {
  const filter = rest2Filter(conditions)
  const renamed: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(filter))
    renamed[key.replace(/^=/, "")] = key === "=ACTIVE" ? value === "true" : value
  return renamed
}

export const listUsers = async (portal: BitrixTransport, conditions: readonly Condition[], window: Window) => {
  const { items, has_more } = await walk(window, 50, async (start) => {
    const answer = await portal.call("user.get", {
      FILTER: userFilter(conditions),
      sort: "ID",
      order: "ASC",
      start,
    })
    return { rows: Array.isArray(answer.result) ? (answer.result as Raw[]) : [], more: answer.next !== undefined }
  })
  return { items: items.map(fromBitrixUser), has_more }
}

export const getUser = async (portal: BitrixTransport, reference: string): Promise<User> => {
  const answer = await portal.call("user.get", { FILTER: { ID: Number(reference) } })
  const found = Array.isArray(answer.result) ? (answer.result as Raw[])[0] : undefined
  if (!found) throw new CliError("not_found", `there is no user ${reference}`)
  return fromBitrixUser(found)
}
