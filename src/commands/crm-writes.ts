import { CliError } from "@wirecat/cli-base"
import { annotate } from "@wirecat/cli-base/commands"
import { REMOTE_WRITE, readApiBody } from "@wirecat/cli-core/cli"
import { fieldPairsOf } from "@wirecat/cli-core/crm"
import { Command } from "commander"
import { apiKeysOf, assigneeOf } from "../api-keys.js"
import type { BitrixTransport } from "../bitrix/transport.js"
import { parseBody, unambiguous } from "../body.js"
import { customValues, loadFields } from "../crm/fields.js"
import type { ItemType } from "../crm/items.js"
import { ORGANIZATION } from "../crm/organization.js"
import { PERSON } from "../crm/person.js"
import type { Raw } from "../crm/values.js"
import { IDENTITY } from "../identity.js"
import { write } from "./write.js"

const B24 = IDENTITY.command

interface Options {
  title?: string
  name?: string
  firstName?: string
  lastName?: string
  body?: string
  field?: string[]
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
  'the other fields to set, as JSON with Bitrix24\'s own field names, such as {"post":"Buyer","assignedById":7}; ' +
  "naming another employee as the one responsible checks crm.assign-others"

const FIELD =
  "a custom field, by its label or code as `fields list` prints them, and its value; a list field takes its " +
  "option's label or id; repeat it for more fields, or for each value of a multiple field. Over --body for the " +
  "same field; --dry-run does not look the names up"

/** These writes are offered over MCP, where stdin carries the protocol: `--body -` would read the agent's messages. */
const noStdin = (): string => {
  throw new CliError("validation_error", "--body takes the JSON itself here, not -", { param: "--body" })
}

/**
 * The fields to send: `--body`, then the custom fields `--field` names, then the named options over both. The whole
 * object is checked, since `--title` beside a `TITLE` in `--body` names one field twice too.
 */
const fieldsOf = (options: Options, custom: Raw = {}): Raw => {
  const fields: Raw = { ...parseBody(readApiBody(options, noStdin), "the fields to set"), ...custom }
  const set = (key: string, value: string | undefined) => {
    if (value !== undefined) fields[key] = value
  }
  set("title", options.title ?? options.name)
  set("name", options.firstName)
  set("lastName", options.lastName)
  unambiguous(fields)
  return fields
}

interface Kind {
  noun: string
  type: Pick<ItemType<unknown>, "type" | "word">
  create: Option[]
  /** Options a create cannot go without, one of which is enough. */
  needs: Option[]
  examples: { create: string; update: string }
}

const KINDS: Kind[] = [
  {
    noun: "people",
    type: PERSON,
    create: ["firstName", "lastName"],
    needs: ["firstName", "lastName"],
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
    examples: {
      create: `${B24} work organizations create --name "Acme"`,
      update: `${B24} work organizations update 9 --name "Acme Ltd"`,
    },
  },
]

/**
 * Reads the portal's custom fields once, and hands back every field to send with `--field`'s values in. The assignee
 * was checked before this lookup, so a field list that changed it would send what was never checked.
 */
const withFieldPairs =
  (kind: Kind, options: Options, pairs: [string, string][], take: (fields: Raw) => void) =>
  async (portal: BitrixTransport) => {
    const all = fieldsOf(options, customValues(await loadFields(portal, kind.type.type), pairs))
    if (assigneeOf(all) !== assigneeOf(fieldsOf(options)))
      throw new CliError("validation_error", "--field cannot set the employee a record is assigned to", {
        param: "--field",
        sent: false,
      })
    take(all)
  }

const flagOf = (option: Option) => `--${option.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`

const withOptions = (command: Command, options: Option[]) => {
  for (const option of options) OPTIONS[option](command)
  return command
    .option("--body <json>", BODY)
    .option("--field <key=value>", FIELD, (one: string, all: string[] = []) => [...all, one])
    .option("--operation-id <id>", "the operation_id an outcome_unknown named: a retry Bitrix24 will not run twice")
}

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
        extra: [...apiKeysOf([kind.noun, "create"])],
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
        extra: [...apiKeysOf([kind.noun, "update"])],
        assignee: assigneeOf(fields),
        operationId: options.operationId,
        ...(pairs.length ? { prepare: withFieldPairs(kind, options, pairs, (all) => (fields = all)) } : {}),
        act: async (portal, operationId) => {
          await portal.call(`crm.${kind.type.type}.update`, { id: Number(id), fields }, { idempotencyKey: operationId })
          return { id, updated: Object.keys(fields) }
        },
      })
    })

export const addWrites = (noun: Command): Command => {
  const kind = KINDS.find((one) => one.noun === noun.name())
  if (!kind) return noun
  noun.addCommand(createCommand(kind)).addCommand(updateCommand(kind))
  return noun
}
