import { CliError } from "@wirecat/cli-base"
import { annotateOption } from "@wirecat/cli-base/commands"
import { environmentOf, fieldsOf, writeCsv } from "@wirecat/cli-core/cli"
import { type Command, Option } from "commander"
import type { Field } from "../crm/fields.js"
import { isRaw } from "../crm/values.js"
import { contextOf } from "../portal.js"

/** The same `--format csv` as cli-core's `deals list`: off MCP, since a table carries no `untrusted` marker. */
export const csvFormatOption = () =>
  annotateOption(
    new Option(
      "--format <format>",
      "csv: this page as a table for a spreadsheet; --json=a,b picks its columns",
    ).choices(["csv"]),
    { mcp: false },
  )

const refuse = (message: string): never => {
  throw new CliError("validation_error", message, { reason: "output.conflict", param: "--format" })
}

/** Checked before the portal is asked: a table is for a person's spreadsheet, not for an agent or another output. */
export const refuseOtherOutput = (command: Command): void => {
  const globals = command.optsWithGlobals<{ json?: boolean; jsonl?: boolean; fields?: string }>()
  if (environmentOf(command).agent) refuse("--format csv is a table for a spreadsheet; an agent reads the JSON answer")
  if (globals.jsonl) refuse("--format csv and --jsonl ask for different output — pick one")
  if (contextOf(command).compact) refuse("--format csv and --compact ask for different output — pick one")
  if (globals.json && globals.fields === undefined)
    refuse("--format csv and --json ask for different output — --json=a,b picks the table's columns")
}

/** `--json=a,b` names the columns; without it, the item's own fields, then every custom field. */
export const csvPaths = (command: Command, schemaKeys: readonly string[]): string[] => {
  const fields = command.optsWithGlobals<{ fields?: string }>().fields
  if (fields === undefined) return [...schemaKeys.filter((key) => key !== "provider_metadata"), "provider_metadata"]
  return fieldsOf(fields).map((path) => (path.startsWith("items.") ? path.slice("items.".length) : path))
}

interface Column {
  header: string
  cell: (item: unknown) => unknown
}

const at = (item: unknown, path: readonly string[]): unknown =>
  path.reduce<unknown>((value, key) => (isRaw(value) ? value[key] : undefined), item)

/** A phone or e-mail by its value, a list joined, so no cell holds JSON a spreadsheet cannot read. */
const flat = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(flat).join("; ")
  if (isRaw(value)) return value.value ?? value.name ?? JSON.stringify(value)
  return value
}

const MONEY = /^(-?\d+(?:\.\d+)?)\|([A-Za-z]{3})$/

const customColumns = (field: Field, header: string): Column[] => {
  const value = (item: unknown) => at(item, ["provider_metadata", field.code, "value"])
  if (field.type !== "money") return [{ header, cell: (item) => flat(value(item)) }]
  const part = (index: 1 | 2) => (item: unknown) => {
    const raw = value(item)
    const money = typeof raw === "string" ? MONEY.exec(raw) : null
    return money ? money[index] : index === 1 ? flat(raw) : null
  }
  return [
    { header: `${header} amount`, cell: part(1) },
    { header: `${header} currency`, cell: part(2) },
  ]
}

const columnsOf = (fields: readonly Field[], paths: readonly string[]): Column[] => {
  const taken = new Set(paths.filter((path) => !path.startsWith("provider_metadata")))
  const labels = new Map<string, number>()
  for (const field of fields) labels.set(field.label ?? field.code, (labels.get(field.label ?? field.code) ?? 0) + 1)
  const headerOf = (field: Field) => {
    const label = field.label ?? field.code
    return (labels.get(label) ?? 0) > 1 || taken.has(label) ? `${label} (${field.code})` : label
  }
  return paths.flatMap((path) => {
    const parts = path.split(".")
    if (parts[0] !== "provider_metadata") return [{ header: path, cell: (item) => flat(at(item, parts)) }]
    const chosen = parts[1] === undefined ? fields : fields.filter((field) => field.code === parts[1])
    return chosen.flatMap((field) => customColumns(field, headerOf(field)))
  })
}

/** stdout carries the table and nothing else; the way to the next page goes to stderr. */
export const printCsv = (
  command: Command,
  page: { items: readonly unknown[]; has_more: boolean; fields: readonly Field[] },
  paths: readonly string[],
): void => {
  const { streams, renderer, settings } = contextOf(command)
  const columns = columnsOf(page.fields, paths)
  writeCsv(
    streams,
    columns.map((column) => column.header),
    page.items.map((item) => columns.map((column) => column.cell(item))),
  )
  if (page.has_more) renderer.note(`→ more rows: run it again with --page ${settings.page + 1}`)
}
