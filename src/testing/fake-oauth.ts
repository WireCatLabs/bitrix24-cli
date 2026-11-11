import type { FetchLike } from "../bitrix/transport.js"
import { fakePortal } from "./fake-portal.js"

export const FAKE_CLIENT_ID = "local.wirecatfake0app.42"
export const FAKE_CLIENT_SECRET = "wirecatfake0clientsecret42"
export const FAKE_CODE = "wirecatfake0code"

/**
 * oauth.bitrix.info and the portal behind it, shaped as apidocs settings/oauth shows: a GET that exchanges a code
 * or a refresh token, which rotates, and a portal that answers `expired_token` to anything but the current token.
 */
export const fakeApp = (portal: { fetch: FetchLike } = fakePortal()) => {
  let issued = 0
  let access = ""
  let refresh = ""
  const exchanges: URLSearchParams[] = []
  const tokenCalls: string[] = []
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
  const issue = () => {
    issued++
    access = `wirecatfake0access${issued}`
    refresh = `wirecatfake0refresh${issued}`
    return json(200, {
      access_token: access,
      client_endpoint: "https://example.bitrix24.test/rest/",
      domain: "oauth.bitrix.info",
      expires_in: 3600,
      member_id: "a223c6b3710f85df22e9377d6c4f7553",
      refresh_token: refresh,
      scope: "crm,user_basic,department",
      server_endpoint: "https://oauth.bitrix.info/rest/",
      status: "L",
    })
  }
  const fetch: FetchLike = async (url, init) => {
    const address = new URL(url)
    if (address.host === "oauth.bitrix.info") {
      if (init.method !== undefined && init.method !== "GET") throw new Error("fake oauth: the token request is a GET")
      if (address.pathname !== "/oauth/token/") return json(404, {})
      const query = address.searchParams
      exchanges.push(query)
      if (query.get("client_id") !== FAKE_CLIENT_ID || query.get("client_secret") !== FAKE_CLIENT_SECRET)
        return json(401, { error: "invalid_client", error_description: "Invalid client" })
      const grant = query.get("grant_type")
      if (grant === "authorization_code" && query.get("code") === FAKE_CODE) return issue()
      if (grant === "refresh_token" && query.get("refresh_token") === refresh && refresh) return issue()
      return json(400, { error: "invalid_grant", error_description: "Invalid grant" })
    }
    const token = JSON.parse(String(init.body ?? "{}")).auth
    tokenCalls.push(address.pathname)
    if (token === undefined) return json(401, { error: "NO_AUTH_FOUND", error_description: "Wrong authorization data" })
    if (token !== access)
      return json(401, { error: "expired_token", error_description: "The access token provided has expired." })
    return portal.fetch(url, init)
  }
  return {
    fetch,
    exchanges,
    tokenCalls,
    /** The portal stops taking the current access token before its hour is up, as a revoked session does. */
    expire: () => {
      access = `${access}-expired`
    },
    get access() {
      return access
    },
  }
}
