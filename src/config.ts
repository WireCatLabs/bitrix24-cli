import { type Configuration, commandPathKey, commandPermissions, settingsFor } from "@wirecat/cli-core/cli"
import { API_DEFAULTS, API_KEYS } from "./api-keys.js"
import { IDENTITY } from "./identity.js"

/**
 * Assigning a record to another employee tells that employee in Bitrix24 by itself, so it is its own key, denied
 * until the owner allows it (WC-PERM-22). Assigning to the webhook's own user tells nobody.
 */
export const ASSIGN_KEY = "crm.assign-others"

/** `api list` and `show` never reach the portal; `api call` names its method only in its arguments and checks it itself. */
const keyOf = (path: readonly string[]) =>
  path[0] === "api" && ["call", "list", "show"].includes(path[1] ?? "") ? null : commandPathKey(path)

export const permissions = commandPermissions({
  keyOf,
  extra: [ASSIGN_KEY, ...API_KEYS],
  defaults: { [ASSIGN_KEY]: "deny", ...API_DEFAULTS },
})

export const configuration: Configuration = settingsFor(IDENTITY, { permissions })
