import { CliError } from "@wirecat/cli-base"
import { type CrmQueryField, type CrmWindow, crmValues } from "@wirecat/cli-core/crm"
import * as v from "valibot"
import type { BitrixTransport } from "../bitrix/transport.js"
import { type Condition, rest2Filter } from "./conditions.js"
import { rest2Rows } from "./rows.js"
import { numericId, type Raw, yes } from "./values.js"

const { id, isRaw, number, text } = crmValues

export const productSchema = v.strictObject({
  id: v.string(),
  name: v.nullable(v.string()),
  price: v.nullable(v.number()),
  currency: v.nullable(v.string()),
  active: v.boolean(),
  section_id: v.nullable(v.string()),
})

export type Product = v.InferOutput<typeof productSchema>

/** The fields a products query filters by, besides `name`, a substring of `NAME`. */
export const PRODUCT_FIELDS: Record<string, CrmQueryField> = {
  active: { field: "ACTIVE", kind: "text" },
  section_id: { field: "SECTION_ID", kind: "id" },
}

export const PRODUCT_NAME = "NAME"

const SELECT = ["ID", "NAME", "PRICE", "CURRENCY_ID", "ACTIVE", "SECTION_ID"]

/**
 * The CRM catalog through REST 2's crm.product.*; upper-case fields, as that older API names them
 * (https://apidocs.bitrix24.com/api-reference/crm/outdated/products/crm-product-fields.html).
 */
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

export const listProducts = async (portal: BitrixTransport, conditions: readonly Condition[], window: CrmWindow) => {
  const { items, hasMore } = await rest2Rows(
    portal,
    "crm.product.list",
    { select: SELECT, filter: rest2Filter(activeAsBitrix(conditions)), order: { ID: "DESC" } },
    window,
  )
  return { items: items.map(fromBitrixProduct), hasMore }
}

export const getProduct = async (portal: BitrixTransport, reference: string): Promise<Product> => {
  const { result } = await portal.call("crm.product.get", { id: numericId(reference, "a product's id") })
  if (!isRaw(result)) throw new CliError("not_found", `there is no product ${reference}`)
  return fromBitrixProduct(result)
}
