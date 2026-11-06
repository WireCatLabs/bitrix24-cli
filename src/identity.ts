import type { AppIdentity } from "@wirecat/cli-core/cli"
import { VERSION } from "./version.js"

export const PACKAGE = "@wirecat/bitrix24-cli"

export const IDENTITY: AppIdentity = {
  command: "b24",
  appName: "bitrix24-cli",
  envPrefix: "B24",
  description: "a new WireCat CLI, started from cli-template",
  version: VERSION,
  issues: "https://github.com/WireCatLabs/bitrix24-cli/issues/new",
  messenger: false,
  contentLanguages: ["ru", "en"],
}

export const SKILL = new URL("../skills/bitrix24-cli/SKILL.md", import.meta.url)
