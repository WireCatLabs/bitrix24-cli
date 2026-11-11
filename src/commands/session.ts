import { CliError } from "@wirecat/cli-base"
import { annotate } from "@wirecat/cli-base/commands"
import { readSecret } from "@wirecat/cli-core"
import {
  commandWords,
  environmentOf,
  FETCH,
  type GlobalFlags,
  itemOf,
  LOCAL_READ,
  LOCAL_WRITE,
  listOf,
  logsInOrOut,
  openBrowser,
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
  signInSteps,
} from "@wirecat/cli-core/cli"
import { Command } from "commander"
import { appSignIn, appSourceOf, appStorage, portalHost } from "../bitrix/oauth.js"
import { parseWebhook } from "../bitrix/webhook.js"
import { configuration } from "../config.js"
import { IDENTITY } from "../identity.js"
import { appAuthFor, type B24Environment, contextOf, transportFor, withPortal } from "../portal.js"
import { webhookUser } from "../whoami.js"

const answer = (command: Command, item: unknown) => renderAnswer(command, outputFor(command), itemOf(item))

const PASTE = "If the browser did not come back here, paste the address it ended on: "

/** The local application's sign-in; the webhook's address and the application's key are never a flag (WC-SECR-5). */
const startWithApp = async (command: Command, args: StartArgs, storage: "keyring" | "file") => {
  const { env, profile, tokens, keyring, run, environment } = contextOf(command)
  const host = portalHost(args.portal ?? "")
  const clientId = (args.clientId ?? env[`${IDENTITY.envPrefix}_BITRIX24_CLIENT_ID`] ?? "").trim()
  if (!clientId)
    throw new CliError(
      "validation_error",
      "--portal needs --client-id: the application code Bitrix24 shows once the local application is saved",
    )
  const clientSecret =
    env[`${IDENTITY.envPrefix}_BITRIX24_CLIENT_SECRET`]?.trim() ||
    (await readSecret("Bitrix24 application key (client_secret): ", secretInputOf(command))).trim()
  if (!clientSecret) throw new CliError("validation_error", "no application key was given")
  const flags = command.optsWithGlobals<GlobalFlags & { input?: boolean }>()
  const machine = flags.json === true || flags.jsonl === true
  const person = !machine && flags.input !== false && !env.CI && (environment.tty ?? process.stdout.isTTY) === true
  const { streams } = outputFor(command)
  const steps = signInSteps({
    diagnostic: (line) => streams.diagnostic(`${line}\n`),
    json: machine || environment.tty === false,
    answers: false,
  })
  const input = secretInputOf(command).input ?? process.stdin
  const given = environment.answer
  const { origin, user } = await run((events) =>
    appSignIn({
      env,
      profile,
      host,
      client: { clientId, clientSecret },
      storage,
      keyring,
      fetch: environment.fetch as typeof fetch | undefined,
      signal: environment.signal,
      signInCommand: `${IDENTITY.command} ${profile} session start --portal ${host} --client-id ${clientId}`,
      steps: {
        openBrowser: async (url) => {
          if (environment.openBrowser) return environment.openBrowser(url)
          if (person) await openBrowser(url)
        },
        showUrl: (url) => {
          steps.openUrl(url, "Sign in to Bitrix24 and allow the application")
          streams.diagnostic(`Open the Bitrix24 sign-in: ${url}\n`)
        },
        // A pipe was the key, and an empty answer would end the sign-in before the browser came back.
        ...(given
          ? {
              readPaste: async () => {
                const text = await given(PASTE)
                if (text === null) throw new CliError("cancelled", "nobody is at a terminal to paste")
                return text
              },
            }
          : input.isTTY && !machine
            ? {
                readPaste: (signal: AbortSignal) =>
                  readSecret(PASTE, { ...secretInputOf(command), echo: true, signal }),
              }
            : {}),
      },
      check: (auth) => webhookUser(transportFor(command, auth, events)),
    }),
  )
  tokens.remove(profile)
  rememberAccount(IDENTITY, profile, `${host}:${user.id}`, env)
  return {
    profile,
    state: "saved",
    kind: "app",
    stored_in: appSourceOf(env, profile, keyring) ?? storage,
    verified: true,
    portal: new URL(origin).host,
    user,
  }
}

interface StartArgs {
  credentialStorage: string
  portal?: string
  clientId?: string
}

