import { existsSync, readFileSync } from "node:fs"
import { withoutFileLinks } from "@wirecat/cli-core/crm"
import { describe, expect, it } from "vitest"
import { customFields } from "./crm/values.js"
import { fileIdsOf, REMOVED } from "./file-links.js"
import { fakeCrm } from "./testing/fake-crm.js"
import { fakePortal, ok } from "./testing/fake-portal.js"
import { b24, synced } from "./testing/harness.js"

const TOKEN = "FAKEFILETOKEN0123456789"
const HOST = "https://example.bitrix24.test"

/** The universal methods' file value (apidocs files/how-to-download-files#crm). */
const universal = (id: number) => ({
  id,
  url: `${HOST}/bitrix/services/main/ajax.php?action=crm.controller.item.getFile&entityTypeId=2&fileId=${id}`,
  urlMachine: `${HOST}/rest/crm.controller.item.getFile.json?auth=${TOKEN}&token=${TOKEN}`,
})

/** REST 2's file value (apidocs tutorials/crm/how-to-add-crm-objects/how-to-add-lead-with-files). */
const rest2 = (id: number) => ({
  id,
  showUrl: `/bitrix/components/bitrix/crm.lead.show/show_file.php?ownerId=5&fileId=${id}`,
  downloadUrl: `/bitrix/components/bitrix/crm.lead.show/show_file.php?auth=${TOKEN}&ownerId=5&fileId=${id}`,
})

describe("file values kept as ids", () => {
  it("keeps a file as its id, in both shapes, single and multiple", () => {
    expect(
      customFields({
        UF_CRM_ONE: universal(10),
        UF_CRM_MANY: [universal(11), universal(12)],
        ufCrm_5: rest2(37375),
        UF_CRM_REST2_MANY: [rest2(37377)],
        UF_CRM_NOTE: "plain",
      }),
    ).toEqual({
      UF_CRM_ONE: 10,
      UF_CRM_MANY: [11, 12],
      ufCrm_5: 37375,
      UF_CRM_REST2_MANY: [37377],
      UF_CRM_NOTE: "plain",
    })
  })

  it("marks a file with no id and a tokened portal link, and keeps the owner's own values whole", () => {
    expect(fileIdsOf({ urlMachine: `${HOST}/x?auth=${TOKEN}` })).toBe(REMOVED)
    expect(fileIdsOf([{ downloadUrl: "/x" }])).toEqual([REMOVED])
    expect(fileIdsOf(`${HOST}/rest/download.json?token=${TOKEN}`)).toBe(REMOVED)
    expect(fileIdsOf(`${HOST}/rest/7/${TOKEN}/disk.file.get?id=1`)).toBe(REMOVED)
    expect(fileIdsOf(`see ${HOST}/rest/download.json?x=1&amp;auth=${TOKEN}`)).toBe(REMOVED)
    expect(fileIdsOf(`${HOST}/crm_show_file.php?fileId=1&auth=${TOKEN}`)).toBe(REMOVED)
    expect(fileIdsOf({ amount: 1, nested: { at: [rest2(4)] } })).toEqual({ amount: 1, nested: { at: [4] } })
    expect(customFields({ UF_CRM_GONE: [{ urlMachine: `${HOST}/x?auth=${TOKEN}` }], UF_CRM_ZERO: 0 })).toEqual({
      UF_CRM_GONE: [REMOVED],
      UF_CRM_ZERO: 0,
    })
    const own = {
      UF_CRM_SITE: "https://shop.example/?token=promo",
      UF_CRM_LINK: { url: "https://shop.example/catalog", title: "Catalog" },
      UF_CRM_LINKS: [{ id: 5, URL: "https://shop.example/a", title: "A" }],
      UF_CRM_TIMELINE: { id: 9, urlShow: `${HOST}/disk/downloadFile/9/`, urlDownload: `${HOST}/disk/downloadFile/9/` },
    }
    expect(customFields(own)).toEqual(own)
  })

  it("withoutFileLinks replaces download and tokened links, and leaves the rest as given", () => {
    expect(
      withoutFileLinks({
        item: {
          id: 1,
          UF_CRM_1: [universal(10)],
          UF_CRM_2: rest2(11),
          title: "Kitchen",
          empty: { DOWNLOAD_URL: null },
        },
        files: [{ DOWNLOAD_URL: `${HOST}/disk/download?x=1`, NAME: "a.pdf" }, `${HOST}/rest/x?access_token=${TOKEN}`],
        document: { id: 51, publicUrl: `${HOST}/~bat5R`, printUrlMachine: `${HOST}/rest/x.json?auth=${TOKEN}` },
        site: "https://shop.example/?token=promo",
      }),
    ).toEqual({
      item: {
        id: 1,
        UF_CRM_1: [{ id: 10, url: universal(10).url, urlMachine: REMOVED }],
        UF_CRM_2: { id: 11, showUrl: rest2(11).showUrl, downloadUrl: REMOVED },
        title: "Kitchen",
        empty: { DOWNLOAD_URL: null },
      },
      files: [{ DOWNLOAD_URL: REMOVED, NAME: "a.pdf" }, REMOVED],
      document: { id: 51, publicUrl: REMOVED, printUrlMachine: REMOVED },
      site: "https://shop.example/?token=promo",
    })
  })
})

/** Every byte SQLite holds for the store: a fresh write may sit in the write-ahead log only. */
const storeBytes = () =>
  ["", "-wal", "-shm"]
    .map((suffix) => `${process.env.MESSAGING_STORE}${suffix}`)
    .filter((file) => existsSync(file))
    .map((file) => readFileSync(file).toString("latin1"))
    .join("")

