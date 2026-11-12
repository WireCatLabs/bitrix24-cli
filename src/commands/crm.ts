import { annotate } from "@wirecat/cli-base/commands"
import { defineQuery, type Predicate, type QueryRegistry, queryFieldsOf } from "@wirecat/cli-base/query"
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
  typedQuery,
  withPaging,
  withQuery,
} from "@wirecat/cli-core/cli"
import { csvColumnPaths, csvFormatOption, printCsv, refuseCsvConflict } from "@wirecat/cli-core/crm/cli"
import { Command } from "commander"
import type * as v from "valibot"
import type { BitrixTransport } from "../bitrix/transport.js"
import { quotaFile } from "../crm/clients.js"
import { conditionsOf, type FieldMap } from "../crm/conditions.js"
import {
  customConditions,
  customNames,
  filterableFields,
  selectedCodes,
  wantedCodes,
  withCustomFields,
} from "../crm/custom-query.js"
import { type Field, loadFields } from "../crm/fields.js"
import { getItem, type ItemType, listItems, resolveItem } from "../crm/items.js"
import { ORGANIZATION, ORGANIZATION_FIELDS, organizationSchema } from "../crm/organization.js"
import { PERSON, PERSON_FIELDS, personSchema } from "../crm/person.js"
import { getProduct, listProducts, PRODUCT_FIELDS, productSchema } from "../crm/product.js"
import { getUser, listUsers, USER_FIELDS, userSchema } from "../crm/user.js"
import type { Window } from "../crm/walk.js"
import { IDENTITY } from "../identity.js"
import { contextOf, withPortal } from "../portal.js"

const B24 = IDENTITY.command

interface Listed<T> {
  items: T[]
  has_more: boolean
}

interface Noun<T> {
  noun: string
  entity: string
  schema: v.StrictObjectSchema<v.ObjectEntries, undefined>
  what: string
  query: QueryRegistry
  /** The field a bare word in the query means. */
  word?: string
  examples: string[]
  list: (portal: BitrixTransport, terms: Map<string, Predicate>, window: Window) => Promise<Listed<T>>
  /** Deals, leads, people and organizations: a list that names the portal's own fields in its query or `--json`. */
  custom?: (portal: BitrixTransport, ask: CustomAsk, window: Window) => Promise<Listed<T> & { fields: Field[] }>
  show: (portal: BitrixTransport, reference: string, quota: string) => Promise<T>
  /** The argument `show` takes, a singular noun (WC-CMD-13). */
  reference: string
  takes: string
}

const nativeQuery = (
  entity: string,
  schema: v.GenericSchema,
  fields: Readonly<Record<string, FieldMap>>,
  examples: Record<string, string> = {},
) =>
  defineQuery({
    entity,
    backend: "native",
    fields: queryFieldsOf(schema, {
      exclude: ["provider_metadata", "url"],
      native: Object.keys(fields),
      text: Object.entries(fields)
        .filter(([, map]) => map.kind === "word")
        .map(([name]) => name),
      examples,
    }),
  })

interface CustomAsk {
  /** The query's names its own fields do not have. */
  names: string[]
  wanted: string[] | "all" | undefined
  /** The query's terms, validated against these fields. */
  terms: (registry: QueryRegistry) => Map<string, Predicate>
}

const CUSTOM_HELP = `
The portal's own fields, as \`fields list\` prints them:
  <code or label>:<value>    a field the portal can filter by; a list field takes its option's label or id.
                             A label with spaces: lead_source:web, or Lead\\ source:web
  --json=id,title,provider_metadata.<code>   adds that field to each item; provider_metadata alone adds them all`

const windowOf = (command: Command): Window => {
  const { settings } = contextOf(command)
  return settings.all ? { offset: 0 } : { offset: (settings.page - 1) * settings.limit, limit: settings.limit }
}

const csvDefaults = (schema: Noun<unknown>["schema"]): string[] => [
  ...Object.keys(schema.entries).filter((key) => key !== "provider_metadata"),
  "provider_metadata",
]

const listCommand = <T extends Record<string, unknown>>(noun: Noun<T>) => {
  const command = withPaging(
    withQuery(
      answerEntity(
        annotate(new Command("list"), { effects: REMOTE_READ, offline: false, examples: noun.examples }),
        noun.entity,
        noun.schema,
      ),
      noun.query,
    ),
  )
    .description(`list ${noun.what} on the portal, newest first`)
    .addHelpText("after", noun.custom ? CUSTOM_HELP : "")
  if (noun.custom) command.addOption(csvFormatOption())
  return command.action(async function (this: Command, words: string[]) {
    const csv = this.opts<{ format?: "csv" }>().format === "csv"
    if (csv) refuseCsvConflict(this)
    const path = commandPath(this)
    const text = typedQuery(words)
    const options = noun.word ? { defaultField: noun.word } : {}
    const termsOf = (registry: QueryRegistry) => nativeTerms(listQuery(text, registry, path, options), path)
    const names = noun.custom ? customNames(text, noun.query, path, noun.word) : []
    const paths = csv ? csvColumnPaths(this, csvDefaults(noun.schema)) : []
    const columns = this.optsWithGlobals<{ fields?: string }>().fields
    const wanted = csv && columns === undefined ? "all" : noun.custom ? wantedCodes(columns) : undefined
    const terms = names.length ? undefined : termsOf(noun.query)
    const { settings } = contextOf(this)
    const window = windowOf(this)
    const found: Listed<T> & { fields?: Field[] } = await withPortal(this, (portal) =>
      noun.custom && (terms === undefined || wanted !== undefined)
        ? noun.custom(portal, { names, wanted, terms: termsOf }, window)
        : noun.list(portal, terms ?? new Map(), window),
    )
    if (csv) {
      const page = { items: found.items, fields: found.fields ?? [], page: settings.page, hasMore: found.has_more }
      return printCsv(this, page, paths)
    }
    const { has_more: hasMore, ...listed } = found
    renderAnswer(this, outputFor(this), pagedList(path, settings, { ...listed, hasMore }))
  })
}

