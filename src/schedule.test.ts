import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { delimiter, isAbsolute, join } from "node:path"
import { describe, expect, it } from "vitest"
import { run } from "./program.js"
import { FAKE_HOOK, FAKE_SECRET } from "./testing/fake-portal.js"
import { signedIn } from "./testing/harness.js"

/** A machine whose `systemctl` only records what it was asked, so no test installs a real timer. */
const harness = (entry = ["/opt/node", "/opt/b24/dist/bin/b24.js"]) => {
  const root = mkdtempSync(join(tmpdir(), "schedule-"))
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    // pnpm puts ./node_modules/.bin on PATH, and a schedule refuses a relative entry.
    PATH: (process.env.PATH ?? "")
      .split(delimiter)
      .filter((dir) => isAbsolute(dir))
      .join(delimiter),
    HOME: join(root, "home"),
    XDG_CONFIG_HOME: join(root, "home", ".config"),
    B24_STATE_DIR: join(root, "state"),
  }
  const ran: string[][] = []
  const system = {
    platform: "linux" as const,
    uid: 501,
    entry,
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
  const file = join(root, "state", "schedules", "crm", "schedule.json")
  return { b24, env, ran, root, file }
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

  it("refuses to install, remove, run or exec a schedule under B24_READ_ONLY", async () => {
    const { b24, env, ran, file } = harness()
    env.B24_READ_ONLY = "1"
    expect((await b24("work", "schedule", "command", "crm", "--every", "1h", "--", "sync")).code).not.toBe(0)
    expect(ran).toEqual([])
    delete env.B24_READ_ONLY
    await b24("work", "schedule", "command", "crm", "--every", "1h", "--", "sync")
    env.B24_READ_ONLY = "1"
    for (const words of [
      ["remove", "crm"],
      ["run", "crm"],
    ]) {
      const refused = await b24("work", "schedule", ...words, "--json")
      expect(JSON.parse(refused.err).error.code, words.join(" ")).toBe("permission_error")
    }
    expect(JSON.parse((await b24("schedule", "exec", file, "--json")).err).error.code).toBe("permission_error")
    expect(existsSync(join(file, "..", "last.json"))).toBe(false)
  })

  it.skipIf(process.platform === "win32")(
    "the timer's schedule exec and schedule run start sync for the profile, with no terminal and no --yes",
    async () => {
      const root = mkdtempSync(join(tmpdir(), "entry-"))
      const seen = join(root, "seen.json")
      const script = join(root, "fake-b24.js")
      writeFileSync(
        script,
        `require("fs").writeFileSync(${JSON.stringify(seen)}, JSON.stringify({ argv: process.argv.slice(2), profile: process.env.B24_PROFILE }))\n`,
      )
      const { b24, file } = harness([process.execPath, script])
      await b24("work", "schedule", "command", "crm", "--every", "1h", "--", "sync")
      const exec = await b24("schedule", "exec", file)
      expect(exec.code, exec.err).toBe(0)
      expect(JSON.parse(readFileSync(seen, "utf8"))).toEqual({ argv: ["sync"], profile: "work" })
      expect(JSON.parse(readFileSync(join(file, "..", "last.json"), "utf8")).exitCode).toBe(0)
      const ran = await b24("work", "schedule", "run", "crm")
      expect(ran.code, ran.err).toBe(0)
    },
  )

  it("keeps only the words, the profile and folder paths in the schedule file", async () => {
    const { b24, file } = harness()
    await b24("work", "schedule", "command", "crm", "--every", "1h", "--", "sync")
    const written = JSON.parse(readFileSync(file, "utf8")) as { environment: Record<string, string> }
    expect(Object.keys(written.environment).sort()).toEqual([
      "B24_CONFIG_DIR",
      "B24_PROFILE",
      "B24_STATE_DIR",
      "MESSAGING_STORE",
      "PATH",
    ])
  })
})
