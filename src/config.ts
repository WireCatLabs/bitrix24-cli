import { type Configuration, commandPathKey, commandPermissions, settingsFor } from "@wirecat/cli-core/cli"
import { CRM_WRITE_DEFAULTS, CRM_WRITE_KEYS, crmAlsoChecks } from "@wirecat/cli-core/crm"
import { API_DEFAULTS, API_KEYS, apiKeysOf, crmApiKeys } from "./api-keys.js"
import { IDENTITY } from "./identity.js"

/** `api list` and `show` never reach the portal; `api call` names its method only in its arguments and checks it itself. */
const keyOf = (path: readonly string[]) =>
  path[0] === "api" && ["call", "list", "show"].includes(path[1] ?? "") ? null : commandPathKey(path)

const crmChecks = crmAlsoChecks(crmApiKeys)

export const permissions = commandPermissions({
  keyOf,
  alsoChecks: (path) => [...crmChecks(path), ...apiKeysOf(path)],
  extra: [...CRM_WRITE_KEYS, ...API_KEYS],
  defaults: { ...CRM_WRITE_DEFAULTS, ...API_DEFAULTS },
})

export const configuration: Configuration = settingsFor(IDENTITY, { permissions })
