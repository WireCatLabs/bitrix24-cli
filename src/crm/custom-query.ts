import { CliError } from "@wirecat/cli-base"
import { type FieldSpec, type Predicate, parseLucene, type QueryRegistry, walkQuery } from "@wirecat/cli-base/query"
import { LIST_QUERY_GUIDE } from "@wirecat/cli-core/cli"
import { fieldNamed, optionOf, unknownField } from "@wirecat/cli-core/crm"
import type { Condition } from "./conditions.js"
import type { Field } from "./fields.js"

/** The field names a query uses that the list's own fields do not have: the portal's custom fields, if any. */
export const customNames = (
  text: string,
  registry: QueryRegistry,
  command: string,
  defaultField = "none",
): string[] => {
  if (text.trim() === "") return []
  const known = new Set(registry.fields.map((field) => field.name))
  const named = walkQuery(parseLucene(text, { defaultField, command, guide: LIST_QUERY_GUIDE }).root)
    .filter((term) => !term.implicit)
    .map((term) => term.field)
  return [...new Set(named.filter((name) => !known.has(name)))]
}

/** The custom fields a query names, each as typed, refused unless the portal can filter a list by it. */
export const filterableFields = (fields: readonly Field[], names: readonly string[]): [string, Field][] =>
  names.map((name) => {
    const field = fieldNamed(fields, name)
    if (!field.filterable)
      throw new CliError("validation_error", `the portal cannot filter a list by ${field.label ?? field.code}`, {
        reason: "field.not-filterable",
        field: field.code,
      })
    return [name, field]
  })

/** The list's query fields and the custom ones, each a whole value, so cli-base validates the query as it is. */
export const withCustomFields = (registry: QueryRegistry, chosen: readonly [string, Field][]): QueryRegistry => ({
  ...registry,
  fields: [
    ...registry.fields,
    ...chosen.map(
      ([name]): FieldSpec => ({ name, type: "kw", operators: ["term", "phrase"], example: `${name}:x`, native: true }),
    ),
  ],
})

const NUMBERS = new Set(["integer", "double"])

/**
 * REST 3.0 checks a value's type against the field's: `field.list` gives a list field as `int`, so its option id goes
 * as a number, and so does a number field's value.
 */
const filterValue = (field: Field, typed: string): string | number => {
  if (field.options) return Number(optionOf(field, typed))
  const number = Number(typed)
  return NUMBERS.has(field.type) && typed.trim() !== "" && Number.isFinite(number) ? number : typed
}

/** The custom terms as conditions on their codes, taken out of `terms` so the rest map as before. */
export const customConditions = (terms: Map<string, Predicate>, chosen: readonly [string, Field][]): Condition[] =>
  chosen.flatMap(([name, field]) => {
    const term = terms.get(name)
    terms.delete(name)
    return term ? [{ field: field.code, op: "=" as const, value: filterValue(field, term.value) }] : []
  })

/**
 * The custom fields `--json` names, as `provider_metadata.<code>`, or every one for a bare `provider_metadata`;
 * undefined when it names none.
 */
export const wantedCodes = (paths: string | undefined): string[] | "all" | undefined => {
  if (!paths) return undefined
  const parts = paths.split(",").map((path) =>
    path
      .trim()
      .replace(/^items\./, "")
      .split("."),
  )
  const metadata = parts.filter(([top]) => top === "provider_metadata")
  if (metadata.some((part) => part.length === 1)) return "all"
  const codes = metadata.flatMap(([, code]) => (code ? [code] : []))
  return codes.length ? [...new Set(codes)] : undefined
}

/** The codes to select: only those the portal lists, since REST 3.0 refuses a whole call over one unknown name. */
export const selectedCodes = (fields: readonly Field[], wanted: string[] | "all" | undefined): string[] => {
  if (wanted === undefined) return []
  if (wanted === "all") return fields.map((field) => field.code)
  return wanted.map((code) => {
    if (!fields.some((field) => field.code === code)) throw unknownField(fields, code)
    return code
  })
}
