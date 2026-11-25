import { crmFilesContract } from "@wirecat/cli-core/crm/testing"
import { describe, expect, it } from "vitest"
import { BitrixTransport } from "../bitrix/transport.js"
import { FAKE_FILE_TOKEN, fakeCrm } from "../testing/fake-crm.js"
import { FAKE_WEBHOOK } from "../testing/fake-portal.js"
import { b24 } from "../testing/harness.js"
import { bitrixCrmSource } from "./source.js"

/** A portal with one deal of the signed-in user 7 holding a file of every kind, and a colleague's deal with one. */
const portalWithFiles = () => {
  const crm = fakeCrm()
  crm.addField("deal", { code: "UF_CRM_CONTRACT", title: "Contract", type: "file", multiple: true })
  const own = crm.put("deal", {
    title: "Example kitchen",
    stageId: "NEW",
    assignedById: 7,
    UF_CRM_CONTRACT: [crm.fieldFile(10, { bytes: "Signed field file" })],
  })
  crm.putDocument("deal", own, { id: 61, title: "Example offer", pdf: true, bytes: "Example offer text" })
  crm.putActivityFile("deal", own, 501, { id: 930, name: "brief.txt", bytes: "The kitchen brief" })
  crm.putCommentFile("deal", own, 801, { id: 931, name: "notes.txt", bytes: "Notes on the walnut kitchen" })
  crm.putCommentFile("deal", own, 802, { id: 932, name: "away.txt", bytes: "x", host: "elsewhere.example" })
  crm.putCommentFile("deal", own, 803, { id: 933, name: "page.txt", bytes: "x", html: true })
  const theirs = crm.put("deal", { title: "Example colleague's deal", stageId: "NEW", assignedById: 9 })
  crm.putCommentFile("deal", theirs, 804, { id: 934, name: "theirs.txt", bytes: "A colleague's walnut contract" })
  const transport = new BitrixTransport({ auth: FAKE_WEBHOOK, fetch: crm.fetch, sleep: async () => {} })
  return { crm, own: String(own), theirs: String(theirs), source: bitrixCrmSource(() => transport) }
}

const read = async (stream: ReadableStream<Uint8Array>) => new Response(stream).text()

describe("crmFilesContract over the fake portal", () => {
  for (const { name, run } of crmFilesContract(() => {
    const { source, own, theirs } = portalWithFiles()
    return {
      source,
      own: { kind: "deal", id: own },
      word: "walnut",
      foreign: { kind: "deal", id: theirs },
      token: FAKE_FILE_TOKEN,
      refused: [`deal:${own}:comment:802.932`, `deal:${own}:comment:803.933`],
    }
  }))
    it(name, run)
})

