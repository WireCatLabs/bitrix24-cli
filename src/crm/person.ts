import * as v from "valibot"
import type { FieldMap } from "./conditions.js"
import type { ItemType } from "./items.js"
import {
  contactSchema,
  contacts,
  customFields,
  fullName,
  id,
  ids,
  metadataSchema,
  nullableTime,
  type Raw,
  text,
  time,
} from "./values.js"

/** A Bitrix24 contact: a `people` record in WireCat's words. */
export const personSchema = v.strictObject({
  id: v.string(),
  name: v.nullable(v.string()),
  first_name: v.nullable(v.string()),
  last_name: v.nullable(v.string()),
  position: v.nullable(v.string()),
  organization_ids: v.array(v.string()),
  phones: v.optional(v.array(contactSchema)),
  emails: v.optional(v.array(contactSchema)),
  assigned_to: v.nullable(v.string()),
  created_at: nullableTime,
  updated_at: nullableTime,
  url: v.nullable(v.string()),
  provider_metadata: metadataSchema,
})

export type Person = v.InferOutput<typeof personSchema>

export const PERSON_FIELDS: Record<string, FieldMap> = {
  name: { field: "name", kind: "word" },
  assigned_to: { field: "assignedById", kind: "id" },
  created_at: { field: "createdTime", kind: "time" },
  updated_at: { field: "updatedTime", kind: "time" },
}

export const fromBitrixPerson = (raw: Raw, custom?: Raw): Person => {
  const companies = ids(raw.companiesId ?? raw.companyIds)
  const first = id(raw.companyId)
  return {
    id: id(raw.id) ?? "",
    name: fullName(raw.name, raw.secondName, raw.lastName),
    first_name: text(raw.name),
    last_name: text(raw.lastName),
    position: text(raw.post),
    organization_ids: companies.length || first === null ? companies : [first],
    ...(Array.isArray(raw.phone) ? { phones: contacts(raw.phone) } : {}),
    ...(Array.isArray(raw.email) ? { emails: contacts(raw.email) } : {}),
    assigned_to: id(raw.assignedById),
    created_at: time(raw.createdTime),
    updated_at: time(raw.updatedTime),
    url: text(raw.url),
    ...(custom && Object.keys(customFields(custom)).length ? { provider_metadata: customFields(custom) } : {}),
  }
}

export const PERSON: ItemType<Person> = {
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
    "companyIds",
    "phone",
    "email",
    "assignedById",
    "createdTime",
    "updatedTime",
    "url",
  ],
  words: ["name", "lastName"],
  nameOf: (person) => person.name,
  map: fromBitrixPerson,
}
