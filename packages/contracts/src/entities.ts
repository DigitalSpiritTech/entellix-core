import { z } from "zod";

const isoDatetimeSchema = z.iso.datetime({ offset: true });

export const ENTITY_TYPES = [
  "client",
  "project",
  "product",
  "task",
  "repo",
  "person",
  "team",
  "procedure",
  "decision",
  "document",
  "metric",
  "concept",
] as const;
export const entityTypeSchema = z.enum(ENTITY_TYPES);
export type EntityType = z.infer<typeof entityTypeSchema>;

export const entitySchema = z.object({
  id: z.uuid(),
  ownerOrgId: z.uuid(),
  linkedOrgId: z.uuid().nullable(),
  type: entityTypeSchema,
  name: z.string().trim().min(1).max(200),
  description: z.string().nullable(),
  archivedAt: isoDatetimeSchema.nullable(),
  createdAt: isoDatetimeSchema,
  updatedAt: isoDatetimeSchema,
});
export type Entity = z.infer<typeof entitySchema>;

export const entityAliasSchema = z.object({
  id: z.uuid(),
  entityId: z.uuid(),
  alias: z.string().trim().min(1).max(200),
  source: z.string().nullable(),
  createdAt: isoDatetimeSchema,
  updatedAt: isoDatetimeSchema,
});
export type EntityAlias = z.infer<typeof entityAliasSchema>;

export const entityEdgeSchema = z.object({
  id: z.uuid(),
  fromEntityId: z.uuid(),
  toEntityId: z.uuid(),
  edgeType: z.string().trim().min(1).max(100),
  validFrom: isoDatetimeSchema,
  validTo: isoDatetimeSchema.nullable(),
  metadata: z.record(z.string(), z.unknown()).nullable(),
  createdAt: isoDatetimeSchema,
  updatedAt: isoDatetimeSchema,
});
export type EntityEdge = z.infer<typeof entityEdgeSchema>;
