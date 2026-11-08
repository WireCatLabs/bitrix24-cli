import { CliError } from "@wirecat/cli-base"
import { parseApiJson } from "@wirecat/cli-core/cli"

export type Body = Readonly<Record<string, unknown>>

const refused = (message: string) =>
  new CliError("validation_error", message, { param: "--body", reason: "body.invalid", sent: false })

/** `parseApiJson` keeps every number as its JSON text, so an id past 2^53 is sent as typed. */
export const jsonNumber = (value: unknown): string | undefined =>
  typeof value === "object" &&
  value !== null &&
  // A body's own `{"isLosslessNumber":true}` is a plain object; the parser's numbers are class instances.
  Object.getPrototypeOf(value) !== Object.prototype &&
  "isLosslessNumber" in value &&
  value.isLosslessNumber === true &&
  "value" in value
    ? String(value.value)
    : undefined

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value) && jsonNumber(value) === undefined

/** Bitrix24 takes `stageId` and `STAGE_ID` alike: one field code in any letter case, with or without underscores. */
export const foldCode = (name: string) => name.replaceAll("_", "").toLowerCase()

/**
 * Bitrix24 takes `stageId` and `STAGE_ID` alike, and which of two it applies is not documented: a body that names a
 * key twice in any spelling is refused, so the checks and the portal cannot read it differently (NEED-2338).
 */
export const unambiguous = (value: unknown): void => {
  if (Array.isArray(value)) for (const one of value) unambiguous(one)
  if (!isRecord(value)) return
  const seen = new Map<string, string>()
  for (const [key, inner] of Object.entries(value)) {
    const other = seen.get(foldCode(key))
    if (other !== undefined)
      throw refused(`${other} and ${key} name the same Bitrix24 field, which may then take either value; keep one`)
    seen.set(foldCode(key), key)
    unambiguous(inner)
  }
}

/** `--body` as the one object every check reads and the portal is sent. */
export const parseBody = (text: string | undefined, what: string): Body => {
  if (text === undefined) return Object.freeze({})
  const parsed = parseApiJson(text)
  if (!isRecord(parsed)) throw refused(`--body takes a JSON object: ${what}`)
  unambiguous(parsed)
  return Object.freeze(parsed)
}
