import { CliError, type SleepLike } from "@wirecat/cli-base"
import {
  type BaseEnvironment,
  baseContext,
  type EventSink,
  environmentOf,
  type GlobalFlags,
} from "@wirecat/cli-core/cli"
import { Pacer, pacePathFor } from "@wirecat/cli-core/sends"
import type { Command } from "commander"
import { BitrixTransport, type FetchLike } from "./bitrix/transport.js"
import { parseWebhook, type Webhook } from "./bitrix/webhook.js"
import { configuration } from "./config.js"
import { IDENTITY } from "./identity.js"
import { tokens } from "./token.js"

/** What a test hands `run()` in place of the portal and real waiting. */
export interface B24Environment extends BaseEnvironment {
  fetch?: FetchLike
  sleep?: SleepLike
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
    tokens: tokens(base.env, base.keyring),
  }
}

export const signInWords = (profile: string) => `\`${IDENTITY.command} ${profile} session start\``

export const refuseOffline = (flags: GlobalFlags) => {
  if (flags.offline)
    throw new CliError("permission_error", "this needs the Bitrix24 portal; leave out --offline", {
      reason: "offline.refused",
    })
}

export const transportFor = (command: Command, webhook: Webhook, events?: EventSink): BitrixTransport => {
  const { environment, env, profile } = contextOf(command)
  return new BitrixTransport({
    webhook,
    ...(events ? { events } : {}),
    ...(environment.fetch ? { fetch: environment.fetch } : {}),
    ...(environment.signal ? { signal: environment.signal } : {}),
    ...(environment.sleep ? { sleep: environment.sleep } : {}),
    pacer: new Pacer(pacePathFor(IDENTITY, profile, env), PORTAL_PACE),
  })
}

/** The profile's webhook, or an authentication error that names the command to sign in. */
export const webhookOf = (command: Command): Webhook => {
  const { flags, profile, tokens } = contextOf(command)
  refuseOffline(flags)
  const stored = tokens.read(profile)
  if (!stored)
    throw new CliError("authentication_error", `profile ${profile} is not signed in — run ${signInWords(profile)}`, {
      reason: "webhook.missing",
    })
  return parseWebhook(stored.secret)
}

/** The body inside core's run: recorded, under `--timeout`, its requests in the run's events. */
export const withPortal = <T>(command: Command, body: (portal: BitrixTransport) => Promise<T>): Promise<T> =>
  contextOf(command).run((events) => body(transportFor(command, webhookOf(command), events)))