const withFiles = () => {
  const crm = fakeCrm()
  // Typed as a string: the value's shape decides, not the field's type.
  crm.addField("deal", { code: "UF_CRM_SCAN", title: "Scan", type: "string" })
  crm.addField("deal", { code: "UF_CRM_CONTRACT", title: "Contract", type: "file", multiple: true })
  const deal = crm.put("deal", {
    title: "Example kitchen",
    categoryId: 0,
    stageId: "PREPARATION",
    UF_CRM_CONTRACT: [universal(10), universal(12)],
    UF_CRM_SCAN: rest2(37375),
  })
  return { crm, deal }
}

describe("no file link in the copy or the output (RISK-2313)", () => {
  it("sync stores a deal's files as ids, and deals show prints no link", async () => {
    const { crm, deal } = withFiles()
    const { ref } = await synced(crm)
    const bytes = storeBytes()
    expect(bytes).toContain("Example kitchen")
    for (const leak of [TOKEN, "getFile", "show_file.php"]) expect(bytes).not.toContain(leak)

    const offline = await b24(["work", "--offline", "deals", "show", ref("deals", deal), "--json"], { portal: crm })
    const live = await b24(["work", "deals", "show", ref("deals", deal), "--json"], { portal: crm })
    const human = await b24(["work", "deals", "show", ref("deals", deal)], { portal: crm })
    for (const ran of [offline, live, human]) {
      expect(ran.code).toBe(0)
      expect(ran.out + ran.err).not.toContain(TOKEN)
      expect(ran.out + ran.err).not.toContain("getFile")
    }
    expect((live.json().item as Record<string, Record<string, unknown>>).provider_metadata).toMatchObject({
      UF_CRM_CONTRACT: { label: "Contract", value: [10, 12] },
      UF_CRM_SCAN: { label: "Scan", value: 37375 },
    })
  })

  it("api call prints no download link, from crm.item.get or a list", async () => {
    const { crm, deal } = withFiles()
    const item = await b24(
      ["work", "api", "call", "crm.item.get", "--body", JSON.stringify({ entityTypeId: 2, id: deal }), "--json"],
      { portal: crm },
    )
    const list = await b24(
      ["work", "api", "call", "crm.deal.list", "--body", '{"select":["id","UF_CRM_CONTRACT","UF_CRM_SCAN"]}', "--json"],
      { portal: crm },
    )
    for (const ran of [item, list]) {
      expect(ran.code).toBe(0)
      expect(ran.out + ran.err).not.toContain(TOKEN)
      expect(ran.out).toContain(REMOVED)
    }
    expect(item.json().item).toMatchObject({
      result: {
        item: {
          UF_CRM_CONTRACT: [
            { id: 10, urlMachine: REMOVED },
            { id: 12, urlMachine: REMOVED },
          ],
        },
      },
    })
  })

  it("sync --rescan rewrites a listed row stored with a link before this fix, not a deleted one", async () => {
    const { crm } = withFiles()
    const gone = crm.put("deal", { title: "Example gone", categoryId: 0, stageId: "PREPARATION" })
    await synced(crm)
    crm.remove("deal", gone)
    expect((await b24(["work", "sync", "--json"], { portal: crm })).code).toBe(0)
    const { DatabaseSync } = await import("node:sqlite")
    const database = new DatabaseSync(process.env.MESSAGING_STORE as string)
    try {
      database
        .prepare("UPDATE deals SET metadata = ?")
        .run(JSON.stringify({ UF_CRM_CONTRACT: { label: "Contract", value: [universal(10)] } }))
    } finally {
      database.close()
    }
    expect((await b24(["work", "sync", "--rescan", "--json"], { portal: crm })).code).toBe(0)
    const reading = new DatabaseSync(process.env.MESSAGING_STORE as string, { readOnly: true })
    try {
      const rows = reading.prepare("SELECT title, deleted_at, metadata FROM deals").all() as {
        title: string
        deleted_at: number | null
        metadata: string | null
      }[]
      // A record gone from the portal is only marked deleted, so no later sync rewrites it: docs/security.md says so.
      expect(rows.map((row) => [row.title, row.deleted_at !== null, (row.metadata ?? "").includes(TOKEN)])).toEqual([
        ["Example kitchen", false, false],
        ["Example gone", true, true],
      ])
    } finally {
      reading.close()
    }
  })
})

describe("generated documents through api call", () => {
  it("prints no public or download link of a document", async () => {
    const portal = fakePortal({
      "crm.documentgenerator.document.get": ok({
        document: {
          id: 51,
          title: "Contract",
          publicUrl: `${HOST}/~bat5R`,
          downloadUrlMachine: `${HOST}/rest/d?auth=${TOKEN}`,
        },
      }),
    })
    const ran = await b24(
      ["work", "api", "call", "crm.documentgenerator.document.get", "--body", '{"id":51}', "--json"],
      {
        portal,
      },
    )
    expect(ran.code).toBe(0)
    expect(ran.out).not.toContain("~bat5R")
    expect(ran.out).not.toContain(TOKEN)
    expect(ran.json().item).toMatchObject({ result: { document: { id: 51, title: "Contract", publicUrl: REMOVED } } })
  })
})

describe("public link methods", () => {
  it("api call refuses a document's public link, reads and writes alike", async () => {
    for (const method of ["crm.documentgenerator.document.enablePublicUrl", "crm.invoice.getExternalLink"]) {
      const ran = await b24(["work", "api", "call", method, "--body", '{"id":1}'])
      expect(ran.code).toBe(5)
    }
  })
})
