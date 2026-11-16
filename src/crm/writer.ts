import { CliError, isCliError } from "@wirecat/cli-base"
import type { CrmItem, CrmKind, CrmRecords, DealKind } from "@wirecat/cli-core"
import {
  type CrmFields,
  type CrmOrganizationFields,
  type CrmPersonFields,
  type CrmWriteOptions,
  type CrmWriter,
  crmValues,
  fieldNamed,
  optionOf,
} from "@wirecat/cli-core/crm"
import type { BitrixTransport } from "../bitrix/transport.js"
import { foldCode } from "../body.js"
import { BITRIX_WRITES } from "./capabilities.js"
import { LEAD_PIPELINE } from "./lead.js"
import { REST3_FIELDS } from "./rest3-fields.js"
import type { BitrixCrmSource } from "./source.js"
import { numericId, type Raw } from "./values.js"

const { fieldOf, id } = crmValues

/** A lead's REST 2 stage is `STATUS_ID`. */
const STANDARD: Record<CrmKind, ReadonlySet<string>> = {
  deal: new Set(REST3_FIELDS.deal.map(foldCode)),
  lead: new Set([...REST3_FIELDS.lead, "statusId"].map(foldCode)),
  person: new Set(REST3_FIELDS.contact.map(foldCode)),
  organization: new Set(REST3_FIELDS.company.map(foldCode)),
}

/** The REST 3.0 type each kind is written as. */
const TYPES: Record<CrmKind, string> = { deal: "deal", lead: "lead", person: "contact", organization: "company" }

const refused = (message: string, param?: string) =>
  new CliError("validation_error", message, { reason: "deal.field", sent: false, ...(param ? { param } : {}) })

type AnyFields = CrmFields | CrmPersonFields | CrmOrganizationFields

/**
 * Core's write port over REST 3.0. Each write is sent once with its operation id as the `Idempotency-Key` (the
 * transport never retries a write), then the record is read back whole, as core's store wants it.
 */
