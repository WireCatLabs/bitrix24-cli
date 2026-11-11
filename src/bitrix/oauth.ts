import {
  CliError,
  type CredentialStorage,
  Credentials,
  isMovedRun,
  type KeyringStore,
  resolvePaths,
  systemKeyring,
} from "@wirecat/cli-base"
import { hostFetch } from "@wirecat/cli-base/http"
import {
  credentialStorage,
  type ExchangeContext,
  type OAuthClient,
  type OAuthProvider,
  oauthAccount,
  type SignInOptions as SignInSteps,
  type StoredTokens,
  standardCodec,
  type TokenCodec,
  type TokenSet,
  type TokenStorage,
  tokenKeeper,
} from "@wirecat/cli-core/oauth"
import { isRecord } from "../body.js"
import { IDENTITY } from "../identity.js"

export const OAUTH_HOST = "oauth.bitrix.info"
/** The local application's "Your handler path": Bitrix24 sends the browser there, not to the `redirect_uri` asked. */
export const RELAY_URL = "https://wirecat.dev/b24-callback"
const TOKEN_URL = `https://${OAUTH_HOST}/oauth/token/`
const PROVIDER = "bitrix24"
const REQUEST_MS = 30_000
const CODE = /^[A-Za-z0-9_]{1,128}$/

/** A sign-in through the portal's own local application: the portal, whose rights its tokens carry, and the token. */
export interface AppAuth {
  origin: string
  userId: string
  accessToken: (refresh: boolean) => Promise<string>
}

interface Kept {
  origin: string
  userId: string
}

const standard = standardCodec(PROVIDER)

/**
 * cli-core's entry keeps only WireCat's own secret, and a local application has no WireCat app: every refresh needs
 * the owner's secret, so the entry keeps it, as gcal's does. `origin` and `userId` ride along as extra fields.
 */
const codec: TokenCodec = {
  decode: (raw) => {
    const stored = standard.decode(raw)
    const entry: unknown = JSON.parse(raw)
    if (!isRecord(entry) || typeof entry.origin !== "string" || typeof entry.userId !== "string") return stored
    return { ...stored, kept: { origin: entry.origin, userId: entry.userId } }
  },
  encode: (input) => {
    const entry: Record<string, unknown> = JSON.parse(standard.encode(input))
    if (input.client.clientSecret) entry.clientSecret = input.client.clientSecret
    else delete entry.clientSecret
    return JSON.stringify(entry)
  },
}

const keptOf = (stored: StoredTokens): Kept | undefined => (stored as StoredTokens & { kept?: Kept }).kept

const paths = (env: NodeJS.ProcessEnv) => resolvePaths({ appName: IDENTITY.appName, prefix: IDENTITY.envPrefix, env })

const credentialsOf = (env: NodeJS.ProcessEnv, keyring: KeyringStore | undefined, storage: CredentialStorage) => ({
  configDir: paths(env).config,
  service: IDENTITY.appName,
  storage,
  env,
  isolated: isMovedRun({ appName: IDENTITY.appName, prefix: IDENTITY.envPrefix, env }),
  // cli-core's sign-in store takes no default keyring; a test hands its memory keyring here instead.
  keyring: keyring ?? systemKeyring,
})

/** The same service, folder and moved-run rule as the webhook's `ProfileTokenStore`, under `oauth:bitrix24:<profile>`. */
export const appStorage = (
  env: NodeJS.ProcessEnv,
  profile: string,
  keyring?: KeyringStore,
  storage: CredentialStorage = "auto",
): TokenStorage =>
  credentialStorage({
    credentials: credentialsOf(env, keyring, storage),
    account: oauthAccount(PROVIDER, profile),
    codec,
  })

/** Where the application's sign-in is kept, `keyring` or `file`, and never what. */
export const appSourceOf = (env: NodeJS.ProcessEnv, profile: string, keyring?: KeyringStore) =>
  new Credentials(credentialsOf(env, keyring, "auto")).read(oauthAccount(PROVIDER, profile))?.source

