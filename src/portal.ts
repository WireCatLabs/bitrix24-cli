import type { SleepLike } from "@wirecat/cli-base"
import {
  type BaseEnvironment,
  baseContext,
  type EventSink,
  environmentOf,
  type GlobalFlags,
  ProfileTokenStore,
  refuseOffline,
} from "@wirecat/cli-core/cli"
import { Pacer, pacePathFor } from "@wirecat/cli-core/sends"
import type { Command } from "commander"
import { type AppAuth, appAuthOf } from "./bitrix/oauth.js"
import { BitrixTransport, type FetchLike } from "./bitrix/transport.js"
import { parseWebhook, type Webhook } from "./bitrix/webhook.js"
import { configuration } from "./config.js"
import { IDENTITY } from "./identity.js"

/** What a test hands `run()` in place of the portal and real waiting. */
export interface B24Environment extends BaseEnvironment {
  fetch?: FetchLike
  sleep?: SleepLike
  /** In place of the system browser; a test plays the browser and the relay page. */
  openBrowser?: (url: string) => Promise<void>
}

/** Bitrix24's cloud limit for every plan below Enterprise: 2 requests a second, a burst of 50 (apidocs "Limits"). */
export const PORTAL_PACE = { perMinute: 120, burst: 50 }

export const contextOf = (command: Command) => {
  const base = baseContext(command, configuration.resolveSettings)
  return {
    ...base,
    environment: environmentOf<B24Environment>(command),
    flags: command.optsWithGlobals<GlobalFlags>(),
    profile: base.settings.profile,
    tokens: new ProfileTokenStore({ app: IDENTITY, env: base.env, ...(base.keyring ? { keyring: base.keyring } : {}) }),
  }
}

export const transportFor = (command: Command, auth: Webhook | AppAuth, events?: EventSink): BitrixTransport => {
  const { environment, env, profile } = contextOf(command)
  return new BitrixTransport({
    auth,
    ...(events ? { events } : {}),
    ...(environment.fetch ? { fetch: environment.fetch } : {}),
    ...(environment.signal ? { signal: environment.signal } : {}),
    ...(environment.sleep ? { sleep: environment.sleep } : {}),
    pacer: new Pacer(pacePathFor(IDENTITY, profile, env), PORTAL_PACE),
  })
}

/** The profile's application sign-in, read with no network. */
export const appAuthFor = (command: Command): AppAuth | undefined => {
  const { env, profile, keyring, environment } = contextOf(command)
  return appAuthOf({
    env,
    profile,
    keyring,
    ...(environment.fetch ? { fetch: environment.fetch as typeof fetch } : {}),
    signal: environment.signal,
  })
}

/**
 * `B24_TOKEN` first, as it is for every token CLI; then the application's sign-in, then the kept webhook. One
 * `session start` forgets the other kind, so a profile normally holds one of them.
 */
export const storedSignIn = (command: Command): Webhook | AppAuth => {
  const { profile, tokens } = contextOf(command)
  const stored = tokens.read(profile)
  if (stored?.source === "environment") return parseWebhook(stored.secret)
  return appAuthFor(command) ?? parseWebhook(tokens.need(profile))
}

/** The sign-in a request uses, or an authentication error that names the command to sign in. */
export const signInOf = (command: Command): Webhook | AppAuth => {
  refuseOffline(command, "the Bitrix24 portal")
  return storedSignIn(command)
}

/** The body inside core's run: recorded, under `--timeout`, its requests in the run's events. */
export const withPortal = <T>(command: Command, body: (portal: BitrixTransport) => Promise<T>): Promise<T> =>
  contextOf(command).run((events) => body(transportFor(command, signInOf(command), events)))
