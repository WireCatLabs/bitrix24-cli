import { defineReasons } from "@wirecat/cli-base/standards"

/** Core's own CRM reasons (`pipeline.not-found`, `deal.*`) are kept as they are; these add the ones it lacks. */
const CORE = new Set(["pipeline.not-found"])

const NAMED = ["deal", "lead", "person", "organization", "pipeline", "stage"]
  .flatMap((word): [string, string, string][] => [
    [`${word}.ambiguous`, "validation_error", `more than one ${word} has that name; name one by its id`],
    [`${word}.not-found`, "not_found", `no ${word} has exactly that name`],
  ])
  .filter(([reason]) => !CORE.has(reason))

/** b24's own reasons; the shared ones (`offline.refused`, `query.*`) are cli-core's and cli-base's. */
const ENTRIES: [reason: string, code: string, message: string][] = [
  ["webhook.malformed", "validation_error", "that is not a Bitrix24 incoming webhook address"],
  ["webhook.missing", "authentication_error", "this profile has no webhook; sign in first"],
  ["webhook.refused", "authentication_error", "Bitrix24 refused this webhook"],
  ["webhook.scope-missing", "permission_error", "the webhook has no scope for this method"],
  ["bitrix.access-denied", "permission_error", "the webhook's user may not do this"],
  ["method.unknown", "not_found", "Bitrix24 does not know this method, or the webhook has no scope for it"],
  ["operation.reused", "conflict", "this operation id was already used for a different request"],
  ["query.bad-value", "validation_error", "a query term takes an id or a number"],
  ...NAMED,
]

export const REASONS = defineReasons(ENTRIES.map(([reason, code, message]) => ({ reason, code, message, details: [] })))

/** Detail keys b24's errors carry beyond cli-core's own. */
export const DETAILS = ["fields"]