const showCommand = <T>(noun: Noun<T>) =>
  answerEntity(
    annotate(new Command("show"), {
      effects: REMOTE_READ,
      offline: false,
      examples: [`${B24} work ${noun.noun} show 42`, `${B24} work ${noun.noun} show 42 --json`],
    }),
    noun.entity,
    noun.schema,
  )
    .description(`show one of the ${noun.what} on the portal`)
    .argument(`<${noun.reference}>`, `the ${noun.reference}'s ${noun.takes}, as list prints it`)
    .action(async function (this: Command, reference: string) {
      const { env } = contextOf(this)
      const item = await withPortal(this, (portal) => noun.show(portal, reference, quotaFile(env, portal)))
      renderAnswer(this, outputFor(this), itemOf(item))
    })

const nounCommand = <T extends Record<string, unknown>>(noun: Noun<T>, description: string): Command =>
  annotate(new Command(noun.noun), { effects: REMOTE_READ })
    .description(description)
    .addCommand(listCommand(noun))
    .addCommand(showCommand(noun))

const itemNoun = <T extends { id: string } & Record<string, unknown>>(
  type: ItemType<T>,
  shape: {
    noun: string
    entity: string
    schema: v.StrictObjectSchema<v.ObjectEntries, undefined>
    what: string
    fields: Record<string, FieldMap>
  },
  examples: Record<string, string>,
  listExamples: string[],
): Noun<T> => {
  const word = Object.entries(shape.fields).find(([, map]) => map.kind === "word")?.[0]
  const query = nativeQuery(shape.entity, shape.schema, shape.fields, examples)
  return {
    ...shape,
    query,
    ...(word ? { word } : {}),
    examples: listExamples,
    reference: type.word,
    takes: "id or name",
    list: (portal, terms, window) => listItems(portal, type, conditionsOf(terms, shape.fields), window),
    custom: async (portal, { names, wanted, terms: termsOf }, window) => {
      const fields = await loadFields(portal, type.type)
      const chosen = filterableFields(fields, names)
      const terms = termsOf(withCustomFields(query, chosen))
      const custom = customConditions(terms, chosen)
      const found = await listItems(portal, type, [...conditionsOf(terms, shape.fields), ...custom], window, {
        codes: selectedCodes(fields, wanted),
        fields,
      })
      return { ...found, fields }
    },
    show: async (portal, reference, quota) => getItem(portal, type, await resolveItem(portal, type, reference), quota),
  }
}

export const crmCommands = (): Command[] => [
  nounCommand(
    itemNoun(
      PERSON,
      { noun: "people", entity: "crm_person", schema: personSchema, what: "contacts", fields: PERSON_FIELDS },
      { name: "name:ivan*" },
      [
        `${B24} work people list`,
        `${B24} work people list name:ivan*`,
        `${B24} work people list --format csv > people.csv`,
      ],
    ),
    "read the portal's contacts",
  ),
  nounCommand(
    itemNoun(
      ORGANIZATION,
      {
        noun: "organizations",
        entity: "crm_organization",
        schema: organizationSchema,
        what: "companies",
        fields: ORGANIZATION_FIELDS,
      },
      { name: "name:acme*" },
      [
        `${B24} work organizations list`,
        `${B24} work organizations list name:acme*`,
        `${B24} work organizations list --format csv > organizations.csv`,
      ],
    ),
    "read the portal's companies",
  ),
  nounCommand(
    {
      noun: "products",
      entity: "product",
      schema: productSchema,
      what: "catalog products",
      query: nativeQuery("product", productSchema, PRODUCT_FIELDS),
      word: "name",
      examples: [`${B24} work products list`, `${B24} work products list active:true name:chair*`],
      reference: "product",
      takes: "id",
      list: (portal, terms, window) => listProducts(portal, conditionsOf(terms, PRODUCT_FIELDS), window),
      show: getProduct,
    },
    "read the portal's product catalog",
  ),
  nounCommand(
    {
      noun: "users",
      entity: "user",
      schema: userSchema,
      what: "employees",
      query: nativeQuery("user", userSchema, USER_FIELDS),
      examples: [`${B24} work users list`, `${B24} work users list active:true`],
      reference: "user",
      takes: "id",
      list: (portal, terms, window) => listUsers(portal, conditionsOf(terms, USER_FIELDS), window),
      show: getUser,
    },
    "read the portal's employees",
  ),
]
