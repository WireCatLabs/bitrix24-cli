import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, beforeEach } from "vitest"
import { ARGV_LOG } from "./argv-log.js"

const saved = { ...process.env }

// cli-base's setup already gave this file a fresh TMPDIR and HOME, a keyring that throws and no network, and points
// every folder and store variable at them (WC-TEST-1, WC-STORE-14). The config folder is set only because tests
// write into it by name.
process.env.B24_CONFIG_DIR = join(tmpdir(), "config")
process.env.B24_NO_UPDATE_CHECK = "1"
process.env.B24_TEST_ARGV_LOG = ARGV_LOG
delete process.env.B24_PROFILE
delete process.env.B24_READ_ONLY
delete process.env.AI_AGENT
delete process.env.CLAUDECODE

// The portal's pace is kept in the state folder on the real clock, and a sync's cursor in the store: a test of one
// file would otherwise use up the pace, or read only what changed since another test's sync.
beforeEach(() => {
  const own = mkdtempSync(join(tmpdir(), "test-"))
  process.env.B24_STATE_DIR = join(own, "state")
  process.env.MESSAGING_STORE = join(own, "store.db")
})

afterAll(() => {
  for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key]
  Object.assign(process.env, saved)
})
