import { annotate } from "@wirecat/cli-base/commands"
import { defineQuery, queryFieldsOf } from "@wirecat/cli-base/query"
import {
  answerEntity,
  commandPath,
  itemOf,
  listQuery,
  nativeTerms,
  outputFor,
  pagedList,
  REMOTE_READ,
  renderAnswer,
  searchText,
  typedQuery,
  withPaging,
  withQuery,
} from "@wirecat/cli-core/cli"
import { conditionsOf } from "@wirecat/cli-core/crm"
import { Command } from "commander"
import type { Condition } from "../crm/conditions.js"
import { getProduct, listProducts, PRODUCT_FIELDS, PRODUCT_NAME, productSchema } from "../crm/product.js"
import { EVERY } from "../crm/rows.js"
import { IDENTITY } from "../identity.js"
import { contextOf, withPortal } from "../portal.js"

const B24 = IDENTITY.command

const PRODUCTS_QUERY = defineQuery({
  entity: "product",
  backend: "native",
  fields: queryFieldsOf(productSchema, { native: ["name", ...Object.keys(PRODUCT_FIELDS)], text: ["name"] }),
})

/** The product catalog, which cli-core's CRM port has no place for: b24's own, read live from the portal. */
export const productsCommand = (): Command =>
  annotate(new Command("products"), { effects: REMOTE_READ })
    .description("read the portal's product catalog")
    .addCommand(
      withPaging(
        withQuery(
          answerEntity(
            annotate(new Command("list"), {
              effects: REMOTE_READ,
              offline: false,
              examples: [`${B24} work products list`, `${B24} work products list active:true name:chair*`],
            }),
            "product",
            productSchema,
          ),
          PRODUCTS_QUERY,
        ),
      )
        .description("list catalog products on the portal, newest first")
        .action(async function (this: Command, words: string[]) {
          const path = commandPath(this)
          const terms = nativeTerms(listQuery(typedQuery(words), PRODUCTS_QUERY, path, { defaultField: "name" }), path)
          const name = searchText(terms.get("name"))
          terms.delete("name")
          const conditions: Condition[] = [
            ...conditionsOf(terms, PRODUCT_FIELDS),
            ...(name ? [{ field: PRODUCT_NAME, op: "like" as const, value: name }] : []),
          ]
          const { settings } = contextOf(this)
          const window = settings.all ? EVERY : { offset: (settings.page - 1) * settings.limit, limit: settings.limit }
          const found = await withPortal(this, (portal) => listProducts(portal, conditions, window))
          renderAnswer(this, outputFor(this), pagedList(path, settings, found))
        }),
    )
    .addCommand(
      answerEntity(
        annotate(new Command("show"), {
          effects: REMOTE_READ,
          offline: false,
          examples: [`${B24} work products show 42`, `${B24} work products show 42 --json`],
        }),
        "product",
        productSchema,
      )
        .description("show one of the catalog products on the portal")
        .argument("<product>", "the product's id, as list prints it")
        .action(async function (this: Command, reference: string) {
          const item = await withPortal(this, (portal) => getProduct(portal, reference))
          renderAnswer(this, outputFor(this), itemOf(item))
        }),
    )