const startCommand = () =>
  logsInOrOut(
    annotate(new Command("start"), {
      effects: FETCH,
      lifetime: "interactive",
      mcp: false,
      examples: [
        `${IDENTITY.command} work session start`,
        `${IDENTITY.command} work session start --json`,
        `${IDENTITY.command} work session start --portal example.bitrix24.ru --client-id local.0123abcd.45678901`,
      ],
    }),
  )
    .summary("sign in with a Bitrix24 incoming webhook, or with a local application")
    .description(
      "sign this profile in: the incoming webhook's address (Bitrix24 → Developer resources → Other → Incoming " +
        "webhook) is asked hidden or read from stdin, checked against the portal, and only then kept in the keyring, " +
        "or in a private file when the keyring fails; the webhook acts with the rights of the employee who made it. " +
        "With --portal and --client-id it signs in through a local application in the browser instead: its key is " +
        "asked hidden or read from stdin, and its tokens act with the rights of the employee who signs in",
    )
    .option(
      "--credential-storage <storage>",
      "where the sign-in is kept: keyring (the default, which falls back to a private file by itself when no " +
        "keyring works), or file, not recommended",
      "keyring",
    )
    .option("--portal <host>", "sign in through a local application on this portal, such as example.bitrix24.ru")
    .option(
      "--client-id <code>",
      `the local application's code (client_id), or ${IDENTITY.envPrefix}_BITRIX24_CLIENT_ID; the key comes from ` +
        `${IDENTITY.envPrefix}_BITRIX24_CLIENT_SECRET, a hidden prompt or stdin`,
    )
    .action(async function (this: Command, args: StartArgs) {
      const storage = args.credentialStorage
      if (storage !== "keyring" && storage !== "file")
        throw new CliError("validation_error", "--credential-storage takes keyring or file")
      const { env, profile, tokens, run, keyring } = contextOf(this)
      refuseCommandName(profile, commandWords(rootOf(this)), IDENTITY.command)
      refuseOffline(this, "the Bitrix24 portal")
      if (args.portal !== undefined) return answer(this, await startWithApp(this, args, storage))
      if (args.clientId !== undefined)
        throw new CliError("validation_error", "--client-id needs --portal: the portal the local application is in")
      const address = (await readSecret("Bitrix24 webhook address: ", secretInputOf(this))).trim()
      if (!address) throw new CliError("validation_error", "no webhook address was given")
      const webhook = parseWebhook(address)
      const user = await run((events) => webhookUser(transportFor(this, webhook, events)))
      const portal = new URL(webhook.origin).host
      const stored = tokens.write(profile, address, storage)
      appStorage(env, profile, keyring).remove()
      rememberAccount(IDENTITY, profile, `${portal}:${webhook.userId}`, env)
      answer(this, { profile, state: "saved", kind: "webhook", stored_in: stored, verified: true, portal, user })
    })

const statusCommand = () =>
  annotate(new Command("status"), {
    effects: REMOTE_READ,
    examples: [`${IDENTITY.command} work session status`, `${IDENTITY.command} work session status --check --json`],
  })
    .summary("show how this profile signs in, and with --check as whom it acts")
    .description(
      "show how this profile signs in, with a webhook or a local application, and where that comes from: " +
        `${IDENTITY.envPrefix}_TOKEN, the keyring or a file; never the address, the key or a token`,
    )
    .option(
      "--check",
      "ask the portal whether the sign-in still works and whose it is: the user's id, name and admin rights",
    )
    .action(async function (this: Command, args: { check?: boolean }) {
      const { env, profile, tokens, keyring } = contextOf(this)
      const stored = tokens.read(profile)
      const app = stored?.source === "environment" ? undefined : appAuthFor(this)
      const status = app
        ? {
            profile,
            state: "saved",
            kind: "app",
            token_from: appSourceOf(env, profile, keyring) ?? null,
            portal: new URL(app.origin).host,
          }
        : {
            profile,
            state: stored ? "saved" : "missing",
            kind: stored ? "webhook" : null,
            token_from: stored?.source ?? null,
            portal: stored ? new URL(parseWebhook(stored.secret).origin).host : null,
          }
      if (!args.check || status.state === "missing") return answer(this, { ...status, verified: false })
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
    .summary("forget this profile's webhook address or application sign-in on this computer")
    .description(
      "forget this profile's webhook address, or its local application's key and tokens, on this computer; the " +
        "webhook and the application stay in Bitrix24, which has no call that revokes a token: delete them there to " +
        "stop them",
    )
    .action(function (this: Command) {
      refuseUnderReadOnly(this, "session end")
      const { env, profile, tokens, keyring } = contextOf(this)
      const ended = [...tokens.remove(profile), ...appStorage(env, profile, keyring).remove()]
      answer(this, { profile, ended: [...new Set(ended)] })
    })

const listCommand = () =>
  profileFree(
    annotate(new Command("list"), {
      effects: LOCAL_READ,
      examples: [`${IDENTITY.command} session list`, `${IDENTITY.command} session list --json`],
    }),
  )
    .summary("list the profiles here and whether each is signed in")
    .description(
      "list the profiles on this computer and whether each has a webhook or an application sign-in; picks none",
    )
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
          const from = store.read(profile)?.source ?? appSourceOf(env, profile, environment.keyring)
          return { profile, signed_in: from !== undefined, token_from: from ?? null }
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
    .description("keep this profile's Bitrix24 webhook or local application sign-in in the OS keyring")
    .addCommand(startCommand())
    .addCommand(statusCommand())
    .addCommand(endCommand())
    .addCommand(listCommand())
