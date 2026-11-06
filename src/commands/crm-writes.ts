import { CliError } from "@wirecat/cli-base"
import { annotate } from "@wirecat/cli-base/commands"
import { REMOTE_WRITE } from "@wirecat/cli-core/cli"
import { Command } from "commander"
import { apiKeysOf, assigneeOf, stageKeysOf } from "../api-keys.js"
import type { BitrixTransport } from "../bitrix/transport.js"
import { DEAL } from "../crm/deal.js"
import { customValues, fieldPairsOf, loadFields } from "../crm/fields.js"
import type { ItemType } from "../crm/items.js"
import { LEAD } from "../crm/lead.js"
import { ORGANIZATION } from "../crm/organization.js"
import { PERSON } from "../crm/person.js"
import { directoryOf, findStage, listStages } from "../crm/stage.js"
import type { Raw } from "../crm/values.js"
import { IDENTITY } from "../identity.js"
import { write } from "./write.js"

const B24 = IDENTITY.command

/** Every option a write command may take; each command adds only its own. */
interface Options {
  title?: string
  name?: string
  firstName?: string
  lastName?: string
  body?: string
  field?: string[]
  stage?: string
  operationId?: string
}

type Option = "title" | "name" | "firstName" | "lastName"

const OPTIONS: Record<Option, (command: Command) => Command> = {
  title: (c) => c.option("--title <title>", "the title"),
  name: (c) => c.option("--name <name>", "the name"),
  firstName: (c) => c.option("--first-name <name>", "the person's first name"),
  lastName: (c) => c.option("--last-name <name>", "the person's last name"),
}

const BODY =
  "the other fields to set, as a JSON object in Bitrix24's REST 3.0 names: " +
  '{"opportunity":15000,"currencyId":"EUR","assignedById":7,"stageId":"C1:NEW","phone":[{"valueTypeId":"WORK","value":"+1…"}]}; ' +
  "`api show crm.<type>.add` names them; assignedById other than the webhook's own user checks crm.assign-others"

const bodyOf = (raw: string | undefined): Raw => {
  if (raw === undefined) return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new CliError("validation_error", "--body is not JSON", { param: "--body" })
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
    throw new CliError("validation_error", "--body takes a JSON object of fields", { param: "--body" })
  return parsed as Raw
}

const FIELD =
  "a custom field, by its label or code as `fields list` prints them, and its value; a list field takes its " +
  "option's label or id; repeat it for more fields, or for each value of a multiple field. Over --body for the " +
  "same field; --dry-run does not look the names up"

/** The fields to send: `--body`, then the custom fields `--field` names, then the named options over both. */
const fieldsOf = (options: Options, custom: Raw = {}): Raw => {
  const fields = { ...bodyOf(options.body), ...custom }
  const set = (key: string, value: string | undefined) => {
    if (value !== undefined) fields[key] = value
  }
  set("title", options.title ?? options.name)
  set("name", options.firstName)
  set("lastName", options.lastName)
  return fields
}

/** Who the write assigns the record to, when it does: the guard compares it with the webhook's own user. */
/** The pipeline a deal is in, so `--stage` is read among that pipeline's stages. */
const dealPipeline = async (portal: BitrixTransport, id: string) => {
  const answer = await portal.call("crm.deal.get", { id: Number(id), select: ["id", "categoryId"] })
  const item = (answer.result as { item?: Raw })?.item
  if (!item) throw new CliError("not_found", `there is no deal ${id}`)
  return String(item.categoryId ?? "0")
}

interface Kind {
  noun: string
  type: Pick<ItemType<unknown>, "type" | "word">
  create: Option[]
  /** Options a create cannot go without, one of which is enough. */
  needs: Option[]
  moves: boolean
  examples: { create: string; update: string; move?: string }
}

const KINDS: Kind[] = [
  {
    noun: "deals",
    type: DEAL,
    create: ["title"],
    needs: ["title"],
    moves: true,
    examples: {
      create: `${B24} work deals create --title "Kitchen for Acme" --body '{"opportunity":15000,"currencyId":"EUR"}'`,
      update: `${B24} work deals update 42 --body '{"opportunity":18000}'`,
      move: `${B24} work deals move 42 --stage "Contract signed"`,
    },
  },
  {
    noun: "leads",
    type: LEAD,
    create: ["title", "firstName", "lastName"],
    needs: ["title", "firstName", "lastName"],
    moves: true,
    examples: {
      create: `${B24} work leads create --title "Website form" --first-name Ivan`,
      update: `${B24} work leads update 7 --field Source=Website --field Tags=Hot --field Tags=Repeat`,
      move: `${B24} work leads move 7 --stage IN_PROCESS`,
    },
  },
  {
    noun: "people",
    type: PERSON,
    create: ["firstName", "lastName"],
    needs: ["firstName", "lastName"],
    moves: false,
    examples: {
      create: `${B24} work people create --first-name Anna --last-name Ivanova`,
      update: `${B24} work people update 4 --body '{"post":"Buyer"}'`,
    },
  },
  {
    noun: "organizations",
    type: ORGANIZATION,
    create: ["name"],
    needs: ["name"],
    moves: false,
    examples: {
      create: `${B24} work organizations create --name "Acme"`,
      update: `${B24} work organizations update 9 --name "Acme Ltd"`,
    },
  },
]

