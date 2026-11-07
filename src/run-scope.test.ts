import { copyFileSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Readable } from "node:stream"
import { neverAnswers, runScopeCases } from "@wirecat/cli-core/testing"
import { beforeAll, describe, expect, it } from "vitest"
import type { FetchLike } from "./bitrix/transport.js"
import { definition } from "./program.js"
import { seededCrm } from "./testing/fake-crm.js"
import { FAKE_HOOK, ok } from "./testing/fake-portal.js"
import { signedIn, synced } from "./testing/harness.js"

const PRODUCT = { ID: "11", NAME: "Chair", PRICE: "99.90", CURRENCY_ID: "EUR", ACTIVE: "Y", SECTION_ID: "2" }
const USER = { ID: "7", NAME: "Anna", LAST_NAME: "Admin", EMAIL: "anna@example.test" }

const portal = () =>
  seededCrm({
    "user.current": ok(USER),
    "user.admin": ok(true),
    "user.get": ok([USER]),
    "crm.product.list": ok([PRODUCT], { total: 1 }),
    "crm.product.get": ok(PRODUCT),
    "crm.item.get": ok({ item: {} }),
  })

// The writes name stored deals and leads, so each case gets its own copy of one synced store.
let seeded = ""
// The cases are built before the store is synced, so they name the refs the seeded sync gives; beforeAll checks them.
const REFS = { deals: "deal:1", leads: "lead:1" }
beforeAll(async () => {
  seeded = join(mkdtempSync(join(tmpdir(), "run-scope-seed-")), "store.db")
  process.env.MESSAGING_STORE = seeded
  const { ref } = await synced(portal())
  expect([ref("deals", 102), ref("leads", 104)]).toEqual([REFS.deals, REFS.leads])
})

const options = (fetch: FetchLike) => {
  const store = join(mkdtempSync(join(tmpdir(), "run-scope-")), "store.db")
  copyFileSync(seeded, store)
  return {
    tty: false,
    keyring: signedIn(),
    fetch,
    sleep: async () => {},
    env: { ...process.env, MESSAGING_STORE: store },
    stdin: Object.assign(Readable.from([`${FAKE_HOOK}\n`]), { isTTY: false }),
  }
}

describe("every remote command runs inside cli-core's run", () => {
  const writes = (noun: "deals" | "leads", pipeline: string, stage: string) => ({
    [`${noun} create`]: ["work", noun, "create", "--title", "WireCat test", "--pipeline", pipeline],
    [`${noun} update`]: ["work", noun, "update", REFS[noun], "--title", "Example renamed"],
    [`${noun} move`]: ["work", noun, "move", REFS[noun], stage],
    [`${noun} close`]: ["work", noun, "close", REFS[noun], "lost"],
    [`${noun} delete`]: ["work", noun, "delete", REFS[noun], "--yes"],
  })
  for (const { name, run } of runScopeCases({
    definition: definition(),
    commands: {
      "session start": ["work", "session", "start"],
      "session status": ["work", "session", "status", "--check"],
      sync: ["work", "sync"],
      ...writes("deals", "Example sales", "New"),
      ...writes("leads", "Leads", "Unprocessed"),
      "people list": ["work", "people", "list"],
      "people show": ["work", "people", "show", "101"],
      "people create": ["work", "people", "create", "--first-name", "Anna"],
      "people update": ["work", "people", "update", "101", "--last-name", "Example"],
      "organizations list": ["work", "organizations", "list"],
      "organizations show": ["work", "organizations", "show", "100"],
      "organizations create": ["work", "organizations", "create", "--name", "Example"],
      "organizations update": ["work", "organizations", "update", "100", "--name", "Example Ltd"],
      "products list": ["work", "products", "list"],
      "products show": ["work", "products", "show", "11"],
      "users list": ["work", "users", "list"],
      "users show": ["work", "users", "show", "7"],
      "api call": ["work", "api", "call", "crm.deal.update", "--body", '{"id":102,"fields":{"title":"Example"}}'],
    },
    skip: {
      "mcp serve": "listens until stopped; src/mcp.test.ts and src/permissions.test.ts run it",
      "schedule run": "starts b24 again as its own process, which then runs inside its own run; src/schedule.test.ts",
      "schedule exec": "the timer's entry: starts b24 again as its own process; src/schedule.test.ts",
      doctor: "cli-core's appDoctorCommand: 0.598.0 answers --online under the process run, a cli-core fix",
    },
    answering: () => options(portal().fetch),
    silent: () => options(neverAnswers),
  }))
    it(name, run)
})
