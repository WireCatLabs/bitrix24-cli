import * as v from "valibot"
import type { BitrixTransport } from "../bitrix/transport.js"
import { type Condition, rest2Filter } from "./conditions.js"
import { id, number, numericId, type Raw, text, yes } from "./values.js"
import { rest2Rows, type Window } from "./walk.js"

export const productSchema = v.strictObject({
  id: v.string(),
  name: v.nullable(v.string()),
  price: v.nullable(v.number()),
  currency: v.nullable(v.string()),
  active: v.boolean(),
  section_id: v.nullable(v.string()),
})

export type Product = v.InferOutput<typeof productSchema>

export const PRODUCT_FIELDS = {
  name: { field: "NAME", kind: "word" },
  active: { field: "ACTIVE", kind: "text" },
  section_id: { field: "SECTION_ID", kind: "id" },
} as const

const SELECT = ["ID", "NAME", "PRICE", "CURRENCY_ID", "ACTIVE", "SECTION_ID"]

/** The CRM catalog through REST 2's crm.product.*; upper-case fields, as that older API names them. */
export const fromBitrixProduct = (raw: Raw): Product => ({
  id: id(raw.ID) ?? "",
  name: text(raw.NAME),
  price: number(raw.PRICE),
  currency: text(raw.CURRENCY_ID),
  active: yes(raw.ACTIVE),
  section_id: id(raw.SECTION_ID),
})

const activeAsBitrix = (conditions: readonly Condition[]) =>
  conditions.map((one) => (one.field === "ACTIVE" ? { ...one, value: one.value === "true" ? "Y" : "N" } : one))

export const listProducts = async (portal: BitrixTransport, conditions: readonly Condition[], window: Window) => {
  const { items, has_more } = await rest2Rows(
    portal,
    "crm.product.list",
    { select: SELECT, filter: rest2Filter(activeAsBitrix(conditions)), order: { ID: "DESC" } },
    window,
  )
  return { items: items.map(fromBitrixProduct), has_more }
}

export const getProduct = async (portal: BitrixTransport, reference: string): Promise<Product> =>
  fromBitrixProduct((await portal.call("crm.product.get", { id: numericId(reference, "products show") })).result as Raw)
