import { memoryKeyring } from "@wirecat/cli-base"
import { describe, expect, it } from "vitest"
import { FAKE_HOOK, FAKE_SECRET, fakePortal, ok } from "../testing/fake-portal.js"
import { b24, signedIn } from "../testing/harness.js"

const portal = () =>
  fakePortal({
    "user.current": ok({ ID: "7", NAME: "Anna", LAST_NAME: "Admin", EMAIL: "anna@example.test" }),
    "user.admin": ok(true),
  })

describe("session", () => {
  it("start checks the webhook against the portal, then keeps it, and says whose rights it carries", async () => {
    const keyring = memoryKeyring()
    const ran = await b24(["work", "session", "start", "--json"], {
      keyring,
      portal: portal(),
      stdin: `${FAKE_HOOK}\n`,
    })
    expect(ran.code).toBe(0)
    expect(ran.json().item).toMatchObject({
      profile: "work",
      state: "saved",
      verified: true,
      portal: "example.bitrix24.test",
      user: { id: "7", name: "Anna Admin", admin: true },
    })
    expect(keyring.get("bitrix24-cli", "token:work")).toBe(FAKE_HOOK)
    expect(ran.out + ran.err).not.toContain(FAKE_SECRET)
  })

  it("start names a department head a manager, and anyone else not one even when departments are refused", async () => {
    const start = async (script: Parameters<typeof fakePortal>[0]) =>
      (
        await b24(["work", "session", "start", "--json"], {
          keyring: memoryKeyring(),
          portal: fakePortal({ "user.current": ok({ ID: "7" }), "user.admin": ok(false), ...script }),
          stdin: FAKE_HOOK,
        })
      ).json().item
    expect(await start({ "department.get": ok([{ ID: "1", NAME: "Sales", UF_HEAD: "7" }]) })).toMatchObject({
      user: { admin: false, manager: true },
    })
    expect(await start({ "department.get": ok([]) })).toMatchObject({ user: { manager: false } })
    expect(await start({})).toMatchObject({ user: { manager: false } })
    expect(await start({ "department.get": { status: 401, body: { error: "insufficient_scope" } } })).toMatchObject({
      user: { manager: false },
    })
  })

  it("start keeps nothing when the portal refuses the webhook", async () => {
    const keyring = memoryKeyring()
    const refusing = fakePortal({ "user.current": { status: 401, body: { error: "INVALID_CREDENTIALS" } } })
    const ran = await b24(["work", "session", "start", "--json"], { keyring, portal: refusing, stdin: FAKE_HOOK })
    expect(ran.code).toBe(4)
    expect(keyring.get("bitrix24-cli", "token:work")).toBeNull()
    expect(ran.err).not.toContain(FAKE_SECRET)
  })

  it("start refuses an address that is not a webhook, an empty one and an unknown storage", async () => {
    expect((await b24(["work", "session", "start"], { keyring: memoryKeyring(), stdin: "hello" })).code).toBe(2)
    expect((await b24(["work", "session", "start"], { keyring: memoryKeyring(), stdin: "\n" })).code).toBe(2)
    const storage = await b24(["work", "session", "start", "--credential-storage", "cloud"], { stdin: FAKE_HOOK })
    expect(storage.code).toBe(2)
  })

  it("start --credential-storage file keeps it out of the keyring", async () => {
    const keyring = memoryKeyring()
    const ran = await b24(["work", "session", "start", "--credential-storage", "file", "--json"], {
      keyring,
      portal: portal(),
      stdin: FAKE_HOOK,
    })
    expect(ran.code).toBe(0)
    expect(keyring.get("bitrix24-cli", "token:work")).toBeNull()
    const status = await b24(["work", "session", "status", "--json"], { keyring })
    expect(status.json().item).toMatchObject({ state: "saved", token_from: "file" })
    await b24(["work", "session", "end"], { keyring })
  })

  it("status says where the webhook comes from, and --check whose rights it carries", async () => {
    const plain = await b24(["work", "session", "status", "--json"])
    expect(plain.json().item).toMatchObject({ state: "saved", token_from: "keyring", verified: false })
    const checked = await b24(["work", "session", "status", "--check", "--json"], { portal: portal() })
    expect(checked.json().item).toMatchObject({ verified: true, user: { id: "7", admin: true } })
    const missing = await b24(["other", "session", "status", "--check", "--json"], { keyring: memoryKeyring() })
    expect(missing.json().item).toMatchObject({ state: "missing", verified: false })
  })

  it("--check refuses --offline, which never reaches the portal", async () => {
    const ran = await b24(["work", "session", "status", "--check", "--offline"], { portal: portal() })
    expect(ran.code).toBe(5)
  })

  it("end forgets the webhook; list shows every profile and whether it is signed in", async () => {
    const keyring = signedIn()
    const listed = await b24(["session", "list", "--json"], {
      keyring,
      env: { B24_CONFIG_DIR: process.env.B24_CONFIG_DIR },
    })
    expect(listed.code).toBe(0)
    const ended = await b24(["work", "session", "end", "--json"], { keyring })
    expect(ended.code).toBe(0)
    expect(keyring.get("bitrix24-cli", "token:work")).toBeNull()
  })

  it("B24_TOKEN comes first", async () => {
    const ran = await b24(["work", "session", "status", "--json"], {
      keyring: memoryKeyring(),
      env: { B24_TOKEN: FAKE_HOOK },
    })
    expect(ran.json().item).toMatchObject({ state: "saved", token_from: "environment" })
  })

  it("a portal command on a profile that is not signed in names session start", async () => {
    const ran = await b24(["work", "deals", "list", "--json"], { keyring: memoryKeyring(), portal: portal() })
    expect(ran.code).toBe(4)
    expect(JSON.parse(ran.err).error).toMatchObject({
      code: "authentication_error",
      reason: "session.missing",
      message: expect.stringContaining("b24 work session start"),
    })
  })

  describe("start refuses a webhook another profile already uses", () => {
    const signedInAsWork = async () => {
      const keyring = memoryKeyring()
      expect((await b24(["work", "session", "start"], { keyring, portal: portal(), stdin: FAKE_HOOK })).code).toBe(0)
      return keyring
    }

    it("the same address, or the same portal and user with another secret, names that profile and asks nothing", async () => {
      const keyring = await signedInAsWork()
      for (const hook of [FAKE_HOOK, "https://example.bitrix24.test/rest/7/wirecatfake0another/"]) {
        const asked = portal()
        const ran = await b24(["home", "session", "start", "--json"], { keyring, portal: asked, stdin: hook })
        expect(ran.code).not.toBe(0)
        expect(ran.json().error).toMatchObject({
          code: "conflict",
          reason: "session.duplicate",
          message: expect.stringContaining("b24 work account remove --keep-data"),
        })
        expect(asked.calls).toHaveLength(0)
        expect(keyring.get("bitrix24-cli", "token:home")).toBeNull()
        expect(ran.out + ran.err).not.toContain(FAKE_SECRET)
      }
    })

    it("lets the same profile sign in again, and another employee's webhook on the same portal in", async () => {
      const keyring = await signedInAsWork()
      expect((await b24(["work", "session", "start"], { keyring, portal: portal(), stdin: FAKE_HOOK })).code).toBe(0)
      const colleague = fakePortal({ "user.current": ok({ ID: "9" }), "user.admin": ok(false) })
      const hook = "https://example.bitrix24.test/rest/9/wirecatfake0colleague/"
      expect((await b24(["home", "session", "start"], { keyring, portal: colleague, stdin: hook })).code).toBe(0)
    })

    it("counts no profile as a holder for B24_TOKEN, nor one whose session ended", async () => {
      const keyring = await signedInAsWork()
      await b24(["work", "session", "end"], { keyring })
      const ran = await b24(["home", "session", "start"], {
        keyring,
        portal: portal(),
        stdin: FAKE_HOOK,
        env: { B24_TOKEN: FAKE_HOOK },
      })
      expect(ran.code).toBe(0)
    })
  })

  it("start says which right a webhook without the user scope lacks, where to add it, and keeps nothing", async () => {
    const keyring = memoryKeyring()
    const scopeless = fakePortal({ "user.current": { status: 401, body: { error: "INSUFFICIENT_SCOPE" } } })
    const ran = await b24(["work", "session", "start", "--json"], { keyring, portal: scopeless, stdin: FAKE_HOOK })
    expect(ran.code).not.toBe(0)
    const error = ran.json().error as { message: string }
    expect(error).toMatchObject({ code: "permission_error", reason: "webhook.scope-missing" })
    for (const words of ["Users (basic)", "user_basic", "example.bitrix24.test", "Developer resources → Integrations"])
      expect(error.message).toContain(words)
    expect(keyring.get("bitrix24-cli", "token:work")).toBeNull()
    expect(ran.out + ran.err).not.toContain(FAKE_SECRET)
  })
})
