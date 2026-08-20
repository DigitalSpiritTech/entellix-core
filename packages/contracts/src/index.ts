/**
 * Defines the public exports for this TypeScript module.
 *
 * Inputs: Imported dependencies and values passed to the module's documented functions.
 * Outputs: Exported types, values, and behavior provided by the module.
 * Errors: Functions document validation, dependency, and runtime errors individually.
 *
 * @packageDocumentation
 */

import { z } from "zod";

export * from "./entities.ts";
export * from "./events.ts";
export * from "./memory-v2.ts";

import { contextEnvelopeSchema, memoryPacketSchema } from "./packet.ts";

export const MEMORY_SCOPES = ["profile", "organization"] as const;
export const memoryScopeSchema = z.enum(MEMORY_SCOPES);
export type MemoryScope = z.infer<typeof memoryScopeSchema>;

export const MEMORY_PROVENANCES = [
  "tutorial",
  "explicit_request",
  "session_end",
  "pre_compaction",
] as const;
export const memoryProvenanceSchema = z.enum(MEMORY_PROVENANCES);
export type MemoryProvenance = z.infer<typeof memoryProvenanceSchema>;

export const MEMORY_STATUSES = [
  "active",
  "removed",
  "superseded",
  "expired",
  "pending_review",
  "rejected",
] as const;
export const memoryStatusSchema = z.enum(MEMORY_STATUSES);
export type MemoryStatus = z.infer<typeof memoryStatusSchema>;

export const memoryTextSchema = z.string().trim().min(1).max(4000);
export const sessionNoteSchema = z.string().trim().min(1).max(4000);

const isoDatetimeSchema = z.iso.datetime({ offset: true });

export const memorySchema = z.object({
  id: z.uuid(),
  organizationId: z.uuid(),
  text: memoryTextSchema,
  scope: memoryScopeSchema,
  provenance: memoryProvenanceSchema,
  status: memoryStatusSchema,
  sessionNote: sessionNoteSchema.nullable(),
  createdAt: isoDatetimeSchema,
  updatedAt: isoDatetimeSchema,
});
export type Memory = z.infer<typeof memorySchema>;

export const saveMemoryInputSchema = z.object({
  text: memoryTextSchema,
  scope: memoryScopeSchema.default("profile"),
  provenance: memoryProvenanceSchema.default("explicit_request"),
  sessionNote: sessionNoteSchema.optional(),
});
export type SaveMemoryInput = z.input<typeof saveMemoryInputSchema>;

export const saveMemoryOutputSchema = z.object({
  memory: memorySchema,
});
export type SaveMemoryOutput = z.infer<typeof saveMemoryOutputSchema>;

const retrievalLimitSchema = z.number().int().min(1).max(50).default(20);

export const getContextInputSchema = z.object({
  taskContext: z.string().trim().min(1).max(4000),
  limit: retrievalLimitSchema,
  // Caller-ASSERTED envelope fields. Never trusted as-is: the service resolves
  // the acting principal's real membership and overrides these (S3.1.3).
  assertedOrgId: z.uuid().optional(),
  assertedEntityIds: z.array(z.uuid()).optional(),
});
export type GetContextInput = z.input<typeof getContextInputSchema>;

// v2 (S3.1.3): get_context returns a composed memory PACKET plus the
// server-verified context envelope, not a bare memory list.
export const getContextOutputSchema = z.object({
  packet: memoryPacketSchema,
  envelope: contextEnvelopeSchema,
});
export type GetContextOutput = z.infer<typeof getContextOutputSchema>;

export const RETRIEVE_MODES = ["search", "context", "profile", "organization"] as const;
export const retrieveModeSchema = z.enum(RETRIEVE_MODES);
export type RetrieveMode = z.infer<typeof retrieveModeSchema>;

export const retrieveMemoryInputSchema = z
  .object({
    mode: retrieveModeSchema.default("search"),
    query: z.string().trim().min(1).max(500).optional(),
    limit: retrievalLimitSchema,
    // When true, retrieval also surfaces superseded/expired history rows that are
    // otherwise hard-filtered out (S3.1.2). Default false, backward compatible.
    includeHistory: z.boolean().default(false),
  })
  .refine(
    (value) => value.query !== undefined || (value.mode !== "search" && value.mode !== "context"),
    {
      message: "query is required for search and context modes",
      path: ["query"],
    },
  );
export type RetrieveMemoryInput = z.input<typeof retrieveMemoryInputSchema>;

export const retrieveMemoryOutputSchema = z.object({
  memories: z.array(memorySchema),
});
export type RetrieveMemoryOutput = z.infer<typeof retrieveMemoryOutputSchema>;

/**
 * v2 `search` intake tool (S1.2.3). A client-facing explicit-lookup surface that
 * delegates to the lexical/semantic retrieval path. The portable contract
 * accepts scope and status filters; hosts document which filters their current
 * repository adapter applies.
 */
export const searchInputSchema = z.object({
  query: z.string().trim().min(1).max(500),
  filters: z
    .object({
      scope: memoryScopeSchema.optional(),
      status: memoryStatusSchema.optional(),
      limit: z.number().int().min(1).max(50).optional(),
    })
    .optional(),
});
export type SearchInput = z.input<typeof searchInputSchema>;

export const searchOutputSchema = retrieveMemoryOutputSchema;
export type SearchOutput = z.infer<typeof searchOutputSchema>;

export const listMemoriesInputSchema = z.object({
  scope: memoryScopeSchema.optional(),
  limit: z.number().int().min(1).max(100).default(20),
});
export type ListMemoriesInput = z.input<typeof listMemoriesInputSchema>;

export const listMemoriesOutputSchema = z.object({
  memories: z.array(memorySchema),
});
export type ListMemoriesOutput = z.infer<typeof listMemoriesOutputSchema>;

export const updateMemoryInputSchema = z
  .object({
    text: memoryTextSchema.optional(),
    scope: memoryScopeSchema.optional(),
    sessionNote: sessionNoteSchema.nullable().optional(),
  })
  .refine(
    (value) =>
      value.text !== undefined || value.scope !== undefined || value.sessionNote !== undefined,
    { message: "at least one field must be provided" },
  );
export type UpdateMemoryInput = z.input<typeof updateMemoryInputSchema>;

export const organizationSchema = z.object({
  id: z.uuid(),
  name: z.string().trim().min(1).max(200),
  createdAt: isoDatetimeSchema,
});
export type Organization = z.infer<typeof organizationSchema>;

/**
 * Executes normalize base url.
 *
 * @param baseUrl - Value supplied for `baseUrl`.
 * @returns The result produced by `normalizeBaseUrl`.
 * @throws Errors raised by validation or dependent operations.
 */
function normalizeBaseUrl(baseUrl: string | URL): string {
  return String(baseUrl).replace(/\/+$/, "");
}

/**
 * Executes memory app url.
 *
 * @param baseUrl - Value supplied for `baseUrl`.
 * @param memoryId - Value supplied for `memoryId`.
 * @returns The result produced by `memoryAppUrl`.
 * @throws Errors raised by validation or dependent operations.
 */
export function memoryAppUrl(baseUrl: string | URL, memoryId: string): string {
  return `${normalizeBaseUrl(baseUrl)}/memories/${memoryId}`;
}

/**
 * Executes memories list url.
 *
 * @param baseUrl - Value supplied for `baseUrl`.
 * @returns The result produced by `memoriesListUrl`.
 * @throws Errors raised by validation or dependent operations.
 */
export function memoriesListUrl(baseUrl: string | URL): string {
  return `${normalizeBaseUrl(baseUrl)}/memories`;
}