describe("a record's files on the portal", () => {
  it("lists the file fields, documents, activity and comment files with the record's assignee", async () => {
    const { source, own } = portalWithFiles()
    const found = await source.files?.({ kind: "deal", id: own })
    expect(found?.assignee).toBe("7")
    expect(found?.files.map(({ open: _, ...file }) => file)).toEqual([
      expect.objectContaining({ id: `deal:${own}:field:UF_CRM_CONTRACT.10`, name: "Contract 10", source: "field" }),
      expect.objectContaining({ id: `deal:${own}:document:61`, name: "Example offer.pdf", mime: "application/pdf" }),
      expect.objectContaining({ id: `deal:${own}:activity:501.930`, name: "brief.txt", size: 17 }),
      expect.objectContaining({ id: `deal:${own}:comment:801.931`, name: "notes.txt", size: 27 }),
      expect.objectContaining({ id: `deal:${own}:comment:802.932`, name: "away.txt" }),
      expect.objectContaining({ id: `deal:${own}:comment:803.933`, name: "page.txt" }),
    ])
    expect(JSON.stringify(found)).not.toContain(FAKE_FILE_TOKEN)
  })

  it("opens each file by a link asked for at that moment, with the headers the portal's download needs", async () => {
    const { crm, source, own } = portalWithFiles()
    const found = await source.files?.({ kind: "deal", id: own })
    const [field, , activity] = found?.files ?? []
    const asked = crm.calls.filter((call) => call.method === "crm.item.get").length
    expect(await read(await (field?.open() as Promise<ReadableStream<Uint8Array>>))).toBe("Signed field file")
    expect(crm.calls.filter((call) => call.method === "crm.item.get").length).toBe(asked + 1)
    expect(await read(await (activity?.open() as Promise<ReadableStream<Uint8Array>>))).toBe("The kitchen brief")
    expect(crm.calls.at(-1)?.headers).toMatchObject({
      Accept: "*/*",
      Referer: "https://example.bitrix24.test/",
      "User-Agent": expect.stringMatching(/^b24\//),
    })
  })

  it("lists the rest as a gap naming the scope when the webhook has no disk scope", async () => {
    const { crm, source, own } = portalWithFiles()
    crm.withhold("disk")
    const gaps: { message: string; scope?: string }[] = []
    const found = await source.files?.({ kind: "deal", id: own }, { spend: () => {}, gap: (gap) => gaps.push(gap) })
    expect(found?.files.map((file) => file.source)).toEqual(["field", "document", "comment", "comment", "comment"])
    expect(gaps).toEqual([expect.objectContaining({ scope: "disk" })])
    expect(gaps[0]?.message).toContain("activity files")
  })

  it("lists the other kinds when the employee may not read generated documents", async () => {
    const { crm, source, own } = portalWithFiles()
    crm.deny("crm.documentgenerator.document.list")
    const gaps: { message: string }[] = []
    const found = await source.files?.({ kind: "deal", id: own }, { spend: () => {}, gap: (gap) => gaps.push(gap) })
    expect(found?.files.some((file) => file.source === "document")).toBe(false)
    expect(found?.files).toHaveLength(5)
    expect(gaps[0]?.message).toContain("document files")
  })

  it("names a document by the file the portal has, and leaves out an activity file Drive no longer has", async () => {
    const { crm, source, own } = portalWithFiles()
    crm.putDocument("deal", Number(own), { id: 62, title: "Example draft", bytes: "Draft" })
    crm.putActivityFile("deal", Number(own), 502, { id: 940, name: "gone.txt", bytes: "x" })
    crm.forgetDrive(940)
    const gaps: { message: string }[] = []
    const found = await source.files?.({ kind: "deal", id: own }, { spend: () => {}, gap: (gap) => gaps.push(gap) })
    expect(found?.files.find((file) => file.id === `deal:${own}:document:62`)).toMatchObject({
      name: "Example draft.docx",
      mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    })
    expect(found?.files.some((file) => file.id.endsWith(".940"))).toBe(false)
    expect(gaps).toEqual([expect.objectContaining({ message: expect.stringContaining("1 file(s)") })])
  })

  it("lists the other kinds on a portal without the document generator", async () => {
    const { crm, source, own } = portalWithFiles()
    crm.answer("crm.documentgenerator.document.list", {
      status: 400,
      body: { error: "0", error_description: "Module documentgenerator is not installed" },
    })
    const gaps: { message: string }[] = []
    const found = await source.files?.({ kind: "deal", id: own }, { spend: () => {}, gap: (gap) => gaps.push(gap) })
    expect(found?.files).toHaveLength(5)
    expect(gaps[0]?.message).toContain("document files")
  })

  it("answers null for a record the employee may not see, and for an id that is no number", async () => {
    const { crm, source, theirs } = portalWithFiles()
    expect(await source.files?.({ kind: "deal", id: "12abc" })).toBeNull()
    crm.deny("crm.item.get")
    expect(await source.files?.({ kind: "deal", id: theirs })).toBeNull()
  })

  it("fails a download whose Drive file is gone as not found, without the link", async () => {
    const { crm, source, own } = portalWithFiles()
    const found = await source.files?.({ kind: "deal", id: own })
    crm.deny("disk.file.get")
    const comment = found?.files.find((file) => file.source === "comment")
    const error = await comment?.open().catch((caught: unknown) => caught)
    expect(error).toMatchObject({ code: "not_found", details: { reason: "crm.file-unavailable" } })
    expect(String((error as Error).message)).not.toContain(FAKE_FILE_TOKEN)
  })
})

describe("b24 files", () => {
  it("lists the files of a lead, a contact and a company, each by its own timeline", async () => {
    const crm = fakeCrm()
    const owners = {
      lead: crm.put("lead", { title: "Example form", stageId: "NEW" }),
      person: crm.put("contact", { name: "Anna" }),
      organization: crm.put("company", { title: "Example Ltd" }),
    }
    const types = { lead: "lead", person: "contact", organization: "company" } as const
    for (const [kind, owner] of Object.entries(owners) as [keyof typeof owners, number][]) {
      crm.putCommentFile(types[kind], owner, owner + 1000, { id: owner + 2000, name: `${kind}.txt`, bytes: kind })
      const ran = await b24(["work", "files", "list", `--${kind}`, String(owner), "--json"], { portal: crm })
      expect(ran.code).toBe(0)
      expect((ran.json().items as { name: string }[]).map((item) => item.name)).toEqual([`${kind}.txt`])
    }
  })

  it("lists a deal's files and downloads one with its text, with no link in either answer", async () => {
    const { crm, own } = portalWithFiles()
    const listed = await b24(["work", "files", "list", "--deal", own, "--json"], { portal: crm })
    expect(listed.code).toBe(0)
    expect(listed.out).not.toContain(FAKE_FILE_TOKEN)
    const id = `deal:${own}:comment:801.931`
    expect((listed.json().items as { id: string }[]).map((item) => item.id)).toContain(id)
    const downloaded = await b24(["work", "files", "download", id, "--json"], { portal: crm })
    expect(downloaded.code).toBe(0)
    expect(downloaded.out).not.toContain(FAKE_FILE_TOKEN)
    expect(downloaded.json().item).toMatchObject({ id, downloaded: true, text: "Notes on the walnut kitchen" })
  })
})