const refusal = (code: string | undefined, status: number, again: string): CliError => {
  const named = code ? ` (${code})` : ""
  if (status === 429 || status >= 500)
    return new CliError("provider_unavailable", `Bitrix24's sign-in server failed (HTTP ${status})`, {
      status,
      retryable: true,
      reason: "oauth.unavailable",
    })
  if (code === "INVALID_CLIENT")
    return new CliError(
      "authentication_error",
      `Bitrix24 refused the application's code or key${named}: check both, and that the local application is ` +
        `saved in this portal; ${again}`,
      { status, reason: "oauth.expired" },
    )
  if (code === "PAYMENT_REQUIRED")
    return new CliError("authentication_error", `Bitrix24 issues no tokens until the portal's plan is paid${named}`, {
      status,
      reason: "oauth.expired",
    })
  return new CliError("authentication_error", `Bitrix24 refused the sign-in${named}; ${again}`, {
    status,
    reason: "oauth.expired",
  })
}

/**
 * oauth.bitrix.info takes a GET with the secret in the query (apidocs settings/oauth), which cli-core's form POST is
 * not. So no failure here quotes the address, the request or the answer: all three hold the code or a token.
 */
const exchange = async (
  params: Record<string, string>,
  context: ExchangeContext,
  seen: (endpoint: unknown) => void,
): Promise<TokenSet> => {
  const grant = params.grant_type === "refresh_token" ? "refresh_token" : "authorization_code"
  const given = grant === "refresh_token" ? params.refresh_token : params.code
  const again = `run ${context.signInCommand} again`
  const query = new URLSearchParams({
    grant_type: grant,
    client_id: context.client.clientId,
    client_secret: context.client.clientSecret ?? "",
    [grant === "refresh_token" ? "refresh_token" : "code"]: given ?? "",
  })
  const deadline = new AbortController()
  const timer = setTimeout(() => deadline.abort(), REQUEST_MS)
  timer.unref()
  const signal = context.signal ? AbortSignal.any([context.signal, deadline.signal]) : deadline.signal
  try {
    let response: Response
    try {
      response = await hostFetch({ hosts: [OAUTH_HOST], fetch: context.fetch, timeoutMs: REQUEST_MS })(
        `${TOKEN_URL}?${query}`,
        { headers: { accept: "application/json" }, redirect: "error", signal },
      )
    } catch {
      if (context.signal?.aborted) throw new CliError("cancelled", "the Bitrix24 sign-in was cancelled")
      throw new CliError("outcome_unknown", `Bitrix24's token request did not finish; ${again} if it keeps failing`, {
        reason: "oauth.no-response",
      })
    }
    const body: unknown = await response.json().catch(() => undefined)
    const error = isRecord(body) ? body.error : undefined
    if (!response.ok || error !== undefined) {
      const code = typeof error === "string" && CODE.test(error) ? error.toUpperCase() : undefined
      throw refusal(code, response.ok ? 400 : response.status, again)
    }
    const fields = isRecord(body) ? body : {}
    const { access_token: access, refresh_token: refresh, expires_in: expiresIn, scope } = fields
    if (
      typeof access !== "string" ||
      !access ||
      typeof refresh !== "string" ||
      !refresh ||
      typeof expiresIn !== "number" ||
      !(expiresIn > 0)
    )
      throw new CliError("invalid_response", `Bitrix24 returned a token answer b24 cannot use; ${again}`, {
        reason: "oauth.invalid-response",
      })
    seen(fields.client_endpoint)
    return {
      accessToken: access,
      refreshToken: refresh,
      expiresAt: context.now() + expiresIn * 1000,
      // Comma-separated, unlike OAuth's spaces (apidocs settings/oauth).
      scopes: typeof scope === "string" ? scope.split(",").filter(Boolean) : [],
    }
  } finally {
    clearTimeout(timer)
  }
}

export const appProvider = (
  host: string,
  client: OAuthClient,
  seen: (endpoint: unknown) => void = () => {},
): OAuthProvider => ({
  id: PROVIDER,
  name: "Bitrix24",
  authorizeUrl: `https://${host}/oauth/authorize/`,
  tokenUrl: TOKEN_URL,
  client,
  redirect: { kind: "relay", url: RELAY_URL },
  exchange: (params, context) => exchange(params, context, seen),
})

