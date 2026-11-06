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
  unfilteredQuery,
  withPaging,
  withQuery,
} from "@wirecat/cli-core/cli"
import { Command } from "commander"
import type * as v from "valibot"
import type { BitrixTransport } from "../bitrix/transport.js"
import { type Condition, conditionsOf, type FieldMap } from "../crm/conditions.js"
import { DEAL, DEAL_FIELDS, dealSchema } from "../crm/deal.js"
import { getItem, type ItemType, listItems, resolveItem } from "../crm/items.js"
import { LEAD, LEAD_FIELDS, leadSchema } from "../crm/lead.js"
import { ORGANIZATION, ORGANIZATION_FIELDS, organizationSchema } from "../crm/organization.js"
import { PERSON, PERSON_FIELDS, personSchema } from "../crm/person.js"
import { findPipeline, listPipelines, pipelineSchema } from "../crm/pipeline.js"
import { getProduct, listProducts, PRODUCT_FIELDS, productSchema } from "../crm/product.js"
import { directoryOf, findStage, listStages, type Stage, stageSchema } from "../crm/stage.js"
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
  schema: v.GenericSchema
  /** What `list` shows, in the help. */
  what: string
  query: QueryRegistry
  /** The field a bare word in the query means. */
  word?: string
  examples: string[]
  list: (portal: BitrixTransport, terms: Map<string, Predicate>, window: Window) => Promise<Listed<T>>
  show: (portal: BitrixTransport, reference: string) => Promise<T>
  reference: string
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

const windowOf = (command: Command): Window => {
  const { settings } = contextOf(command)
  return settings.all ? { offset: 0 } : { offset: (settings.page - 1) * settings.limit, limit: settings.limit }
}

const listCommand = <T>(noun: Noun<T>) =>
  withPaging(
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
    .action(async function (this: Command, words: string[]) {
      const path = commandPath(this)
      const terms = nativeTerms(
        listQuery(typedQuery(words), noun.query, path, noun.word ? { defaultField: noun.word } : {}),
        path,
      )
      const { settings } = contextOf(this)
      const window = windowOf(this)
      const found = await withPortal(this, (portal) => noun.list(portal, terms, window))
      renderAnswer(this, outputFor(this), pagedList(path, settings, found))
    })

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
    .argument(`<${noun.reference}>`, `the ${noun.reference} as list prints it`)
    .action(async function (this: Command, reference: string) {
      const item = await withPortal(this, (portal) => noun.show(portal, reference))
      renderAnswer(this, outputFor(this), itemOf(item))
    })

const nounCommand = <T>(noun: Noun<T>, description: string): Command =>
  annotate(new Command(noun.noun), { effects: REMOTE_READ })
    .description(description)
    .addCommand(listCommand(noun))
    .addCommand(showCommand(noun))

const itemNoun = <T extends { id: string }>(
  type: ItemType<T>,
  shape: { noun: string; entity: string; schema: v.GenericSchema; what: string; fields: Record<string, FieldMap> },
  examples: Record<string, string>,
  listExamples: string[],
): Noun<T> => {
  const word = Object.entries(shape.fields).find(([, map]) => map.kind === "word")?.[0]
  return {
    ...shape,
    query: nativeQuery(shape.entity, shape.schema, shape.fields, examples),
    ...(word ? { word } : {}),
    examples: listExamples,
    reference: "id-or-name",
    list: (portal, terms, window) => listItems(portal, type, conditionsOf(terms, shape.fields), window),
    show: async (portal, reference) => getItem(portal, type, await resolveItem(portal, type, reference)),
  }
}

const whole = <T>(items: T[]): Listed<T> => ({ items, has_more: false })

const STAGE_FIELDS: Record<string, FieldMap> = {
  entity: { field: "ENTITY_ID", kind: "text" },
  pipeline_id: { field: "ENTITY_ID", kind: "id" },
}

/** The stage directories a query names: one for leads or one pipeline, or all of them. */
const stagesFor = async (portal: BitrixTransport, conditions: readonly Condition[]): Promise<Stage[]> => {
  const entity = conditions.find((one) => one.field === "ENTITY_ID" && typeof one.value === "string")?.value
  const pipeline = conditions.find((one) => typeof one.value === "number")?.value
  if (entity === "leads") return listStages(portal, directoryOf("leads"))
  if (pipeline !== undefined) return listStages(portal, directoryOf("deals", String(pipeline)))
  const all = await listStages(portal)
  return entity === "deals" ? all.filter((stage) => stage.entity === "deals") : all
}

export const crmCommands = (): Command[] => [
  nounCommand(
    itemNoun(
      DEAL,
      { noun: "deals", entity: "deal", schema: dealSchema, what: "deals", fields: DEAL_FIELDS },
      { title: "title:kitchen*", stage_id: 'stage_id:"C1:WON"' },
      [`${B24} work deals list`, `${B24} work deals list outcome:open pipeline_id:1 amount>=10000`],
    ),
    "read the portal's deals",
  ),
  nounCommand(
    itemNoun(
      LEAD,
      { noun: "leads", entity: "lead", schema: leadSchema, what: "leads", fields: LEAD_FIELDS },
      { title: "title:kitchen*", stage_id: "stage_id:NEW" },
      [`${B24} work leads list`, `${B24} work leads list outcome:open updated_at>=7d`],
    ),
    "read the portal's leads",
  ),
  nounCommand(
    itemNoun(
      PERSON,
      { noun: "people", entity: "crm_person", schema: personSchema, what: "contacts", fields: PERSON_FIELDS },
      { name: "name:ivan*" },
      [`${B24} work people list`, `${B24} work people list name:ivan*`],
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
      [`${B24} work organizations list`, `${B24} work organizations list name:acme*`],
    ),
    "read the portal's companies",
  ),
  nounCommand(
    {
      noun: "pipelines",
      entity: "pipeline",
      schema: pipelineSchema,
      what: "deal pipelines",
      query: unfilteredQuery("pipeline", pipelineSchema),
      examples: [`${B24} work pipelines list`, `${B24} work pipelines list --json`],
      reference: "id-or-name",
      list: async (portal) => whole(await listPipelines(portal)),
      show: async (portal, reference) => findPipeline(await listPipelines(portal), reference),
    },
    "read the portal's deal pipelines",
  ),
  nounCommand(
    {
      noun: "stages",
      entity: "stage",
      schema: stageSchema,
      what: "deal and lead stages, each with its outcome",
      query: nativeQuery("stage", stageSchema, STAGE_FIELDS),
      examples: [`${B24} work stages list`, `${B24} work stages list entity:leads`],
      reference: "id-or-name",
      list: async (portal, terms) => whole(await stagesFor(portal, conditionsOf(terms, STAGE_FIELDS))),
      show: async (portal, reference) => findStage(await listStages(portal), reference),
    },
    "read the stages of the portal's deal pipelines and leads",
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
      reference: "id",
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
      reference: "id",
      list: (portal, terms, window) => listUsers(portal, conditionsOf(terms, USER_FIELDS), window),
      show: getUser,
    },
    "read the portal's employees",
  ),
]
