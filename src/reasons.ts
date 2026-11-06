import { defineReasons } from "@wirecat/cli-base/standards"
import { CORE_REASONS } from "@wirecat/cli-core"

/**
 * cli-core's registry refuses a reason listed twice, on every error path, and core is adding CRM reasons of its own
 * (`pipeline.not-found` in 0.586.0); its own entry wins.
 */
const CORE = new Set(CORE_REASONS.map((one) => one.reason))

const NAMED = ["deal", "lead", "person", "organization", "pipeline", "stage"].flatMap(
  (word): [string, string, string][] => [
    [`${word}.ambiguous`, "validation_error", `more than one ${word} has that name; name one by its id`],
    [`${word}.not-found`, "not_found", `no ${word} has exactly that name`],
  ],
)

/** b24's own reasons; the shared ones (`offline.refused`, `query.*`) are cli-core's and cli-base's. */
const OWN: [reason: string, code: string, message: string][] = [
  ["webhook.malformed", "validation_error", "that is not a Bitrix24 incoming webhook address"],
  ["webhook.missing", "authentication_error", "this profile has no webhook; sign in first"],
  ["webhook.refused", "authentication_error", "Bitrix24 refused this webhook"],
  ["webhook.scope-missing", "permission_error", "the webhook has no scope for this method"],
  ["bitrix.access-denied", "permission_error", "the webhook's user may not do this"],
  ["method.unknown", "not_found", "Bitrix24 does not know this method, or the webhook has no scope for it"],
  ["operation.reused", "conflict", "this operation id was already used for a different request"],
  ["query.bad-value", "validation_error", "a query term takes an id or a number"],
  ["field.unknown-kind", "validation_error", "fields are listed for deals, leads, people and organizations"],
  ["field.ambiguous", "validation_error", "more than one custom field has that label; name one by its code"],
  ["field.unknown", "validation_error", "no custom field has that label or code"],
  ["field.unknown-option", "validation_error", "the list field has no option with that label or id"],
  ["field.not-filterable", "validation_error", "the portal cannot filter a list by this custom field"],
  ...NAMED,
]

const ENTRIES = OWN.filter(([reason]) => !CORE.has(reason))

export const REASONS = defineReasons(ENTRIES.map(([reason, code, message]) => ({ reason, code, message, details: [] })))

/** Detail keys b24's errors carry beyond cli-core's own. */
export const DETAILS = ["fields", "field"]