/** A bare host, `https://` and a path pasted with it allowed; never an address with credentials or a port. */
export const portalHost = (raw: string): string => {
  const text = raw.trim()
  let url: URL
  try {
    url = new URL(/^[a-z]+:\/\//i.test(text) ? text : `https://${text}`)
  } catch {
    throw new CliError("validation_error", "--portal takes the portal's address, such as example.bitrix24.ru")
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port || !url.hostname.includes("."))
    throw new CliError("validation_error", "--portal takes the portal's https address, such as example.bitrix24.ru")
  return url.hostname
}

/** `client_endpoint`, checked: the token goes to that address, so it must be the portal the owner named. */
const originOf = (endpoint: unknown, host: string): string => {
  const url = typeof endpoint === "string" && URL.canParse(endpoint) ? new URL(endpoint) : undefined
  if (url?.protocol !== "https:" || url.hostname !== host || url.pathname !== "/rest/")
    throw new CliError(
      "authentication_error",
      `Bitrix24 signed in to another portal than ${host}; sign in with that portal's address`,
      { reason: "oauth.mismatch" },
    )
  return url.origin
}

export interface AppSignInOptions<T> {
  env: NodeJS.ProcessEnv
  profile: string
  host: string
  client: OAuthClient
  storage: "keyring" | "file"
  keyring?: KeyringStore | undefined
  fetch?: typeof fetch | undefined
  signal?: AbortSignal | undefined
  signInCommand: string
  steps: Omit<SignInSteps, "scopes" | "accept">
  /** Whose rights the new tokens carry, asked of the portal before anything is kept. */
  check: (auth: AppAuth) => Promise<T>
}

/** The local application's sign-in: authorize through the relay, exchange, ask the portal who it is, then keep it. */
export const appSignIn = async <T extends { id: string }>(
  options: AppSignInOptions<T>,
): Promise<{ origin: string; user: T }> => {
  let endpoint: unknown
  let origin = ""
  let user: T | undefined
  const keeper = tokenKeeper({
    provider: appProvider(options.host, options.client, (seen) => {
      endpoint = seen
    }),
    storage: appStorage(options.env, options.profile, options.keyring, options.storage === "file" ? "file" : "auto"),
    lockDir: paths(options.env).config,
    fetch: options.fetch ?? fetch,
    signInCommand: options.signInCommand,
    ...(options.signal ? { signal: options.signal } : {}),
  })
  await keeper.signIn({
    ...options.steps,
    // The application card holds the scopes; Bitrix24 takes no `scope` in the request.
    scopes: [],
    accept: async (tokens) => {
      origin = originOf(endpoint, options.host)
      const token = tokens.accessToken ?? ""
      user = await options.check({ origin, userId: "", accessToken: async () => token })
      return { origin, userId: user.id }
    },
  })
  if (!user) throw new CliError("authentication_error", "Bitrix24 did not say whose sign-in this is")
  return { origin, user }
}

/** The profile's application sign-in, refreshed under cli-core's shared lock; none when the profile has none. */
export const appAuthOf = (options: {
  env: NodeJS.ProcessEnv
  profile: string
  keyring?: KeyringStore | undefined
  fetch?: typeof fetch | undefined
  signal?: AbortSignal | undefined
}): AppAuth | undefined => {
  const storage = appStorage(options.env, options.profile, options.keyring)
  const stored = storage.read()
  if (!stored) return undefined
  const kept = keptOf(stored)
  if (!kept || !stored.client)
    throw new CliError("authentication_error", "the saved Bitrix24 sign-in cannot be read; sign in again", {
      reason: "oauth.invalid",
    })
  const host = new URL(kept.origin).hostname
  const keeper = tokenKeeper({
    provider: appProvider(host, stored.client),
    storage,
    lockDir: paths(options.env).config,
    fetch: options.fetch ?? fetch,
    signInCommand: `${IDENTITY.command} ${options.profile} session start --portal ${host} --client-id ${stored.client.clientId}`,
    ...(options.signal ? { signal: options.signal } : {}),
  })
  return { ...kept, accessToken: (refresh) => keeper.accessToken({ refresh }) }
}
