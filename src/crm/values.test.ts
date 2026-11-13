import { describe, expect, it } from "vitest"
import { amountOf, fullName } from "./values.js"

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

describe("amountOf", () => {
  const amount = (value: unknown) => amountOf(value, "rub").amount

  it("keeps the portal's digits where toFixed added the double's error", () => {
    expect(amount(98765432109.87)).toBe("98765432109.87")
    expect(amount(1234567890123.45)).toBe("1234567890123.45")
    expect(amount(1e15)).toBe("1000000000000000")
    expect(amount(1e15 + 0.5)).toBe("1000000000000000.5")
    expect(amount("19999.99")).toBe("19999.99")
    expect(amount(" 20000.00 ")).toBe("20000.00")
  })

  it("passes fractional kopecks on as sent, for core to refuse by the currency's decimals", () => {
    expect(amount(0.005)).toBe("0.005")
    expect(amount("150.125")).toBe("150.125")
  })

  it("reads 0, a negative amount and no currency as no amount", () => {
    expect(amountOf(0, "RUB")).toEqual({ amount: null, currency: null })
    expect(amountOf("0.00", "RUB")).toEqual({ amount: null, currency: null })
    expect(amountOf(-1500.5, "RUB")).toEqual({ amount: null, currency: null })
    expect(amountOf(1500, null)).toEqual({ amount: null, currency: null })
    expect(amountOf(1500, "eur")).toEqual({ amount: "1500", currency: "EUR" })
  })
})
