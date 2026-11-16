import { type Configuration, commandPathKey, commandPermissions, plain, settingsFor } from "@wirecat/cli-core/cli"
import { CRM_WRITE_DEFAULTS, CRM_WRITE_KEYS, crmAlsoChecks } from "@wirecat/cli-core/crm"
import * as v from "valibot"
import { API_DEFAULTS, API_KEYS, crmApiKeys } from "./api-keys.js"
import { IDENTITY } from "./identity.js"

/** `api list` and `show` never reach the portal; `api call` names its method only in its arguments and checks it itself. */
const keyOf = (path: readonly string[]) =>
  path[0] === "api" && ["call", "list", "show"].includes(path[1] ?? "") ? null : commandPathKey(path)

export const permissions = commandPermissions({
  keyOf,
  alsoChecks: crmAlsoChecks(crmApiKeys),
  extra: [...CRM_WRITE_KEYS, ...API_KEYS],
  defaults: { ...CRM_WRITE_DEFAULTS, ...API_DEFAULTS },
})

export const DOWNLOAD_RECORDINGS = "download_recordings"
export const PHONE_REGION = "phone_region"

const REGIONS = /^\s*[a-z]{2}(\s*,\s*[a-z]{2})*\s*$/i

export const configuration: Configuration = settingsFor(IDENTITY, {
  permissions,
  profile: {
    [DOWNLOAD_RECORDINGS]: v.optional(v.boolean(plain("has to be true or false"))),
    [PHONE_REGION]: v.optional(
      v.pipe(
        v.string(plain("has to be a country code, or several: ru,kz")),
        v.trim(),
        v.regex(REGIONS, "has to be a country code, or several: ru,kz"),
      ),
    ),
  },
  settings: [
    {
      key: DOWNLOAD_RECORDINGS,
      default: false,
      description:
        "download each call's recording to this computer at meetings sync and meetings transcribe, so WireCat " +
        "Desktop plays it; recordings can be large",
    },
    {
      key: PHONE_REGION,
      default: "",
      description:
        "the country of a caller's number the portal writes without +, such as ru; with none such a number joins no " +
        "contact",
    },
  ],
})
