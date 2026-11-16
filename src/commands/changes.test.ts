import { expect, it } from "vitest"
import { b24, synced } from "../testing/harness.js"

type Page = { items: { ref: string; account: { provider: string } }[]; page: { next_cursor?: string } }

it("changes list pages the synced portal's changes over one window, and prints them as CSV", async () => {
  await synced()
  const window = ["work", "changes", "list", "at:>2000-01-01", "--limit", "2"]
  const first = (await b24([...window, "--json"])).json() as Page
  expect(first.items).toHaveLength(2)
  expect(first.items[0]?.account.provider).toBe("bitrix24")
  const cursor = first.page.next_cursor ?? ""
  const second = (await b24([...window, "--cursor", cursor, "--json"])).json() as Page
  expect(second.items.map((one) => one.ref)).not.toContain(first.items[0]?.ref)
  const csv = await b24([...window, "--format", "csv"])
  expect(csv.code).toBe(0)
  expect(csv.out.split("\n")[0]).toMatch(/^change,at,kind,ref,title/)
})
