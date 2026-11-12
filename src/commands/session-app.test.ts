import { type KeyringStore, memoryKeyring } from "@wirecat/cli-base"
import { describe, expect, it } from "vitest"
import { RELAY_URL } from "../bitrix/oauth.js"
import { seededCrm } from "../testing/fake-crm.js"
import { FAKE_CLIENT_ID, FAKE_CLIENT_SECRET, FAKE_CODE, fakeApp } from "../testing/fake-oauth.js"
import { FAKE_HOOK, fakePortal, ok } from "../testing/fake-portal.js"
import { b24, signedIn } from "../testing/harness.js"

const ENTRY = ["bitrix24-cli", "oauth:bitrix24:work"] as const
const START = ["work", "session", "start", "--portal", "example.bitrix24.test", "--client-id", FAKE_CLIENT_ID, "--json"]

const people = () =>
  fakePortal({
    "user.current": ok({ ID: "7", NAME: "Anna", LAST_NAME: "Admin" }),
    "user.admin": ok(true),
  })

/** Plays the browser: Bitrix24 sends it to the relay page with the code, and the owner pastes where it ended. */
const pasting = () => {
  const opened: string[] = []
  let landed: (url: string) => void = () => {}
  const address = new Promise<string>((resolve) => {
    landed = resolve
  })
  return {
    opened,
    openBrowser: async (url: string) => {
      opened.push(url)
      const state = new URL(url).searchParams.get("state") ?? ""
      landed(`${RELAY_URL}?code=${FAKE_CODE}&state=${encodeURIComponent(state)}&domain=example.bitrix24.test`)
    },
    answer: () => address,
  }
}

/** Plays the browser and the relay page, which forwards the query to the port in front of `state`. */
const relaying = async (url: string) => {
  const state = new URL(url).searchParams.get("state") ?? ""
  const port = state.split(".")[0]
  await fetch(`http://127.0.0.1:${port}/callback?code=${FAKE_CODE}&state=${encodeURIComponent(state)}`)
}

const signIn = async (app = fakeApp(people()), keyring: KeyringStore = memoryKeyring()) => {
  const browser = pasting()
  const ran = await b24(START, { keyring, portal: app, stdin: `${FAKE_CLIENT_SECRET}\n`, ...browser })
  return { ran, app, keyring, browser }
}

describe("session start with a local application", () => {
  it("signs in through the relay page with the pasted address, asks who it is, and keeps the tokens", async () => {
    const keyring = signedIn()
    const { ran, app, browser } = await signIn(fakeApp(people()), keyring)
    expect(ran.code, ran.err).toBe(0)
    expect(ran.json().item).toMatchObject({
      kind: "app",
      state: "saved",
      stored_in: "keyring",
      portal: "example.bitrix24.test",
      user: { id: "7", name: "Anna Admin", admin: true },
    })
    const authorize = new URL(browser.opened[0] ?? "")
    expect(authorize.origin + authorize.pathname).toBe("https://example.bitrix24.test/oauth/authorize/")
    expect(authorize.searchParams.get("client_id")).toBe(FAKE_CLIENT_ID)
    expect(authorize.searchParams.get("state")).toMatch(/^\d+\./)
    expect(authorize.searchParams.has("scope")).toBe(false)
    expect(authorize.toString()).not.toContain(FAKE_CLIENT_SECRET)
    expect(app.exchanges.map((one) => one.get("grant_type"))).toEqual(["authorization_code"])
    const entry = JSON.parse(keyring.get(...ENTRY) ?? "{}")
    expect(entry).toMatchObject({
      provider: "bitrix24",
      clientId: FAKE_CLIENT_ID,
      clientSecret: FAKE_CLIENT_SECRET,
      origin: "https://example.bitrix24.test",
      userId: "7",
      scopes: ["crm", "user_basic", "department"],
    })
    expect(keyring.get("bitrix24-cli", "token:work")).toBeNull()
    for (const secret of [FAKE_CLIENT_SECRET, app.access, FAKE_CODE]) expect(ran.out + ran.err).not.toContain(secret)
  })

  it("signs in when the relay page reaches b24's local port by itself", async () => {
    const keyring = memoryKeyring()
    const ran = await b24(START, {
      keyring,
      portal: fakeApp(people()),
      env: { B24_BITRIX24_CLIENT_SECRET: FAKE_CLIENT_SECRET },
      openBrowser: relaying,
    })
    expect(ran.code, ran.err).toBe(0)
    expect(keyring.get(...ENTRY)).toContain("wirecatfake0refresh1")
  })

  it("keeps nothing when Bitrix24 refuses the application's key", async () => {
    const keyring = memoryKeyring()
    const browser = pasting()
    const ran = await b24(START, { keyring, portal: fakeApp(people()), stdin: "wirecatfake0wrong", ...browser })
    expect(ran.code).toBe(4)
    expect(JSON.parse(ran.err.trim().split("\n").at(-1) ?? "").error).toMatchObject({ code: "authentication_error" })
    expect(ran.err).toContain("INVALID_CLIENT")
    expect(keyring.get(...ENTRY)).toBeNull()
  })

  it("keeps nothing when Bitrix24 names another portal's REST address than the one signed in to", async () => {
    const keyring = memoryKeyring()
    const browser = pasting()
    const app = fakeApp(people(), "https://elsewhere.example.test/rest/")
    const ran = await b24(START, { keyring, portal: app, stdin: FAKE_CLIENT_SECRET, ...browser })
    expect(ran.code).toBe(4)
    expect(JSON.parse(ran.err.trim().split("\n").at(-1) ?? "").error).toMatchObject({ reason: "oauth.mismatch" })
    expect(keyring.get(...ENTRY)).toBeNull()
  })

  it("refuses --client-id without --portal, --portal without a code, and an address that is no portal", async () => {
    const ran = (argv: string[]) => b24(["work", "session", "start", ...argv], { stdin: FAKE_CLIENT_SECRET })
    expect((await ran(["--client-id", FAKE_CLIENT_ID])).code).toBe(2)
    expect((await ran(["--portal", "example.bitrix24.test"])).code).toBe(2)
    expect((await ran(["--portal", "http://example.bitrix24.test", "--client-id", FAKE_CLIENT_ID])).code).toBe(2)
  })
})

