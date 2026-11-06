import { CRM_VERBS, type CrmWriteCapabilities } from "@wirecat/cli-core/crm"

/** Every verb on deals and leads; REST 3.0 answers a repeated `Idempotency-Key` from its record (apidocs "REST 3.0"). */
export const BITRIX_WRITES: CrmWriteCapabilities = { kinds: ["deal", "lead"], verbs: CRM_VERBS, idempotent: true }
