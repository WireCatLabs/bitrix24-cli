import { Readable } from "node:stream"
import { type KeyringStore, memoryKeyring } from "@wirecat/cli-base"
import { run } from "../program.js"
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
  }: {
    portal?: ReturnType<typeof fakePortal>
    keyring?: KeyringStore
    stdin?: string
    env?: NodeJS.ProcessEnv
    answer?: (question: string) => string | null
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
    ...(stdin === undefined ? {} : { stdin: Object.assign(Readable.from([stdin]), { isTTY: false }) }),
  } as Parameters<typeof run>[1])
  const text = { out: out.join(""), err: err.join("") }
  return {
    code,
    ...text,
    json: () => JSON.parse(text.out.trim() || text.err.trim()) as Record<string, unknown>,
  }
}