export const bitrixCrmWriter = (portal: () => BitrixTransport, source: BitrixCrmSource): CrmWriter => {
  /** A deal's or lead's own fields in REST 3.0's names. */
  const itemFields = (kind: DealKind, given: CrmFields): Raw => {
    if (given.people !== undefined) throw refused("b24 does not set the contacts on a record yet")
    if (kind === "lead" && given.closeDate !== undefined)
      throw refused("Bitrix24 leads have no close date", "--close-date")
    if (kind === "lead" && given.pipeline !== undefined && given.pipeline !== LEAD_PIPELINE.externalId)
      throw refused("Bitrix24 leads have one pipeline", "--pipeline")
    const fields: Raw = {}
    if (given.title !== undefined) fields.title = given.title
    if (kind === "deal" && given.pipeline !== undefined) fields.categoryId = numericId(given.pipeline, "--pipeline")
    if (given.stage !== undefined) fields.stageId = given.stage
    if (given.amount !== undefined) fields.opportunity = given.amount === null ? 0 : Number(given.amount)
    if (given.currency != null) fields.currencyId = given.currency
    if (given.closeDate !== undefined) fields.closeTime = given.closeDate
    if (given.organization !== undefined)
      fields.companyId = given.organization === null ? 0 : numericId(given.organization, "--organization")
    return fields
  }

  /**
   * Bitrix24 keeps a contact's name in parts: a whole name is its first word and the rest, and one word clears the last
   * name; a middle name (`secondName`) stays, since clearing it would refuse every `--name` of an employee's webhook.
   * Phones and e-mails are multifields an update would add to rather than replace (apidocs data-types#crm_multifield),
   * so only a create sets them; the shared commands offer no option for them yet, but core's port carries them.
   */
  const personFields = (given: CrmPersonFields, create: boolean): Raw => {
    const fields: Raw = {}
    if (given.name !== undefined) {
      const [first, ...rest] = given.name.trim().split(/\s+/)
      fields.name = first ?? ""
      fields.lastName = rest.join(" ")
    }
    if (given.firstName !== undefined) fields.name = given.firstName ?? ""
    if (given.lastName !== undefined) fields.lastName = given.lastName ?? ""
    if (given.position !== undefined) fields.post = given.position ?? ""
    if (!create && (given.emails !== undefined || given.phones !== undefined))
      throw refused("b24 does not change a contact's phones or e-mails yet; Bitrix24 would add them to the old ones")
    const multi = (values: readonly string[]) => values.map((value) => ({ valueTypeId: "WORK", value }))
    if (given.emails?.length) fields.email = multi(given.emails)
    if (given.phones?.length) fields.phone = multi(given.phones)
    return fields
  }

  /** Every check comes before the first request: a custom code that is a standard field would get round its key. */
  const fieldsOf = async (kind: CrmKind, given: AnyFields, create = false): Promise<Raw> => {
    const custom = Object.entries(given.custom ?? {})
    for (const [code] of custom)
      if (STANDARD[kind].has(foldCode(code)))
        throw refused(`${code} is one of Bitrix24's own fields; set it with its own option, not --field`, "--field")
    if (given.owner === null) throw refused("a Bitrix24 record is always assigned to an employee", "--owner")
    const fields: Raw =
      kind === "person"
        ? personFields(given as CrmPersonFields, create)
        : kind === "organization"
          ? (given as CrmOrganizationFields).name === undefined
            ? {}
            : { title: (given as CrmOrganizationFields).name }
          : itemFields(kind, given as CrmFields)
    if (given.owner != null) fields.assignedById = numericId(given.owner, "--owner")
    if (custom.length === 0) return fields
    // Core resolves by the stored definitions, but a store not synced since they were added passes names as typed:
    // they are checked here against the portal's, or `Number("Website")` would clear a list field.
    const defined = await source.fields(kind)
    for (const [name, value] of custom) {
      const field = fieldNamed(defined, name)
      const typed = (one: string) => (field.options ? Number(optionOf(field, one)) : one)
      const given = value === null ? null : Array.isArray(value) ? value.map(typed) : typed(value)
      // A code and its label, each typed as given, reach here as two names of one field.
      if (!(field.code in fields)) fields[field.code] = field.multiple && given === null ? [] : given
      else if (field.multiple) fields[field.code] = [fields[field.code], given].flat().filter((one) => one !== null)
      else throw refused(`${field.label ?? field.code} holds one value; give --field once`, "--field")
    }
    return fields
  }

  const keyed = (options: CrmWriteOptions) => ({ idempotencyKey: options.operationId })

  /** The write went through: a failed read-back must never read as a failed write, or the owner repeats it. */
  const readBack = async <K extends CrmKind>(
    kind: K,
    externalId: string,
    options: CrmWriteOptions,
  ): Promise<CrmRecords[K]> => {
    let failure: unknown
    try {
      const found =
        kind === "person" || kind === "organization"
          ? await source.get?.(kind, externalId)
          : await source.item(kind as DealKind, externalId)
      if (found) return found as CrmRecords[K]
    } catch (error) {
      failure = error
    }
    throw new CliError(
      "invalid_response",
      `Bitrix24 made the change to ${kind} ${externalId}, but reading it back failed` +
        `${isCliError(failure) ? ` (${failure.code})` : ""}; run sync to store it — do not write it again`,
      { operation_id: options.operationId, external_id: externalId, sent: true },
    )
  }

  const update = async <K extends CrmKind>(kind: K, externalId: string, fields: Raw, options: CrmWriteOptions) => {
    await portal().call(
      `crm.${TYPES[kind]}.update`,
      { id: numericId(externalId, `the ${kind} id`), fields },
      keyed(options),
    )
    return readBack(kind, externalId, options)
  }

  return {
    provider: "bitrix24",
    capabilities: BITRIX_WRITES,
    async create(kind, draft, options) {
      const fields = await fieldsOf(kind, draft, true)
      const answer = await portal().call(`crm.${TYPES[kind]}.add`, { fields }, keyed(options))
      const externalId = id(fieldOf(answer.result, "id"))
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
    move: (kind, externalId, stage, options): Promise<CrmItem> => update(kind, externalId, { stageId: stage }, options),
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
      await portal().call(`crm.${kind}.delete`, { id: numericId(externalId, `the ${kind} id`) }, keyed(options))
    },
  }
}
