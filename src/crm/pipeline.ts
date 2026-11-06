import { CliError } from "@wirecat/cli-base"
import * as v from "valibot"
import type { BitrixTransport } from "../bitrix/transport.js"
import { id, number, type Raw, text, yes } from "./values.js"

export const pipelineSchema = v.strictObject({
  id: v.string(),
  name: v.nullable(v.string()),
  is_default: v.boolean(),
  sort: v.nullable(v.number()),
})

export type Pipeline = v.InferOutput<typeof pipelineSchema>

/** Deal pipelines are Bitrix24's deal categories; the default one has id 0. Leads have no pipelines. */
export const fromBitrixPipeline = (raw: Raw): Pipeline => ({
  id: text(raw.id) ?? "0",
  name: text(raw.name),
  is_default: yes(raw.isDefault),
  sort: number(raw.sort),
})

export const listPipelines = async (portal: BitrixTransport): Promise<Pipeline[]> => {
  const answer = await portal.call("crm.category.list", { entityTypeId: 2 })
  const categories = (answer.result as { categories?: unknown })?.categories
  return Array.isArray(categories) ? (categories as Raw[]).map(fromBitrixPipeline) : []
}

/** By id, or by a name matched whole; a name two pipelines share is refused with both. */
export const findPipeline = (pipelines: readonly Pipeline[], reference: string): Pipeline => {
  const byId = pipelines.find((one) => one.id === reference)
  if (byId) return byId
  const named = pipelines.filter((one) => one.name?.toLocaleLowerCase() === reference.trim().toLocaleLowerCase())
  if (named.length === 1 && named[0]) return named[0]
  const candidates = (named.length ? named : pipelines).map((one) => ({ id: one.id, name: one.name }))
  if (named.length > 1)
    throw new CliError("validation_error", "two pipelines have that name; name one by its id", {
      reason: "pipeline.ambiguous",
      candidates,
    })
  throw new CliError("not_found", "no pipeline has that id or name; the portal's pipelines are in candidates", {
    reason: "pipeline.not-found",
    candidates,
  })
}

export const pipelineId = (raw: unknown) => id(raw)
