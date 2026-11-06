import { CliError } from "@wirecat/cli-base"
import type { Predicate } from "@wirecat/cli-base/query"
import { timeBounds } from "@wirecat/cli-core/cli"
import { semanticsOf } from "./values.js"

export type Operator = "=" | ">" | ">=" | "<" | "<=" | "like"

/** One filter condition in Bitrix24's own field names, before it is written for REST 3.0 or REST 2. */
export interface Condition {
  field: string
  op: Operator
  value: string | number
}

/** How one query field reaches the portal: its Bitrix24 name, and how its values read. */
export interface FieldMap {
  field: string
  kind: "id" | "number" | "time" | "text" | "outcome" | "word"
}

const bare = (value: string) => value.replace(/^\*+|\*+$/g, "")

const valueFor = (kind: FieldMap["kind"], raw: string, name: string): string | number => {
  if (kind === "id" || kind === "number") {
    const found = Number(raw)
    if (!Number.isFinite(found) || (kind === "id" && !/^[1-9]\d*$/.test(raw)))
      throw new CliError("validation_error", `${name} takes ${kind === "id" ? "an id" : "a number"}; got ${raw}`, {
        reason: "query.bad-value",
      })
    return found
  }
  if (kind === "outcome") return semanticsOf(raw.toLowerCase())
  return raw
}

const range = (node: Predicate, map: FieldMap, name: string): Condition[] => {
  const out: Condition[] = []
  if (node.value !== "*")
    out.push({
      field: map.field,
      op: node.lower_inclusive === false ? ">" : ">=",
      value: valueFor(map.kind, node.value, name),
    })
  if (node.upper !== undefined && node.upper !== "*")
    out.push({
      field: map.field,
      op: node.upper_inclusive === false ? "<" : "<=",
      value: valueFor(map.kind, node.upper, name),
    })
  return out
}

/** The query's terms as conditions, AND-ed: `nativeTerms` has already refused anything the portal cannot ask. */
export const conditionsOf = (terms: ReadonlyMap<string, Predicate>, fields: Readonly<Record<string, FieldMap>>) =>
  [...terms].flatMap(([name, node]): Condition[] => {
    const map = fields[name]
    if (!map)
      throw new CliError("validation_error", `the portal cannot filter by ${name}`, {
        reason: "query.unsupported-field",
      })
    if (map.kind === "word") return [{ field: map.field, op: "like", value: bare(node.value) }]
    if (map.kind === "time") {
      const { since, until } = timeBounds(node)
      return [
        ...(since === undefined ? [] : [{ field: map.field, op: ">=" as const, value: new Date(since).toISOString() }]),
        ...(until === undefined ? [] : [{ field: map.field, op: "<=" as const, value: new Date(until).toISOString() }]),
      ]
    }
    if (node.operator === "range") return range(node, map, name)
    return [{ field: map.field, op: "=", value: valueFor(map.kind, node.value, name) }]
  })

/** A free word needs REST 2's substring match: REST 3.0 compares whole values only. */
export const needsRest2 = (conditions: readonly Condition[]) => conditions.some((one) => one.op === "like")

/**
 * REST 3.0's filter is always an array of triples: a filter that is not an array is ignored and every item comes back
 * (apidocs crm.<type>.list).
 */
export const rest3Filter = (conditions: readonly Condition[]): [string, string, string | number][] =>
  conditions.map(({ field, op, value }) => {
    if (op === "like") throw new Error("a substring condition goes to REST 2")
    return [field, op, value]
  })

/** REST 2's filter: the operator is a prefix of the key, `%` a substring match (apidocs crm.item.list). */
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
    else filter[`${op === "like" ? "%" : op === "=" ? "=" : op}${field}`] = value
  }
  return filter
}
