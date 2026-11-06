import { CliError } from "@wirecat/cli-base"
import { annotate } from "@wirecat/cli-base/commands"
import {
  answerEntity,
  commandPath,
  outputFor,
  pagedList,
  REMOTE_READ,
  renderAnswer,
  unfilteredQuery,
  withPaging,
  withQuery,
} from "@wirecat/cli-core/cli"
import { Command } from "commander"
import { DEAL } from "../crm/deal.js"
import { fieldSchema, loadFields } from "../crm/fields.js"
import type { ItemType } from "../crm/items.js"
import { LEAD } from "../crm/lead.js"
import { ORGANIZATION } from "../crm/organization.js"
import { PERSON } from "../crm/person.js"
import { IDENTITY } from "../identity.js"
import { contextOf, withPortal } from "../portal.js"

const B24 = IDENTITY.command

const KINDS: Record<string, ItemType<never>["type"]> = {
  deals: DEAL.type,
  leads: LEAD.type,
  people: PERSON.type,
  organizations: ORGANIZATION.type,
}

const typeOf = (kind: string): ItemType<never>["type"] => {
  const type = KINDS[kind]
  if (!type)
    throw new CliError("validation_error", `fields are listed for ${Object.keys(KINDS).join(", ")}; got ${kind}`, {
      reason: "field.unknown-kind",
      allowed: Object.keys(KINDS),
    })
  return type
}

const listCommand = () =>
  withPaging(
    withQuery(
      answerEntity(
        annotate(new Command("list"), {
          effects: REMOTE_READ,
          offline: false,
          examples: [`${B24} work fields list deals`, `${B24} work fields list people --json`],
        }),
        "crm_field",
        fieldSchema,
      ).argument("<kind>", Object.keys(KINDS).join(", ")),
      unfilteredQuery("crm_field", fieldSchema),
    ),
  )
    .description("list the portal's custom fields of one kind, with a list field's options")
    .action(async function (this: Command, kind: string) {
      const type = typeOf(kind)
      const { settings } = contextOf(this)
      const fields = await withPortal(this, (portal) => loadFields(portal, type))
      const offset = settings.all ? 0 : (settings.page - 1) * settings.limit
      const end = settings.all ? fields.length : offset + settings.limit
      renderAnswer(
        this,
        outputFor(this),
        pagedList(commandPath(this), settings, { items: fields.slice(offset, end), has_more: fields.length > end }),
      )
    })

export const fieldsCommand = (): Command =>
  annotate(new Command("fields"), { effects: REMOTE_READ })
    .description("read the portal's own fields on deals, leads, people and organizations")
    .addCommand(listCommand())
