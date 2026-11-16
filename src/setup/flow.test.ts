import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { type KeyringStore, memoryKeyring } from "@wirecat/cli-base"
import { setupProblems } from "@wirecat/cli-core/cli"
import { setupFileProblems } from "@wirecat/cli-core/testing"
import { describe, expect, it } from "vitest"
import { configuration } from "../config.js"
import { FAKE_HOOK, FAKE_SECRET, fakePortal, ok } from "../testing/fake-portal.js"
import { b24, signedIn } from "../testing/harness.js"
import { b24Setup, SCOPES } from "./flow.js"
import en from "./texts.en.json" with { type: "json" }
import es from "./texts.es.json" with { type: "json" }
import ru from "./texts.ru.json" with { type: "json" }

const portal = () =>
  fakePortal({
    "user.current": ok({ ID: "7", NAME: "Anna", LAST_NAME: "Admin" }),
    "user.admin": ok(true),
  })

const APP_ENTRY = ["bitrix24-cli", "oauth:bitrix24:work"] as const
const APP_KEY = APP_ENTRY.join(":")

const configs = () => ({ B24_CONFIG_DIR: mkdtempSync(join(tmpdir(), "b24-setup-")) })

const apply = async (
  answers: Record<string, unknown>,
  {
    keyring = memoryKeyring(),
    fake = portal(),
    env = configs(),
    argv = ["work", "setup", "run", "apply", "--json", "--answer-stdin"],
  }: {
    keyring?: KeyringStore
    fake?: ReturnType<typeof fakePortal>
    env?: Record<string, string>
    argv?: string[]
  } = {},
) => {
  const ran = await b24(argv, {
    keyring,
    env,
    portal: fake,
    stdin: `${JSON.stringify(answers)}\n`,
  })
  // The harness joins stderr's writes with nothing between them, and the sign-in events come first.
  const error = () =>
    ran.err.includes('{"error"') ? JSON.parse(ran.err.slice(ran.err.lastIndexOf('{"error"'))).error : undefined
  return { ...ran, error, keyring, env }
}

