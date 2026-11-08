import { realpathSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { pathToFileURL } from "node:url"

// The previous release writes the state with its own modules and its own cli-core: a sync from a fake portal, as
// `b24 sync` makes one, so the candidate reopens the schema, rows and sync cursors that release left. The webhook is
// left out: cli-core's token store reaches for the keyring even to write a file, and the runner denies the keyring.
const entry = realpathSync(process.argv[2])
const fromPrevious = createRequire(entry)
const previous = (path) => import(pathToFileURL(join(dirname(entry), "..", path)).href)
const core = (name) => import(pathToFileURL(fromPrevious.resolve(`@wirecat/cli-core/${name}`)).href)

if (!process.env.WIRECAT_CONTRACT_DENIED) throw new Error("requires the isolated contract runner")

const [{ IDENTITY }, { openB24Store, PROVIDER }, { bitrixCrmSource }, { syncCrm }] = await Promise.all([
  previous("identity.js"),
  previous("store.js"),
  previous("crm/source.js"),
  core("crm"),
])

const account = "synthetic.bitrix24.example"
const now = Date.parse("2026-10-01T10:00:00Z")

const deal = {
  id: 7,
  title: "wirecat-synthetic-deal-canary",
  categoryId: 0,
  stageId: "NEW",
  opportunity: 1500,
  currencyId: "EUR",
  companyId: 0,
  contactsId: [],
  closeTime: "2026-10-20T00:00:00+00:00",
  createdTime: "2026-09-30T10:00:00+00:00",
  updatedTime: "2026-09-30T10:00:00+00:00",
  url: null,
  assignedById: 1,
}

/** One page of a REST 3.0 list, then an empty one: the source pages by id. */
const listed = (rows, params) => {
  const after = params.filter?.find(([field, op]) => field === "id" && op === ">")?.[2] ?? 0
  return { result: { items: rows.filter((row) => row.id > after) } }
}

const answers = {
  "crm.deal.list": (params) => listed([deal], params),
  "crm.category.list": () => ({ result: { categories: [{ id: 0, name: "Synthetic pipeline" }] } }),
  "crm.status.list": (params) =>
    params.filter.ENTITY_ID === "DEAL_STAGE"
      ? { result: [{ STATUS_ID: "NEW", NAME: "New", SORT: 10, SEMANTICS: null }] }
      : { result: [] },
}

const portal = { call: async (method, params) => answers[method]?.(params) ?? { result: [] } }

const store = await openB24Store(process.env)
try {
  const key = { provider: PROVIDER.name, account }
  await store.accounts.saveAccount(key, { name: null })
  await store.accounts.saveProfile(IDENTITY.command, "contract", key)
  const report = await syncCrm(
    bitrixCrmSource(() => portal),
    store,
    key,
    { now },
  )
  const failed = report.synced.filter((one) => one.error !== undefined || one.state !== "complete")
  if (failed.length) throw new Error(`the previous release's sync did not complete: ${JSON.stringify(failed)}`)
} finally {
  await store.close()
}
process.stdout.write(`${JSON.stringify({ seeded: true })}\n`)
