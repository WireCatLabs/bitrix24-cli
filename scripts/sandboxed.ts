import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

// A development run of the built bin must never see the owner's home or keyring: a CLI that moves its folders on
// start moved the owner's real ones from a dev build once (2026-11-13).
const [command, ...args] = process.argv.slice(2)
if (!command) {
  console.error("usage: node --experimental-strip-types scripts/sandboxed.ts <command> [args…]")
  process.exit(2)
}
const home = mkdtempSync(join(tmpdir(), "b24-sandbox-"))
const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^(XDG_|B24_)/.test(name)))
const run = spawnSync(command, args, {
  stdio: "inherit",
  shell: process.platform === "win32",
  env: {
    ...env,
    HOME: home,
    USERPROFILE: home,
    APPDATA: join(home, "AppData", "Roaming"),
    LOCALAPPDATA: join(home, "AppData", "Local"),
    XDG_CONFIG_HOME: join(home, ".config"),
    XDG_DATA_HOME: join(home, ".local", "share"),
    XDG_STATE_HOME: join(home, ".local", "state"),
    XDG_CACHE_HOME: join(home, ".cache"),
    MESSAGING_STORE: join(home, "store.db"),
    WIRECAT_STATE_DIR: join(home, "wirecat"),
    B24_CONFIG_DIR: join(home, "b24", "config"),
    B24_STATE_DIR: join(home, "b24", "state"),
    B24_CACHE_DIR: join(home, "b24", "cache"),
    B24_NO_UPDATE_CHECK: "1",
    // A throwaway HOME does not hide the keyring: D-Bus still reaches it.
    DBUS_SESSION_BUS_ADDRESS: "disabled:",
  },
})
rmSync(home, { recursive: true, force: true })
process.exit(run.status ?? 1)
