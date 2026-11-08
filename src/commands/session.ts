import { CliError } from "@wirecat/cli-base"
import { annotate } from "@wirecat/cli-base/commands"
import { readSecret } from "@wirecat/cli-core"
import {
  commandWords,
  environmentOf,
  FETCH,
  itemOf,
  LOCAL_READ,
  LOCAL_WRITE,
  listOf,
  logsInOrOut,
  outputFor,
  ProfileTokenStore,
  profileFree,
  profilesHere,
  REMOTE_READ,
  refuseCommandName,
  refuseOffline,
  refuseUnderReadOnly,
  rememberAccount,
  renderAnswer,
  rootOf,
  secretInputOf,
} from "@wirecat/cli-core/cli"
import { Command } from "commander"
import { parseWebhook } from "../bitrix/webhook.js"
import { configuration } from "../config.js"
import { IDENTITY } from "../identity.js"
import { type B24Environment, contextOf, transportFor, withPortal } from "../portal.js"
import { webhookUser } from "../whoami.js"

const answer = (command: Command, item: unknown) => renderAnswer(command, outputFor(command), itemOf(item))

const startCommand = () =>
  logsInOrOut(
    annotate(new Command("start"), {
      effects: FETCH,
      lifetime: "interactive",
      mcp: false,
      examples: [`${IDENTITY.command} work session start`, `${IDENTITY.command} work session start --json`],
    }),
  )
    .summary("sign in with a Bitrix24 incoming webhook")
    .description(
      "sign this profile in: the incoming webhook's address (Bitrix24 → Developer resources → Other → Incoming " +
        "webhook) is asked hidden or read from stdin, checked against the portal, and only then kept in the keyring, " +
        "or in a private file when the keyring fails; the webhook acts with the rights of the employee who made it",
    )
    .option(
      "--credential-storage <storage>",
      "where the address is kept: keyring (the default, which falls back to a private file by itself when no " +
        "keyring works), or file, not recommended",
      "keyring",
    )
    .action(async function (this: Command, args: { credentialStorage: string }) {
      const storage = args.credentialStorage
      if (storage !== "keyring" && storage !== "file")
        throw new CliError("validation_error", "--credential-storage takes keyring or file")
      const { env, profile, tokens, run } = contextOf(this)
      refuseCommandName(profile, commandWords(rootOf(this)), IDENTITY.command)
      refuseOffline(this, "the Bitrix24 portal")
      const address = (await readSecret("Bitrix24 webhook address: ", secretInputOf(this))).trim()
      if (!address) throw new CliError("validation_error", "no webhook address was given")
      const webhook = parseWebhook(address)
      const user = await run((events) => webhookUser(transportFor(this, webhook, events)))
      const portal = new URL(webhook.origin).host
      const stored = tokens.write(profile, address, storage)
      rememberAccount(IDENTITY, profile, `${portal}:${webhook.userId}`, env)
      answer(this, { profile, state: "saved", stored_in: stored, verified: true, portal, user })
    })

const statusCommand = () =>
  annotate(new Command("status"), {
    effects: REMOTE_READ,
    examples: [`${IDENTITY.command} work session status`, `${IDENTITY.command} work session status --check --json`],
  })
    .summary("show where the webhook comes from, and with --check as whom it acts")
    .description(
      `show where this profile's webhook address comes from, ${IDENTITY.envPrefix}_TOKEN, the keyring or a file, but never the address`,
    )
    .option(
      "--check",
      "ask the portal whether the webhook still works and whose it is: the user's id, name and admin rights",
    )
    .action(async function (this: Command, args: { check?: boolean }) {
      const { profile, tokens } = contextOf(this)
      const stored = tokens.read(profile)
      const portal = stored ? new URL(parseWebhook(stored.secret).origin).host : null
      const status = { profile, state: stored ? "saved" : "missing", token_from: stored?.source ?? null, portal }
      if (!args.check || !stored) return answer(this, { ...status, verified: false })
      answer(this, { ...status, verified: true, user: await withPortal(this, webhookUser) })
    })

const endCommand = () =>
  logsInOrOut(
    annotate(new Command("end"), {
      effects: LOCAL_WRITE,
      mcp: false,
      examples: [`${IDENTITY.command} work session end`],
    }),
  )
    .summary("forget this profile's webhook address on this computer")
    .description("forget this profile's webhook address on this computer; the webhook itself stays in Bitrix24")
    .action(function (this: Command) {
      refuseUnderReadOnly(this, "session end")
      const { profile, tokens } = contextOf(this)
      answer(this, { profile, ended: tokens.remove(profile) })
    })

const listCommand = () =>
  profileFree(
    annotate(new Command("list"), {
      effects: LOCAL_READ,
      examples: [`${IDENTITY.command} session list`, `${IDENTITY.command} session list --json`],
    }),
  )
    .summary("list the profiles here and whether each is signed in")
    .description("list the profiles on this computer and whether each has a webhook; picks none")
    .action(function (this: Command) {
      const environment = environmentOf<B24Environment>(this)
      const env = environment.env ?? process.env
      // biome-ignore lint/plugin/no-own-settings: baseContext needs a profile, and this local read names none
      const { configuredProfiles } = configuration.resolveSettings({}, { env, needsProfile: false })
      const store = new ProfileTokenStore({
        app: IDENTITY,
        env,
        ...(environment.keyring ? { keyring: environment.keyring } : {}),
      })
      const items = profilesHere(IDENTITY, configuredProfiles, env).map((profile) => {
        try {
          const stored = store.read(profile)
          return { profile, signed_in: stored !== undefined, token_from: stored?.source ?? null }
        } catch (error) {
          if (!(error instanceof CliError)) throw error
          return { profile, signed_in: null, token_from: null, error: error.message }
        }
      })
      renderAnswer(
        this,
        outputFor(this),
        listOf("session list", { items, limit: Math.max(1, items.length), has_more: false }),
      )
    })

export const sessionCommand = (): Command =>
  annotate(new Command("session"), { effects: LOCAL_READ })
    .description("keep this profile's Bitrix24 webhook in the OS keyring")
    .addCommand(startCommand())
    .addCommand(statusCommand())
    .addCommand(endCommand())
    .addCommand(listCommand())
