import { type Configuration, commandPathKey, commandPermissions, settingsFor } from "@wirecat/cli-core/cli"
import { IDENTITY } from "./identity.js"

/**
 * Assigning a record to another employee tells that employee in Bitrix24 by itself, so it is its own key, denied
 * until the owner allows it (WC-PERM-22). Assigning to the webhook's own user tells nobody.
 */
export const ASSIGN_KEY = "crm.assign-others"

export const permissions = commandPermissions({
  keyOf: commandPathKey,
  extra: [ASSIGN_KEY],
  defaults: { [ASSIGN_KEY]: "deny" },
})

export const configuration: Configuration = settingsFor(IDENTITY, { permissions })
