import type { CrmOrganization, CrmValue } from "@wirecat/cli-core"
import { crmValues } from "@wirecat/cli-core/crm"
import type { ItemType } from "./items.js"
import { contacts, contactTypesOf, type Raw } from "./values.js"

const { epoch, id, ids, number, text } = crmValues

/**
 * Bitrix24's own company fields the shared entity has no place for, kept in `provider_metadata` under their REST 3.0
 * names (apidocs fields-company), as the portal's custom fields are.
 */
// WireCat's own labels, in English like the rest of the answer: the portal names these standard fields itself.
const OWN: [code: string, label: string, read: (value: unknown) => unknown][] = [
  ["industryId", "Industry", text],
  ["revenue", "Revenue", number],
  ["currencyId", "Currency", text],
]

const ownValues = (raw: Raw): Record<string, CrmValue> =>
  Object.fromEntries(
    OWN.flatMap(([code, label, read]) => {
      const value = read(raw[code])
      return value === null || value === undefined ? [] : [[code, { label, value }]]
    }),
  )

/** `own` stays false: REST 3.0's `crm.company.*` never returns the account's own companies (apidocs fields-my-company). */
export const toOrganization = (raw: Raw, metadata?: Record<string, CrmValue>): CrmOrganization => {
  const phones = contacts(raw.phone)
  const emails = contacts(raw.email)
  const values = { ...ownValues(raw), ...metadata }
  return {
    externalId: id(raw.id) ?? "",
    name: text(raw.title) ?? "",
    url: text(raw.url),
    type: text(raw.typeId),
    ...(Object.keys(values).length ? { metadata: values } : {}),
    ...(Array.isArray(raw.phone) ? { phones: phones.map(({ value }) => value) } : {}),
    ...(Array.isArray(raw.email) ? { emails: emails.map(({ value }) => value) } : {}),
    ...contactTypesOf([...phones, ...emails]),
    ...("contactsId" in raw ? { people: ids(raw.contactsId) } : {}),
    ...("assignedById" in raw ? { assignee: id(raw.assignedById) } : {}),
    createdAt: epoch(raw.createdTime),
    updatedAt: epoch(raw.updatedTime),
  }
}

export const ORGANIZATION: ItemType = {
  type: "company",
  entityTypeId: 4,
  word: "organization",
  select: [
    "id",
    "title",
    "typeId",
    "industryId",
    "revenue",
    "currencyId",
    "contactsId",
    "phone",
    "email",
    "assignedById",
    "createdTime",
    "updatedTime",
    "url",
  ],
  words: ["title"],
}
