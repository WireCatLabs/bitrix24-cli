import { CRM_VERBS, type CrmWriteCapabilities } from "@wirecat/cli-core/crm"

/**
 * Not idempotent: on a live portal (2026-11-07) a create repeated with the same `Idempotency-Key` made a second lead,
 * although the REST 3.0 documentation says the repeat is answered from its record. cli-core's port deletes only deals
 * and leads (`CrmWriter.remove` takes a `DealKind`), so a contact or a company takes a create and an update.
 */
export const BITRIX_WRITES: CrmWriteCapabilities = {
  kinds: ["deal", "lead", "person", "organization"],
  verbs: CRM_VERBS,
  idempotent: false,
}
