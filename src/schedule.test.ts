import { mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { run } from "./program.js"
import { FAKE_HOOK, FAKE_SECRET } from "./testing/fake-portal.js"
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
    const out: string[] = []
    const err: string[] = []
    const code = await run(argv, {
      streams: { data: (text) => out.push(text), diagnostic: (text) => err.push(text) },
      tty: false,
      env,
      keyring: signedIn(),
      system,
    } as Parameters<typeof run>[1])
    return { code, out: out.join(""), err: err.join("\n") }
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

  it("lists the sync schedule, then removes it and its timer", async () => {
    const { b24, ran } = harness()
    await b24("work", "schedule", "command", "crm", "--every", "1h", "--", "sync")
    const listed = await b24("work", "schedule", "list", "--json")
    expect(listed.code, listed.err).toBe(0)
    expect(listed.out).toContain('"crm"')
    expect((await b24("work", "schedule", "remove", "crm")).code).toBe(0)
    expect(ran.map((argv) => argv.join(" "))).toContain("systemctl --user disable --now b24-schedule-crm.timer")
    expect((await b24("work", "schedule", "list", "--json")).out).not.toContain('"crm"')
  })

  it("keeps the webhook's address out of the schedule file and the timer, even from B24_TOKEN", async () => {
    const { b24, env, root } = harness()
    env.B24_TOKEN = FAKE_HOOK
    expect((await b24("work", "schedule", "command", "crm", "--every", "1h", "--", "sync")).code).toBe(0)
    expect(readFileSync(join(root, "state", "schedules", "crm", "schedule.json"), "utf8")).not.toContain(FAKE_SECRET)
    const units = join(env.XDG_CONFIG_HOME ?? "", "systemd", "user")
    for (const unit of ["b24-schedule-crm.timer", "b24-schedule-crm.service"])
      expect(readFileSync(join(units, unit), "utf8")).not.toContain(FAKE_SECRET)
  })

  it("refuses to install a timer under B24_READ_ONLY", async () => {
    const { b24, env, ran } = harness()
    env.B24_READ_ONLY = "1"
    expect((await b24("work", "schedule", "command", "crm", "--every", "1h", "--", "sync")).code).not.toBe(0)
    expect(ran).toEqual([])
  })
})
