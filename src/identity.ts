import type { ManifestIdentity } from "@wirecat/cli-base/wcat/manifest"
import type { AppIdentity } from "@wirecat/cli-core/cli"
import { DETAILS, REASONS } from "./reasons.js"
import { VERSION } from "./version.js"

export const PACKAGE = "@wirecat/bitrix24-cli"

export const IDENTITY: AppIdentity = {
  command: "b24",
  appName: "bitrix24-cli",
  envPrefix: "B24",
  description: "read and change a Bitrix24 portal's CRM",
  version: VERSION,
  issues: "https://github.com/WireCatLabs/bitrix24-cli/issues/new",
  messenger: false,
  contentLanguages: ["ru", "en"],
  // The portal allows 2 requests a second shared by every app and webhook; a run's budget counts on half that.
  requestMs: 1_000,
  errors: { reasons: REASONS, details: DETAILS },
}

// The bin hands this to wcatStart before the program loads, so it must not import the command tree; src/wcat.ts adds
// the permission keys for the manifest.
export const DESKTOP: ManifestIdentity = {
  ...IDENTITY,
  docs: "https://wirecat.dev/en/docs/b24",
  // A local application's sign-in exchanges and refreshes its tokens there (apidocs settings/oauth).
  hosts: ["oauth.bitrix.info"],
  userHosts: "the Bitrix24 portal in your webhook address, or the one you sign in to with a local application",
  tagline: "Bitrix24 CRM: deals, leads, contacts and companies",
  syncs: "deals, leads, contacts and companies",
  signIn: {
    gives:
      "Lets your agent read and change the portal's CRM with the rights of the employee who made the webhook, or who signed in through a local application.",
    asks: "An incoming webhook address, from Developer resources → Other → Incoming webhook, with the crm, user_basic and department scopes; or a local application's code and key.",
  },
}

export const SKILL = new URL("../skills/bitrix24-cli/SKILL.md", import.meta.url)