describe("a profile signed in with a local application", () => {
  it("calls the portal's REST 3.0 with the token in the body, never in the address", async () => {
    const crm = seededCrm({ "user.current": ok({ ID: "7" }) })
    const { keyring, app } = await signIn(fakeApp(crm))
    const ran = await b24(["work", "sync", "--json"], { keyring, portal: app })
    expect(ran.code, ran.err).toBe(0)
    expect(app.tokenCalls.some((path) => path.startsWith("/rest/api/crm."))).toBe(true)
    for (const call of crm.calls) expect(call.url).not.toContain(app.access)
  })

  it("refreshes the token once the portal answers expired_token, and keeps the new one", async () => {
    const { keyring, app } = await signIn()
    app.expire()
    const ran = await b24(["work", "session", "status", "--check", "--json"], { keyring, portal: app })
    expect(ran.code, ran.err).toBe(0)
    expect(ran.json().item).toMatchObject({ kind: "app", verified: true, user: { id: "7" } })
    expect(app.exchanges.map((one) => one.get("grant_type"))).toEqual(["authorization_code", "refresh_token"])
    expect(keyring.get(...ENTRY)).toContain("wirecatfake0refresh2")
  })

  it("shows its kind in status and list, and session end forgets it", async () => {
    const { keyring } = await signIn()
    const status = await b24(["work", "session", "status", "--json"], { keyring })
    expect(status.json().item).toMatchObject({ kind: "app", token_from: "keyring", portal: "example.bitrix24.test" })
    const listed = await b24(["session", "list", "--json"], { keyring })
    expect(listed.json().items).toContainEqual({ profile: "work", signed_in: true, token_from: "keyring" })
    expect((await b24(["work", "session", "end", "--json"], { keyring })).code).toBe(0)
    expect(keyring.get(...ENTRY)).toBeNull()
    const ended = await b24(["work", "session", "status", "--json"], { keyring })
    expect(ended.json().item).toMatchObject({ state: "missing", kind: null })
  })

  it("goes back to a webhook when one is set, which forgets the application's sign-in", async () => {
    const { keyring } = await signIn()
    const ran = await b24(["work", "session", "start", "--json"], { keyring, portal: people(), stdin: FAKE_HOOK })
    expect(ran.json().item).toMatchObject({ kind: "webhook" })
    expect(keyring.get(...ENTRY)).toBeNull()
    expect(keyring.get("bitrix24-cli", "token:work")).toBe(FAKE_HOOK)
  })
})
