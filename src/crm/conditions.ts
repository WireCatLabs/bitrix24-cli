import type { CrmCondition } from "@wirecat/cli-core"

/** One filter condition in Bitrix24's own field names, before it is written for REST 3.0 or REST 2. */
export interface Condition {
  field: string
  op: CrmCondition["op"] | "like"
  value: CrmCondition["value"]
}

/** A free word needs REST 2's substring match: REST 3.0 compares whole values only. */
export const needsRest2 = (conditions: readonly Condition[]) => conditions.some((one) => one.op === "like")

/**
 * REST 3.0's filter is always an array of triples: a filter that is not an array is ignored and every item comes back
 * (apidocs crm.<type>.list).
 */
export const rest3Filter = (conditions: readonly Condition[]): [string, string, CrmCondition["value"]][] =>
  conditions.map(({ field, op, value }) => {
    if (op === "like") throw new Error("a substring condition goes to REST 2")
    return [field, op, value]
  })

/** REST 2's key prefixes: `%` a substring, `@` one of a list (apidocs crm.item.list). */
const PREFIXES: Record<Condition["op"], string> = {
  like: "%",
  in: "@",
  "=": "=",
  "!=": "!=",
  ">": ">",
  ">=": ">=",
  "<": "<",
  "<=": "<=",
}

/** REST 2's filter: the operator is a prefix of the key; a word may match any of several fields, OR-ed. */
export const rest2Filter = (
  conditions: readonly Condition[],
  words: Readonly<Record<string, readonly string[]>> = {},
) => {
  const filter: Record<string, unknown> = {}
  let group = 0
  for (const { field, op, value } of conditions) {
    const alternatives = op === "like" ? words[field] : undefined
    if (alternatives && alternatives.length > 1)
      filter[String(group++)] = { logic: "OR", ...Object.fromEntries(alternatives.map((one) => [`%${one}`, value])) }
    else filter[`${PREFIXES[op]}${field}`] = value
  }
  return filter
}
