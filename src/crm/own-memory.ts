import { readFileSync } from "node:fs"
import { join } from "node:path"
import { resolvePaths, writeSecurely } from "@wirecat/cli-base"
import { IDENTITY } from "../identity.js"

/** The own companies' ids the portal last listed, so a sync it refuses them to never takes them for deleted. */
export interface OwnMemory {
  read(): string[]
  write(ids: readonly string[]): void
}

export const ownMemoryFile = (env: NodeJS.ProcessEnv, profile: string): string =>
  join(
    resolvePaths({ appName: IDENTITY.appName, prefix: IDENTITY.envPrefix, env }).state,
    "crm",
    profile,
    "own-companies.json",
  )

export const ownMemoryAt = (file: string): OwnMemory => ({
  read: () => {
    try {
      const ids: unknown = JSON.parse(readFileSync(file, "utf8"))
      return Array.isArray(ids) ? ids.filter((one): one is string => typeof one === "string") : []
    } catch {
      return []
    }
  },
  write: (ids) => {
    writeSecurely(file, JSON.stringify(ids), 0o600)
  },
})

export const NO_MEMORY: OwnMemory = { read: () => [], write: () => {} }
