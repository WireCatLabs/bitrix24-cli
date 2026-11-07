import { mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { run } from "./program.js"
import { signedIn } from "./testing/harness.js"

/** A machine whose `systemctl` only records what it was asked, so no test installs a real timer. */
const harness = () => {
  const root = mkdtempSync(join(tmpdir(), "schedule-"))
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: join(root, "home"),
    XDG_CONFIG_HOME: join(root, "home", ".config"),
    B24_STATE_DIR: join(root, "state"),
  }
  const ran: string[][] = []
  const system = {
    platform: "linux" as const,
    uid: 501,
    entry: ["/opt/node", "/opt/b24/dist/bin/b24.js"],
    run: async (argv: string[]) => {
      ran.push(argv)
      return { code: 0, stdout: "", stderr: "" }
    },
    spawn: () => 0,
    pause: async () => {},
  }
  const b24 = async (...argv: string[]) => {
    const err: string[] = []
    const code = await run(argv, {
      streams: { data: () => {}, diagnostic: (text) => err.push(text) },
      tty: false,
      env,
      keyring: signedIn(),
      system,
    } as Parameters<typeof run>[1])
    return { code, err: err.join("\n") }
  }
  return { b24, env, ran, root }
}

describe("b24 schedule", () => {
  it("installs an hourly sync of the profile as a systemd user timer", async () => {
    const { b24, env, ran, root } = harness()
    const added = await b24("work", "schedule", "command", "crm", "--every", "1h", "--", "sync")
    expect(added.code, added.err).toBe(0)
    expect(JSON.parse(readFileSync(join(root, "state", "schedules", "crm", "schedule.json"), "utf8"))).toMatchObject({
      kind: "command",
      argv: ["sync"],
      when: { every: 60 },
      environment: { B24_PROFILE: "work" },
    })
    const units = join(env.XDG_CONFIG_HOME ?? "", "systemd", "user")
    expect(readFileSync(join(units, "b24-schedule-crm.timer"), "utf8")).toContain("OnUnitInactiveSec=60min")
    expect(ran.map((argv) => argv.join(" "))).toEqual([
      "systemctl --user daemon-reload",
      "systemctl --user enable --now b24-schedule-crm.timer",
    ])
  })

  it("refuses to install a timer under B24_READ_ONLY", async () => {
    const { b24, env, ran } = harness()
    env.B24_READ_ONLY = "1"
    expect((await b24("work", "schedule", "command", "crm", "--every", "1h", "--", "sync")).code).not.toBe(0)
    expect(ran).toEqual([])
  })
})
