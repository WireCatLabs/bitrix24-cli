import { Readable } from "node:stream"
import { type KeyringStore, memoryKeyring } from "@wirecat/cli-base"
import { run } from "../program.js"
import { seededCrm } from "./fake-crm.js"
import { FAKE_HOOK, fakePortal } from "./fake-portal.js"

export interface Ran {
  code: number
  out: string
  err: string
  /** stdout parsed, or the error object from stderr. */
  json: () => Record<string, unknown>
}

/** A keyring where profile `work` is already signed in to the fake portal. */
export const signedIn = (): KeyringStore => memoryKeyring({ "bitrix24-cli:token:work": FAKE_HOOK })

/** Runs `b24` against a fake portal, with no real waits and no terminal. */
export const b24 = async (
  argv: string[],
  {
    portal = fakePortal(),
    keyring = signedIn(),
    stdin,
    env,
    answer,
    openBrowser,
  }: {
    portal?: { fetch: ReturnType<typeof fakePortal>["fetch"] }
    keyring?: KeyringStore
    stdin?: string
    env?: NodeJS.ProcessEnv
    answer?: (question: string) => Promise<string | null> | string | null
    openBrowser?: (url: string) => Promise<void>
  } = {},
): Promise<Ran> => {
  const out: string[] = []
  const err: string[] = []
  const code = await run(argv, {
    streams: { data: (text) => out.push(text), diagnostic: (text) => err.push(text) },
    tty: false,
    keyring,
    fetch: portal.fetch,
    sleep: async () => {},
    ...(env ? { env: { ...process.env, ...env } } : {}),
    ...(answer ? { answer } : {}),
    ...(openBrowser ? { openBrowser } : {}),
    ...(stdin === undefined ? {} : { stdin: Object.assign(Readable.from([stdin]), { isTTY: false }) }),
  } as Parameters<typeof run>[1])
  const text = { out: out.join(""), err: err.join("") }
  return {
    code,
    ...text,
    json: () => JSON.parse(text.out.trim() || text.err.trim()) as Record<string, unknown>,
  }
}

/** A seeded fake portal, synced into this test file's store; `ref` finds a copy's `deal:<n>` by its portal id. */
export const synced = async (portal: ReturnType<typeof seededCrm> = seededCrm()) => {
  const ran = await b24(["work", "sync", "--json"], { portal })
  if (ran.code !== 0) throw new Error(`sync failed: ${ran.err}`)
  const refs = new Map<string, string>()
  for (const kind of ["deals", "leads"]) {
    const listed = (await b24(["work", kind, "list", "--json"], { portal })).json() as {
      items: { ref: string; external_id: string }[]
    }
    for (const item of listed.items) refs.set(`${kind}/${item.external_id}`, item.ref)
  }
  const ref = (kind: "deals" | "leads", externalId: number) => {
    const found = refs.get(`${kind}/${externalId}`)
    if (!found) throw new Error(`no stored copy of ${kind} ${externalId}`)
    return found
  }
  return { portal, ref, calls: () => portal.calls.length }
}
