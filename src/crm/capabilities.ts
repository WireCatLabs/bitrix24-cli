import { CRM_VERBS, type CrmWriteCapabilities } from "@wirecat/cli-core/crm"

/**
 * Not idempotent: on a live portal (2026-11-07) a create repeated with the same `Idempotency-Key` made a second lead,
 * although the REST 3.0 documentation says the repeat is answered from its record. A contact or a company takes only
 * a create and an update.
 */
export const BITRIX_WRITES: CrmWriteCapabilities = {
  kinds: ["deal", "lead", "person", "organization"],
  verbs: CRM_VERBS,
  idempotent: false,
}
