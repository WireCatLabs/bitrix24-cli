import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { resolvePaths } from "@wirecat/cli-base"
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
      const ids = JSON.parse(readFileSync(file, "utf8")) as unknown
      return Array.isArray(ids) ? ids.filter((one): one is string => typeof one === "string") : []
    } catch {
      return []
    }
  },
  write: (ids) => {
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
    writeFileSync(file, JSON.stringify(ids), { mode: 0o600 })
  },
})

export const NO_MEMORY: OwnMemory = { read: () => [], write: () => {} }
