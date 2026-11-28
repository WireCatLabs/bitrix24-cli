import { type CrmPerson, type CrmValue, crmValues } from "@wirecat/cli-core"
import type { ItemType } from "./items.js"
import { contacts, contactTypesOf, fullName, type Raw } from "./values.js"

const { epoch, id, ids, text } = crmValues

/**
 * A Bitrix24 contact; `companiesId` lists its companies, the primary one first (apidocs fields-contact). A field the
 * read did not select is left out, so the copy keeps what it held.
 */
export const toPerson = (raw: Raw, metadata?: Record<string, CrmValue>): CrmPerson => {
  const phones = contacts(raw.phone)
  const emails = contacts(raw.email)
  const companies = ids(raw.companiesId)
  const first = id(raw.companyId)
  const organizations = companies.length || first === null ? companies : [first]
  return {
    externalId: id(raw.id) ?? "",
    name: fullName(raw.name, raw.secondName, raw.lastName),
    firstName: text(raw.name),
    lastName: text(raw.lastName),
    email: emails[0]?.value ?? null,
    phone: phones[0]?.value ?? null,
    ...(Array.isArray(raw.phone) ? { phones: phones.map(({ value }) => value) } : {}),
    ...(Array.isArray(raw.email) ? { emails: emails.map(({ value }) => value) } : {}),
    ...contactTypesOf([...phones, ...emails]),
    position: text(raw.post),
    ...("companiesId" in raw || "companyId" in raw
      ? { organizations: organizations.map((externalId, at) => ({ externalId, primary: at === 0 })) }
      : {}),
    ...("assignedById" in raw ? { assignee: id(raw.assignedById) } : {}),
    createdAt: epoch(raw.createdTime),
    updatedAt: epoch(raw.updatedTime),
    url: text(raw.url),
    ...(metadata ? { metadata } : {}),
  }
}

export const PERSON: ItemType = {
  type: "contact",
  entityTypeId: 3,
  word: "person",
  select: [
    "id",
    "name",
    "secondName",
    "lastName",
    "post",
    "companyId",
    "companiesId",
    "phone",
    "email",
    "assignedById",
    "createdTime",
    "updatedTime",
    "url",
  ],
  words: ["name", "lastName"],
}
