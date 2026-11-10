import { describe, expect, it } from "vitest"
import { fullName } from "./values.js"

describe("fullName", () => {
  it("drops the null and null #<id> an import left in a name field", () => {
    expect(fullName("Ярослав", null, "Орлов null #907")).toBe("Ярослав Орлов")
    expect(fullName("Алексей", "null", "null #100001")).toBe("Алексей")
    expect(fullName("null", null, "null #5")).toBeNull()
  })

  it("keeps a name that only contains the word", () => {
    expect(fullName("Nullah", null, "Annull")).toBe("Nullah Annull")
  })
})
