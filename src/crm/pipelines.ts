import type { CrmPipeline, CrmStage } from "@wirecat/cli-core"
import type { BitrixTransport } from "../bitrix/transport.js"
import { LEAD_PIPELINE } from "./lead.js"
import { number, outcomeOf, type Raw, text } from "./values.js"

/** Lead stages are the `STATUS` directory; deal stages `DEAL_STAGE` for pipeline 0 and `DEAL_STAGE_<id>` for the rest. */
const directoryOf = (pipeline: string) => (pipeline === "0" ? "DEAL_STAGE" : `DEAL_STAGE_${pipeline}`)

/** One directory's stages, every page: REST 2 answers 50 rows at a time with `next`. */
const stagesOf = async (portal: BitrixTransport, directory: string): Promise<CrmStage[]> => {
  const rows: Raw[] = []
  for (let start = 0; ; ) {
    const answer = await portal.call("crm.status.list", {
      filter: { ENTITY_ID: directory },
      order: { SORT: "ASC" },
      start,
    })
    if (Array.isArray(answer.result)) for (const row of answer.result as Raw[]) rows.push(row)
    if (answer.next === undefined || answer.next <= start) break
    start = answer.next
  }
  return rows.flatMap((raw) => {
    const externalId = text(raw.STATUS_ID)
    if (externalId === null) return []
    const extra = (raw.EXTRA ?? {}) as Raw
    // The outcome comes from the stage's semantics, never its name (apidocs crm.status.fields).
    return [
      {
        externalId,
        name: text(raw.NAME) ?? externalId,
        position: number(raw.SORT) ?? 0,
        outcome: outcomeOf(raw.SEMANTICS ?? extra.SEMANTICS),
      },
    ]
  })
}

/** Deal pipelines are Bitrix24's deal categories, the default one id 0; leads get the one pipeline b24 makes them. */
export const bitrixPipelines = async (portal: BitrixTransport, kind: "deal" | "lead"): Promise<CrmPipeline[]> => {
  if (kind === "lead") return [{ ...LEAD_PIPELINE, stages: await stagesOf(portal, "STATUS") }]
  const answer = await portal.call("crm.category.list", { entityTypeId: 2 })
  const categories = (answer.result as { categories?: unknown })?.categories
  const pipelines: CrmPipeline[] = []
  for (const raw of Array.isArray(categories) ? (categories as Raw[]) : []) {
    const externalId = text(raw.id) ?? "0"
    pipelines.push({
      externalId,
      name: text(raw.name) ?? `Pipeline ${externalId}`,
      stages: await stagesOf(portal, directoryOf(externalId)),
    })
  }
  return pipelines
}