/** Reads the portal's custom fields once, and hands back every field to send with `--field`'s values in. */
const withFieldPairs =
  (kind: Kind, options: Options, pairs: [string, string][], take: (fields: Raw) => void) =>
  async (portal: BitrixTransport) => {
    take(fieldsOf(options, customValues(await loadFields(portal, kind.type.type), pairs)))
  }

const flagOf = (option: Option) => `--${option.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`

const withOptions = (command: Command, options: Option[]) => {
  for (const option of options) OPTIONS[option](command)
  return command
    .option("--body <json>", BODY)
    .option("--field <key=value>", FIELD, (one: string, all: string[] = []) => [...all, one])
    .option("--operation-id <id>", "the operation_id an outcome_unknown named: a retry Bitrix24 will not run twice")
}

/** A deal's stages are its pipeline's; a lead's are the lead directory. */
const stageDirectory = async (kind: Kind, portal: BitrixTransport, id: string) =>
  kind.noun === "leads" ? directoryOf("leads") : directoryOf("deals", await dealPipeline(portal, id))

const createCommand = (kind: Kind) =>
  withOptions(
    annotate(new Command("create"), { effects: REMOTE_WRITE, offline: false, examples: [kind.examples.create] }),
    kind.create,
  )
    .description(`create one ${kind.type.word} on the portal`)
    .action(async function (this: Command, options: Options) {
      if (!kind.needs.some((one) => options[one] !== undefined))
        throw new CliError("validation_error", `a new ${kind.type.word} needs ${kind.needs.map(flagOf).join(" or ")}`)
      const pairs = fieldPairsOf(options.field ?? [])
      let fields = fieldsOf(options)
      await write(this, {
        key: `${kind.noun}.create`,
        extra: [...apiKeysOf([kind.noun, "create"]), ...stageKeysOf(kind.noun, fields)],
        assignee: assigneeOf(fields),
        operationId: options.operationId,
        ...(pairs.length ? { prepare: withFieldPairs(kind, options, pairs, (all) => (fields = all)) } : {}),
        act: async (portal, operationId) => {
          const answer = await portal.call(`crm.${kind.type.type}.add`, { fields }, { idempotencyKey: operationId })
          const id = String((answer.result as { id?: unknown })?.id ?? "")
          if (!id) throw new CliError("invalid_response", `Bitrix24 answered the new ${kind.type.word} without its id`)
          return { id, created: true }
        },
      })
    })

const updateCommand = (kind: Kind) =>
  withOptions(
    annotate(new Command("update"), { effects: REMOTE_WRITE, offline: false, examples: [kind.examples.update] }),
    kind.create,
  )
    .description(`change one ${kind.type.word} on the portal; options left out keep their values`)
    .argument("<id>", `the ${kind.type.word}'s id`)
    .action(async function (this: Command, id: string, options: Options) {
      if (!/^[1-9]\d*$/.test(id))
        throw new CliError("validation_error", `${kind.noun} update takes the ${kind.type.word}'s id`)
      const pairs = fieldPairsOf(options.field ?? [])
      let fields = fieldsOf(options)
      if (Object.keys(fields).length === 0 && pairs.length === 0)
        throw new CliError("validation_error", "nothing to change: name a field")
      await write(this, {
        key: `${kind.noun}.update`,
        extra: [...apiKeysOf([kind.noun, "update"]), ...stageKeysOf(kind.noun, fields)],
        assignee: assigneeOf(fields),
        operationId: options.operationId,
        ...(pairs.length ? { prepare: withFieldPairs(kind, options, pairs, (all) => (fields = all)) } : {}),
        act: async (portal, operationId) => {
          await portal.call(`crm.${kind.type.type}.update`, { id: Number(id), fields }, { idempotencyKey: operationId })
          return { id, updated: Object.keys(fields) }
        },
      })
    })

const moveCommand = (kind: Kind) =>
  annotate(new Command("move"), { effects: REMOTE_WRITE, offline: false, examples: [kind.examples.move ?? ""] })
    .description(`move one ${kind.type.word} to another stage`)
    .argument("<id>", `the ${kind.type.word}'s id`)
    .requiredOption("--stage <stage>", "the stage, by id or name, as `stages list` prints it")
    .option("--operation-id <id>", "the operation_id an outcome_unknown named: a retry Bitrix24 will not run twice")
    .action(async function (this: Command, id: string, options: Options) {
      if (!/^[1-9]\d*$/.test(id))
        throw new CliError("validation_error", `${kind.noun} move takes the ${kind.type.word}'s id`)
      await write(this, {
        key: `${kind.noun}.move`,
        extra: apiKeysOf([kind.noun, "move"]),
        operationId: options.operationId,
        act: async (portal, operationId) => {
          const stage = findStage(await listStages(portal, await stageDirectory(kind, portal, id)), options.stage ?? "")
          await portal.call(
            `crm.${kind.type.type}.update`,
            { id: Number(id), fields: { stageId: stage.id } },
            { idempotencyKey: operationId },
          )
          return { id, stage_id: stage.id, outcome: stage.outcome }
        },
      })
    })

/** The writes of each CRM noun, added to the noun's read commands. */
export const addWrites = (noun: Command): Command => {
  const kind = KINDS.find((one) => one.noun === noun.name())
  if (!kind) return noun
  noun.addCommand(createCommand(kind)).addCommand(updateCommand(kind))
  if (kind.moves) noun.addCommand(moveCommand(kind))
  return noun
}
