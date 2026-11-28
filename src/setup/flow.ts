import { CliError } from "@wirecat/cli-base"
import { defineSetup, type SetupCheck } from "@wirecat/cli-core"
import { appStorage } from "../bitrix/oauth.js"
import { checkedWebhook, refuseSignInHere } from "../commands/session.js"
import { configuration } from "../config.js"
import { IDENTITY } from "../identity.js"
import { contextOf, storedSignIn, withPortal } from "../portal.js"
import { webhookUser } from "../whoami.js"
import en from "./texts.en.json" with { type: "json" }
import es from "./texts.es.json" with { type: "json" }
import ru from "./texts.ru.json" with { type: "json" }

/**
 * The access permissions to tick, in the order Desktop lists them. Each needs `scope.<code>` in every texts file.
 * `user.admin` and `server.time` are in `basic`, which every webhook and application has.
 */
export const SCOPES = ["crm", "user_basic", "department", "task", "telephony", "disk", "documentgenerator"] as const

const scopeBlocks = SCOPES.map((code) => ({ type: "text" as const, text: `scope.${code}`, params: { code } }))

/** The same proof and the same account `session start` keeps; editing a profile without a new address checks the kept one. */
const check: SetupCheck = async ({ command, secrets }) => {
  refuseSignInHere(command)
  if (secrets.token !== undefined) {
    const typed = secrets.token.trim()
    if (!typed) throw new CliError("validation_error", "no webhook address was given", { param: "webhook" })
    const { portal, user, account } = await checkedWebhook(command, typed)
    const { env, profile, keyring } = contextOf(command)
    // A request prefers an application's sign-in to the webhook, so it would hide the webhook just proven.
    appStorage(env, profile, keyring).remove()
    return { portal, user, keep: { secrets: { token: typed }, account } }
  }
  const portal = new URL(storedSignIn(command).origin).host
  const user = await withPortal(command, webhookUser)
  return { portal, user, keep: { account: `${portal}:${user.id}` } }
}

const APP_COMMAND = "b24 <profile> session start --portal example.bitrix24.ru --client-id <Application ID>"

export const b24Setup = defineSetup({
  app: IDENTITY,
  configuration,
  check,
  start: "webhook",
  steps: {
    webhook: {
      title: "webhook.title",
      blocks: [
        { type: "text", text: "webhook.intro" },
        { type: "text", text: "webhook.steps" },
        { type: "group", role: "card", title: "scopes.title", blocks: scopeBlocks },
        { type: "note", role: "info", text: "webhook.access" },
      ],
      next: "address",
    },
    address: {
      title: "address.title",
      blocks: [
        { type: "text", text: "address.where" },
        {
          type: "input",
          id: "webhook",
          secret: "token",
          input: "password",
          label: "address.label",
          hint: "address.hint",
          placeholder: "address.placeholder",
        },
        { type: "note", role: "warning", text: "address.secret" },
      ],
      next: "check",
    },
    check: {
      kind: "run",
      title: "check.title",
      action: "apply",
      blocks: [{ type: "text", text: "check.body" }],
      next: [
        { when: { result: "check", is: "ok" }, to: "done" },
        { when: { result: "check", error: "permission_error" }, to: "webhook" },
        { when: { result: "check", error: "authentication_error" }, to: "address" },
        { when: { result: "check", error: "validation_error" }, to: "address" },
        { when: { result: "check", error: "conflict" }, to: "address" },
        { to: "failed" },
      ],
      back: false,
    },
    failed: {
      kind: "done",
      title: "failed.title",
      blocks: [{ type: "note", role: "danger", text: "failed.body" }],
      back: true,
    },
    done: {
      kind: "done",
      title: "done.title",
      blocks: [
        { type: "text", text: "done.body" },
        { type: "code", code: "b24 <profile> sync\nb24 <profile> deals list status:open", copy: true },
        {
          type: "group",
          role: "details",
          title: "done.app.title",
          blocks: [
            { type: "text", text: "done.app" },
            { type: "group", role: "card", title: "scopes.title", blocks: scopeBlocks },
            { type: "text", text: "done.app.run" },
            { type: "code", code: APP_COMMAND, copy: true },
          ],
        },
      ],
    },
  },
  texts: { en, ru, es },
})