describe("the setup flow", () => {
  it("**is a valid v1 document**, with no image files yet", () => {
    expect(setupProblems(b24Setup.document, { settings: configuration.allSettings, v1: true })).toEqual([])
    expect(setupFileProblems(b24Setup, new URL("../../", import.meta.url))).toEqual([])
  })

  it("**has every text in Russian and Spanish too**, a line for each permission among them", () => {
    expect(Object.keys(ru).sort()).toEqual(Object.keys(en).sort())
    expect(Object.keys(es).sort()).toEqual(Object.keys(en).sort())
    for (const code of SCOPES) expect(Object.keys(en)).toContain(`scope.${code}`)
  })

  it("**setup show lists the permissions to tick, in order**, and needs no profile", async () => {
    const shown = await b24(["setup", "show", "--json"], { keyring: memoryKeyring() })
    const document = shown.json().item as { steps: Record<string, { blocks: { blocks?: { params?: object }[] }[] }> }
    const card = document.steps.webhook?.blocks.find((block) => block.blocks)
    expect(card?.blocks?.map((block) => block.params)).toEqual(SCOPES.map((code) => ({ code })))
  })

  it("**saves the webhook that session start would**, as the account session start remembers", async () => {
    const saved = await apply({ webhook: FAKE_HOOK })
    expect([saved.code, saved.error()]).toEqual([0, undefined])
    expect(saved.json()).toMatchObject({
      item: { outcome: "ok", secrets: ["token"], portal: "example.bitrix24.test", user: { id: "7" } },
    })
    expect(saved.out + saved.err).not.toContain(FAKE_SECRET)
    expect(saved.keyring.get("bitrix24-cli", "token:work")).toBe(FAKE_HOOK)
    const status = await b24(["work", "session", "status", "--check", "--json"], {
      keyring: saved.keyring,
      env: saved.env,
      portal: portal(),
    })
    expect(status.json()).toMatchObject({
      item: { state: "saved", kind: "webhook", portal: "example.bitrix24.test", user: { id: "7" } },
    })
  })

  it("**an address that is no webhook's keeps nothing**", async () => {
    const { code, error, keyring } = await apply({ webhook: "https://example.bitrix24.test/crm/deal/" })
    expect(code).not.toBe(0)
    expect(error()).toMatchObject({ code: "validation_error" })
    expect(keyring.get("bitrix24-cli", "token:work")).toBeNull()
  })

  it("**a webhook the portal refuses keeps nothing**", async () => {
    const refused = fakePortal({ "user.current": { status: 401, body: { error: "INVALID_CREDENTIALS" } } })
    const { code, error, keyring, out, err } = await apply(
      { webhook: FAKE_HOOK },
      { fake: refused, keyring: memoryKeyring({ [APP_KEY]: "app sign-in" }) },
    )
    expect(out + err).not.toContain(FAKE_SECRET)
    expect(code).not.toBe(0)
    expect(error()).toMatchObject({ code: "authentication_error" })
    expect(out).toBe("")
    expect(keyring.get("bitrix24-cli", "token:work")).toBeNull()
    expect(keyring.get(...APP_ENTRY)).toBe("app sign-in")
  })

  it("**a webhook without Users (basic) is a permission error**, which sends the owner back to the permissions", async () => {
    const scopeless = fakePortal({ "user.current": { status: 401, body: { error: "INSUFFICIENT_SCOPE" } } })
    const { code, error, keyring, out, err } = await apply({ webhook: FAKE_HOOK }, { fake: scopeless })
    expect(out + err).not.toContain(FAKE_SECRET)
    expect(code).not.toBe(0)
    expect(error()).toMatchObject({ code: "permission_error", reason: "webhook.scope-missing" })
    expect(keyring.get("bitrix24-cli", "token:work")).toBeNull()
    const check = b24Setup.document.steps.check as { next: { when?: { error?: string }; to: string }[] }
    expect(check.next.find((edge) => edge.when?.error === "permission_error")?.to).toBe("webhook")
  })

  it("**a webhook another profile here uses is a conflict**", async () => {
    const keyring = memoryKeyring()
    const env = configs()
    expect((await b24(["home", "session", "start"], { keyring, env, portal: portal(), stdin: FAKE_HOOK })).code).toBe(0)
    const { code, error, out, err } = await apply({ webhook: FAKE_HOOK }, { keyring, env })
    expect(code).not.toBe(0)
    expect(error()).toMatchObject({ code: "conflict", reason: "session.duplicate" })
    expect(out + err).not.toContain(FAKE_SECRET)
  })

  it("**editing without a new address checks the kept one**, and with none kept asks for it", async () => {
    const kept = await apply({}, { keyring: signedIn() })
    expect([kept.code, kept.error()]).toEqual([0, undefined])
    expect(kept.json()).toMatchObject({ item: { outcome: "ok", portal: "example.bitrix24.test" } })
    const none = await apply({})
    expect(none.code).not.toBe(0)
    expect(none.error()).toMatchObject({ code: "validation_error", details: { at: "address" } })
  })

  it("**apply --dry-run checks no portal and saves nothing**", async () => {
    const keyring = memoryKeyring()
    const fake = portal()
    const dry = await b24(["work", "setup", "apply", "--dry-run", "--json"], {
      keyring,
      portal: fake,
      stdin: JSON.stringify({ webhook: FAKE_HOOK }),
    })
    expect(dry.code).toBe(0)
    expect(dry.json()).toMatchObject({ item: { valid: true } })
    expect(fake.calls).toEqual([])
    expect(keyring.get("bitrix24-cli", "token:work")).toBeNull()
  })

  it("**keeps the address trimmed**, and a local application's sign-in gives way to it", async () => {
    const saved = await apply({ webhook: `  ${FAKE_HOOK}\n` }, { keyring: memoryKeyring({ [APP_KEY]: "app sign-in" }) })
    expect([saved.code, saved.error()]).toEqual([0, undefined])
    expect(saved.keyring.get("bitrix24-cli", "token:work")).toBe(FAKE_HOOK)
    expect(saved.keyring.get(...APP_ENTRY)).toBeNull()
  })

  it("**a blank address is refused and leaves the kept one alone**", async () => {
    const fake = portal()
    const { code, error, keyring } = await apply({ webhook: "   " }, { keyring: signedIn(), fake })
    expect(code).not.toBe(0)
    expect(error()).toMatchObject({ code: "validation_error", param: "webhook" })
    expect(fake.calls).toEqual([])
    expect(keyring.get("bitrix24-cli", "token:work")).toBe(FAKE_HOOK)
  })

  it("**--offline asks the portal nothing and saves nothing**, as session start refuses it", async () => {
    const fake = portal()
    const argv = ["work", "setup", "run", "apply", "--json", "--answer-stdin", "--offline"]
    for (const answers of [{ webhook: FAKE_HOOK }, {}]) {
      const keyring = answers.webhook ? memoryKeyring() : signedIn()
      const { code, error, out, err } = await apply(answers, { fake, argv, keyring })
      expect(code).not.toBe(0)
      expect(error()).toMatchObject({ code: "permission_error", reason: "offline.refused" })
      expect(out + err).not.toContain(FAKE_SECRET)
      if (answers.webhook) expect(keyring.get("bitrix24-cli", "token:work")).toBeNull()
    }
    expect(fake.calls).toEqual([])
  })

  it("**a profile named after a command is refused**, with a new address or the kept one", async () => {
    const fake = portal()
    const argv = ["setup", "run", "apply", "--json", "--answer-stdin"]
    for (const answers of [{ webhook: FAKE_HOOK }, {}]) {
      const keyring = memoryKeyring(answers.webhook ? {} : { "bitrix24-cli:token:deals": FAKE_HOOK })
      const { code, error } = await apply(answers, { fake, argv, keyring, env: { ...configs(), B24_PROFILE: "deals" } })
      expect(code).not.toBe(0)
      expect(error()).toMatchObject({ code: "validation_error" })
      expect(error().message).toContain("is a command")
      if (answers.webhook) expect(keyring.get("bitrix24-cli", "token:deals")).toBeNull()
    }
    expect(fake.calls).toEqual([])
  })
})
