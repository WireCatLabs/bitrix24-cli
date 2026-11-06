import { CliError } from "@wirecat/cli-base"
import * as v from "valibot"
import type { BitrixTransport } from "../bitrix/transport.js"
import { number, OUTCOMES, outcomeOf, type Raw, text } from "./values.js"

export const STAGE_ENTITIES = ["deals", "leads"] as const

export const stageSchema = v.strictObject({
  id: v.string(),
  name: v.nullable(v.string()),
  entity: v.picklist(STAGE_ENTITIES),
  pipeline_id: v.nullable(v.string()),
  outcome: v.picklist(OUTCOMES),
  sort: v.nullable(v.number()),
  color: v.nullable(v.string()),
})

export type Stage = v.InferOutput<typeof stageSchema>

/** Lead stages are the `STATUS` directory; deal stages `DEAL_STAGE` for pipeline 0 and `DEAL_STAGE_<id>` for the rest. */
const DIRECTORY = /^(STATUS|DEAL_STAGE)(?:_(\d+))?$/

export const directoryOf = (entity: (typeof STAGE_ENTITIES)[number], pipeline?: string): string =>
  entity === "leads" ? "STATUS" : !pipeline || pipeline === "0" ? "DEAL_STAGE" : `DEAL_STAGE_${pipeline}`

/** The outcome comes from the stage's semantics, never its name (apidocs crm.status.fields). */
export const fromBitrixStage = (raw: Raw): Stage | undefined => {
  const directory = DIRECTORY.exec(String(raw.ENTITY_ID ?? ""))
  if (!directory) return undefined
  const extra = (raw.EXTRA ?? {}) as Raw
  const leads = directory[1] === "STATUS"
  return {
    id: text(raw.STATUS_ID) ?? "",
    name: text(raw.NAME),
    entity: leads ? "leads" : "deals",
    pipeline_id: leads ? null : (directory[2] ?? "0"),
    outcome: outcomeOf(raw.SEMANTICS ?? extra.SEMANTICS),
    sort: number(raw.SORT),
    color: text(raw.COLOR ?? extra.COLOR),
  }
}

export const listStages = async (portal: BitrixTransport, directory?: string): Promise<Stage[]> => {
  const answer = await portal.call("crm.status.list", {
    ...(directory ? { filter: { ENTITY_ID: directory } } : {}),
    order: { SORT: "ASC" },
  })
  const rows = Array.isArray(answer.result) ? (answer.result as Raw[]) : []
  return rows.map(fromBitrixStage).filter((stage): stage is Stage => stage !== undefined)
}

export const findStage = (stages: readonly Stage[], reference: string): Stage => {
  const byId = stages.filter((one) => one.id === reference)
  const named = byId.length
    ? byId
    : stages.filter((one) => one.name?.toLocaleLowerCase() === reference.trim().toLocaleLowerCase())
  if (named.length === 1 && named[0]) return named[0]
  const candidates = (named.length ? named : stages).map(({ id, name, entity, pipeline_id }) => ({
    id,
    name,
    entity,
    pipeline_id,
  }))
  if (named.length > 1)
    throw new CliError("validation_error", "more than one stage has that name; name one by its id", {
      reason: "stage.ambiguous",
      candidates,
    })
  throw new CliError("not_found", "no stage has that id or name here; the stages are in candidates", {
    reason: "stage.not-found",
    candidates,
  })
}
