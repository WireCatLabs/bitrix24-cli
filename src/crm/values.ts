import { CliError } from "@wirecat/cli-base"
import { crmValues, type StageOutcome } from "@wirecat/cli-core"
import { fileIdsOf } from "../file-links.js"

export type Raw = crmValues.CrmRaw

/**
 * Bitrix24's stage semantics, short (`S`, `F`) or as `EXTRA.SEMANTICS` (`success`, `failure`, `apology`, a lost group);
 * anything else is still in progress (b24restdocs api-reference/crm/status/crm-status-list.md,
 * tutorials/crm/how-to-get-lists/how-to-get-stages-with-semantics.md).
 */
const OUTCOMES = new Map<unknown, StageOutcome>([
  ["S", "won"],
  ["success", "won"],
  ["F", "lost"],
  ["failure", "lost"],
  ["apology", "lost"],
])

export const outcomeOf = (semantics: unknown): StageOutcome => OUTCOMES.get(semantics) ?? "open"

/** `Number("anna")` is NaN, which goes out as null: Bitrix24 may then read the call as having no id at all. */
export const numericId = (value: string, what: string): number => {
  if (!/^(0|[1-9][0-9]*)$/.test(value))
    throw new CliError("validation_error", `${what} takes a number, such as 7`, { reason: "id.invalid", sent: false })
  return Number(value)
}

export const yes = (value: unknown): boolean => value === true || value === "Y" || value === "1" || value === 1

/** A portal import can leave `null` or `null #<id>` in a name field: 101,876 contacts on one live portal. */
const PLACEHOLDER = /(?:^|\s)null(?:\s+#\d+)?(?=\s|$)/gi

export const fullName = (...parts: unknown[]): string | null =>
  parts
    .map((part) => crmValues.text(crmValues.text(part)?.replace(PLACEHOLDER, "")))
    .filter((part): part is string => part !== null)
    .join(" ") || null

export interface Contact {
  type: string | null
  value: string
}

/** REST 3.0 `phone` and `email`: `[{ valueTypeId, value }]`, the type as the portal names it (`WORK`, `MOBILE`). */
export const contacts = (value: unknown): Contact[] =>
  Array.isArray(value)
    ? value.flatMap((one) => {
        const found = crmValues.text(crmValues.fieldOf(one, "value"))
        return found === null ? [] : [{ type: crmValues.text(crmValues.fieldOf(one, "valueTypeId")), value: found }]
      })
    : []

/** The kind of each phone and address, by the value, as the port's `contactTypes` keeps it; absent when none has one. */
export const contactTypesOf = (all: readonly Contact[]): { contactTypes?: Record<string, string> } => {
  const typed = all.flatMap(({ type, value }) => (type === null ? [] : [[value, type] as const]))
  return typed.length ? { contactTypes: Object.fromEntries(typed) } : {}
}

const CUSTOM = /^(UF_CRM_|ufCrm)/

/** A portal's own field, not its read-only `_data` twin. */
export const isCustom = (name: string) => CUSTOM.test(name) && !name.endsWith("_data")

const empty = (value: unknown) => value === null || value === "" || (Array.isArray(value) && value.length === 0)

/**
 * The portal's own fields that hold a value, as it names them: their meaning is the portal owner's, so they stay
 * unmapped. `false` and `0` stay, since a yes/no field saying no is an answer. A file stays as its id (`fileIdsOf`).
 */
export const customFields = (raw: unknown): Record<string, unknown> =>
  crmValues.isRaw(raw)
    ? Object.fromEntries(
        Object.entries(raw).flatMap(([key, value]) => {
          const kept = isCustom(key) ? fileIdsOf(value) : undefined
          return kept === undefined || empty(kept) ? [] : [[key, kept]]
        }),
      )
    : {}

/**
 * A filter's time as REST 3.0 takes it, whole seconds with an offset: a live portal refused a filter with
 * `toISOString()`'s milliseconds and `Z` (REQUESTVALIDATIONEXCEPTION, 2026-11-07).
 */
export const portalTime = (ms: number) =>
  new Date(Math.floor(ms / 1000) * 1000).toISOString().replace(".000Z", "+00:00")
