import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { memoryKeyring } from "@wirecat/cli-base"
import { describe, expect, it } from "vitest"
import { openB24Store } from "../store.js"
import { seededCrm } from "../testing/fake-crm.js"
import { FAKE_HOOK, FAKE_SECRET, fakePortal, ok } from "../testing/fake-portal.js"
import { b24 } from "../testing/harness.js"

const COLLEAGUE_HOOK = "https://example.bitrix24.test/rest/9/wirecatfake0colleague/"

const storedAccounts = async () => {
  const store = await openB24Store(process.env)
  try {
    return (await store.accounts.accounts()).map((one) => `${one.provider}:${one.account}`)
  } finally {
    await store.close()
  }
}

const syncedWork = async () => {
  const keyring = memoryKeyring()
  const me = fakePortal({ "user.current": ok({ ID: "7" }), "user.admin": ok(true) })
  expect((await b24(["work", "session", "start"], { keyring, portal: me, stdin: FAKE_HOOK })).code).toBe(0)
  const ran = await b24(["work", "sync", "--json"], { keyring, portal: seededCrm() })
  expect(ran.code).toBe(0)
  const crm = join(process.env.B24_STATE_DIR ?? "", "crm", "work")
  mkdirSync(crm, { recursive: true })
  writeFileSync(join(crm, "own-companies.json"), "[]")
  return { keyring, crm }
}

describe("account remove", () => {
  it("--dry-run lists the webhook, the profile's files and the portal's copy, and changes nothing", async () => {
    const { keyring, crm } = await syncedWork()
    const ran = await b24(["work", "account", "remove", "--delete-data", "--dry-run", "--json"], { keyring })
    expect(ran.code).toBe(0)
    const item = ran.json().item as { removed: { kind: string; target: string }[] }
    expect(item).toMatchObject({ profile: "work", data: "deleted", dry_run: true, revoked: null })
    expect(item).toMatchObject({ account: { provider: "bitrix24", account: "example.bitrix24.test" } })
    expect(item.removed).toEqual(
      expect.arrayContaining([
        { kind: "keyring", target: "token:work" },
        { kind: "file", target: crm },
        { kind: "store", target: "bitrix24:example.bitrix24.test" },
      ]),
    )
    expect(keyring.get("bitrix24-cli", "token:work")).toBe(FAKE_HOOK)
    expect(existsSync(crm)).toBe(true)
    expect(await storedAccounts()).toContain("bitrix24:example.bitrix24.test")
    expect(ran.out + ran.err).not.toContain(FAKE_SECRET)
  })

  it("--delete-data forgets the webhook and deletes the portal's deals, leads, contacts and companies", async () => {
    const { keyring, crm } = await syncedWork()
    const ran = await b24(["work", "account", "remove", "--delete-data", "--yes", "--json"], { keyring })
    expect(ran.code).toBe(0)
    expect(keyring.get("bitrix24-cli", "token:work")).toBeNull()
    expect(existsSync(crm)).toBe(false)
    expect(await storedAccounts()).not.toContain("bitrix24:example.bitrix24.test")
  })

  it("--keep-data forgets the webhook and leaves the portal's copy searchable", async () => {
    const { keyring } = await syncedWork()
    const ran = await b24(["work", "account", "remove", "--keep-data", "--yes", "--json"], { keyring })
    expect(ran.code).toBe(0)
    expect(ran.json().item).toMatchObject({ data: "kept", dry_run: false })
    expect(keyring.get("bitrix24-cli", "token:work")).toBeNull()
    expect(await storedAccounts()).toContain("bitrix24:example.bitrix24.test")
  })

  it("--delete-data refuses while another profile reads the same portal; --keep-data still removes", async () => {
    const { keyring } = await syncedWork()
    const colleague = fakePortal({ "user.current": ok({ ID: "9" }), "user.admin": ok(false), "department.get": ok([]) })
    expect((await b24(["home", "session", "start"], { keyring, portal: colleague, stdin: COLLEAGUE_HOOK })).code).toBe(
      0,
    )
    const refused = await b24(["work", "account", "remove", "--delete-data", "--yes", "--json"], { keyring })
    expect(refused.code).not.toBe(0)
    expect(refused.json().error).toMatchObject({ code: "conflict", reason: "account-remove.portal-shared" })
    expect(keyring.get("bitrix24-cli", "token:work")).toBe(FAKE_HOOK)
    const kept = await b24(["work", "account", "remove", "--keep-data", "--yes", "--json"], { keyring })
    expect(kept.code).toBe(0)
    expect(keyring.get("bitrix24-cli", "token:home")).toBe(COLLEAGUE_HOOK)
  })

  it("asks what happens to the data, and refuses without --yes when it cannot ask", async () => {
    const { keyring } = await syncedWork()
    const unchosen = await b24(["work", "account", "remove", "--json"], { keyring })
    expect(unchosen.json().error).toMatchObject({ code: "validation_error", reason: "account-remove.no-choice" })
    const unconfirmed = await b24(["work", "account", "remove", "--keep-data", "--json"], { keyring })
    expect(unconfirmed.json().error).toMatchObject({ reason: "account-remove.unconfirmed" })
    expect(keyring.get("bitrix24-cli", "token:work")).toBe(FAKE_HOOK)
  })
})
