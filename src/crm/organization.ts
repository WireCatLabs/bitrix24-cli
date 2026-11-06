import * as v from "valibot"
import type { FieldMap } from "./conditions.js"
import type { ItemType } from "./items.js"
import {
  contactSchema,
  contacts,
  id,
  ids,
  type Metadata,
  metadataSchema,
  nullableTime,
  number,
  type Raw,
  text,
  time,
} from "./values.js"

/** A Bitrix24 company: an `organizations` record in WireCat's words. */
export const organizationSchema = v.strictObject({
  id: v.string(),
  name: v.nullable(v.string()),
  type_id: v.nullable(v.string()),
  industry_id: v.nullable(v.string()),
  revenue: v.nullable(v.number()),
  currency: v.nullable(v.string()),
  person_ids: v.array(v.string()),
  phones: v.optional(v.array(contactSchema)),
  emails: v.optional(v.array(contactSchema)),
  assigned_to: v.nullable(v.string()),
  created_at: nullableTime,
  updated_at: nullableTime,
  url: v.nullable(v.string()),
  provider_metadata: metadataSchema,
})

export type Organization = v.InferOutput<typeof organizationSchema>

export const ORGANIZATION_FIELDS: Record<string, FieldMap> = {
  name: { field: "title", kind: "word" },
  type_id: { field: "typeId", kind: "text" },
  industry_id: { field: "industryId", kind: "text" },
  assigned_to: { field: "assignedById", kind: "id" },
  created_at: { field: "createdTime", kind: "time" },
  updated_at: { field: "updatedTime", kind: "time" },
}

export const fromBitrixOrganization = (raw: Raw, metadata?: Metadata): Organization => ({
  id: id(raw.id) ?? "",
  name: text(raw.title),
  type_id: text(raw.typeId),
  industry_id: text(raw.industryId),
  revenue: number(raw.revenue),
  currency: text(raw.currencyId),
  person_ids: ids(raw.contactsId),
  ...(Array.isArray(raw.phone) ? { phones: contacts(raw.phone) } : {}),
  ...(Array.isArray(raw.email) ? { emails: contacts(raw.email) } : {}),
  assigned_to: id(raw.assignedById),
  created_at: time(raw.createdTime),
  updated_at: time(raw.updatedTime),
  url: text(raw.url),
  ...(metadata ? { provider_metadata: metadata } : {}),
})

export const ORGANIZATION: ItemType<Organization> = {
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
  nameOf: (organization) => organization.name,
  map: fromBitrixOrganization,
}
