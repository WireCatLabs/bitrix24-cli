import { CliError, type SleepLike } from "@wirecat/cli-base"
import { type BaseEnvironment, environmentOf, type GlobalFlags } from "@wirecat/cli-core/cli"
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
  const environment = environmentOf<B24Environment>(command)
  const env = environment.env ?? process.env
  const flags = command.optsWithGlobals<GlobalFlags>()
  const settings = configuration.resolveSettings(flags, { env })
  return { environment, env, flags, settings, profile: settings.profile, tokens: tokens(env, environment.keyring) }
}

export const signInWords = (profile: string) => `\`${IDENTITY.command} ${profile} session start\``

export const refuseOffline = (flags: GlobalFlags) => {
  if (flags.offline)
    throw new CliError("permission_error", "this needs the Bitrix24 portal; leave out --offline", {
      reason: "offline.refused",
    })
}

export const transportFor = (command: Command, webhook: Webhook): BitrixTransport => {
  const { environment, env, profile } = contextOf(command)
  return new BitrixTransport({
    webhook,
    ...(environment.fetch ? { fetch: environment.fetch } : {}),
    ...(environment.signal ? { signal: environment.signal } : {}),
    ...(environment.sleep ? { sleep: environment.sleep } : {}),
    pacer: new Pacer(pacePathFor(IDENTITY, profile, env), PORTAL_PACE),
  })
}

/** The profile's portal, or an authentication error that names the command to sign in. */
export const portalOf = (command: Command): BitrixTransport => {
  const { flags, profile, tokens } = contextOf(command)
  refuseOffline(flags)
  const stored = tokens.read(profile)
  if (!stored)
    throw new CliError("authentication_error", `profile ${profile} is not signed in — run ${signInWords(profile)}`, {
      reason: "webhook.missing",
    })
  return transportFor(command, parseWebhook(stored.secret))
}
