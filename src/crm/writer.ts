import { CliError, isCliError } from "@wirecat/cli-base"
import type { CrmItem, DealKind } from "@wirecat/cli-core"
import type { CrmFields, CrmWriteOptions, CrmWriter } from "@wirecat/cli-core/crm"
import type { BitrixTransport } from "../bitrix/transport.js"
import { BITRIX_WRITES } from "./capabilities.js"
import { customValues, findField } from "./fields.js"
import { LEAD_PIPELINE } from "./lead.js"
import { REST3_FIELDS } from "./rest3-fields.js"
import type { BitrixCrmSource } from "./source.js"
import { id, type Raw } from "./values.js"

/** Bitrix24 takes `stageId` and `STAGE_ID` alike; a lead's REST 2 stage is `STATUS_ID`. */
const folded = (name: string) => name.replaceAll("_", "").toLowerCase()
const STANDARD: Record<DealKind, ReadonlySet<string>> = {
  deal: new Set(REST3_FIELDS.deal.map(folded)),
  lead: new Set([...REST3_FIELDS.lead, "statusId"].map(folded)),
}

const refused = (message: string, param?: string) =>
  new CliError("validation_error", message, { reason: "deal.field", sent: false, ...(param ? { param } : {}) })

/**
 * Core's write port over REST 3.0. Each write is sent once with its operation id as the `Idempotency-Key` (the
 * transport never retries a write), then the record is read back whole, as core's store wants it.
 */
export const bitrixCrmWriter = (portal: () => BitrixTransport, source: BitrixCrmSource): CrmWriter => {
  /** Every check comes before the first request: a custom code that is a standard field would get round its key. */
  const fieldsOf = async (kind: DealKind, given: CrmFields): Promise<Raw> => {
    const custom = Object.entries(given.custom ?? {})
    for (const [code] of custom)
      if (STANDARD[kind].has(folded(code)))
        throw refused(`${code} is one of Bitrix24's own fields; set it with its own option, not --field`, "--field")
    if (given.people !== undefined) throw refused("b24 does not set the contacts on a record yet")
    if (given.owner === null) throw refused("a Bitrix24 record is always assigned to an employee", "--owner")
    if (kind === "lead" && given.closeDate !== undefined)
      throw refused("Bitrix24 leads have no close date", "--close-date")
    if (kind === "lead" && given.pipeline !== undefined && given.pipeline !== LEAD_PIPELINE.externalId)
      throw refused("Bitrix24 leads have one pipeline", "--pipeline")
    const fields: Raw = {}
    if (given.title !== undefined) fields.title = given.title
    if (kind === "deal" && given.pipeline !== undefined) fields.categoryId = Number(given.pipeline)
    if (given.stage !== undefined) fields.stageId = given.stage
    if (given.amount !== undefined) fields.opportunity = given.amount === null ? 0 : Number(given.amount)
    if (given.currency != null) fields.currencyId = given.currency
    if (given.closeDate !== undefined) fields.closeTime = given.closeDate
    if (given.organization !== undefined)
      fields.companyId = given.organization === null ? 0 : Number(given.organization)
    if (given.owner != null) fields.assignedById = Number(given.owner)
    if (custom.length === 0) return fields
    const defined = await source.fields(kind)
    const set = custom.filter((pair): pair is [string, string] => pair[1] !== null)
    Object.assign(fields, customValues(defined, set))
    for (const [name, value] of custom)
      if (value === null) {
        const field = findField(defined, name)
        fields[field.code] = field.multiple ? [] : null
      }
    return fields
  }

  const keyed = (options: CrmWriteOptions) => ({ idempotencyKey: options.operationId })

  /** The write went through: a failed read-back must never read as a failed write, or the owner repeats it. */
  const readBack = async (kind: DealKind, externalId: string, options: CrmWriteOptions): Promise<CrmItem> => {
    try {
      return await source.item(kind, externalId)
    } catch (error) {
      throw new CliError(
        "invalid_response",
        `Bitrix24 made the change to ${kind} ${externalId}, but reading it back failed` +
          `${isCliError(error) ? ` (${error.code})` : ""}; run sync to store it — do not write it again`,
        { operation_id: options.operationId, external_id: externalId, sent: true },
      )
    }
  }

  const update = async (kind: DealKind, externalId: string, fields: Raw, options: CrmWriteOptions) => {
    await portal().call(`crm.${kind}.update`, { id: Number(externalId), fields }, keyed(options))
    return readBack(kind, externalId, options)
  }

  return {
    provider: "bitrix24",
    capabilities: BITRIX_WRITES,
    async create(kind, draft, options) {
      const fields = await fieldsOf(kind, draft)
      const answer = await portal().call(`crm.${kind}.add`, { fields }, keyed(options))
      const externalId = id((answer.result as { id?: unknown })?.id)
      if (externalId === null)
        throw new CliError(
          "invalid_response",
          `Bitrix24 answered the new ${kind} without its id; run sync before writing again`,
          { operation_id: options.operationId, sent: true },
        )
      return readBack(kind, externalId, options)
    },
    async update(kind, externalId, patch, options) {
      const fields = await fieldsOf(kind, patch)
      if (Object.keys(fields).length === 0) throw refused("nothing to change: name a field")
      return update(kind, externalId, fields, options)
    },
    move: (kind, externalId, stage, options) => update(kind, externalId, { stageId: stage }, options),
    async close(kind, externalId, outcome, options) {
      if (options.reason !== undefined)
        throw refused("Bitrix24 keeps no reason with a won or lost record; leave out --reason", "--reason")
      const current = await source.item(kind, externalId)
      const pipeline = (await source.pipelines(kind)).find((one) => one.externalId === current.pipeline)
      // A pipeline may have several lost stages: the first one in its order is the one a close goes to.
      const [stage] = (pipeline?.stages ?? [])
        .filter((one) => one.outcome === outcome)
        .sort((a, b) => a.position - b.position)
      if (!stage)
        throw new CliError("validation_error", `${pipeline?.name ?? "its pipeline"} has no ${outcome} stage`, {
          reason: "deal.stage",
          sent: false,
        })
      return update(kind, externalId, { stageId: stage.externalId }, options)
    },
    async remove(kind, externalId, options) {
      await portal().call(`crm.${kind}.delete`, { id: Number(externalId) }, keyed(options))
    },
  }
}
