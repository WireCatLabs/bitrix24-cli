import { CliError } from "@wirecat/cli-base"
import type { BitrixTransport } from "../bitrix/transport.js"
import type { ItemType } from "./items.js"
import { fieldOf, type Raw, text } from "./values.js"

type Kind = Pick<ItemType<unknown>, "type" | "word">

/** A contact or company the port does not write yet: one REST 3.0 `add`, sent once with its operation id. */
export const createRecord = async (portal: BitrixTransport, kind: Kind, fields: Raw, operationId: string) => {
  const answer = await portal.call(`crm.${kind.type}.add`, { fields }, { idempotencyKey: operationId })
  const id = text(fieldOf(answer.result, "id")) ?? ""
  if (!id) throw new CliError("invalid_response", `Bitrix24 answered the new ${kind.word} without its id`)
  return id
}

export const updateRecord = async (
  portal: BitrixTransport,
  kind: Kind,
  id: string,
  fields: Raw,
  operationId: string,
) => {
  await portal.call(`crm.${kind.type}.update`, { id: Number(id), fields }, { idempotencyKey: operationId })
}
