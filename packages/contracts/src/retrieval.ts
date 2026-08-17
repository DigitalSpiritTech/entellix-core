import { z } from "zod";

import { memoryStatusSchema } from "./index.ts";
import { memoryTypeSchema, ownerScopeTypeSchema, renderPolicySchema } from "./memory-v2.ts";

export const retrievalCandidateSchema = z.object({
  id: z.uuid(),
  rank: z.number().int().positive(),
  distance: z.number().optional(),
  exactMatch: z.boolean().optional(),
  hasEmbedding: z.boolean().optional(),
});
export type RetrievalCandidate = z.infer<typeof retrievalCandidateSchema>;

export const fusedCandidateSchema = z.object({
  id: z.uuid(),
  score: z.number(),
});
export type FusedCandidate = z.infer<typeof fusedCandidateSchema>;

export const fusionMemorySchema = z.object({
  id: z.uuid(),
  status: memoryStatusSchema,
  memoryType: memoryTypeSchema.nullable(),
  renderPolicy: renderPolicySchema.nullable(),
  ownerScopeType: ownerScopeTypeSchema.nullable(),
  ownerScopeId: z.uuid().nullable(),
  subjectEntityId: z.uuid().nullable(),
  validFrom: z.date().nullable(),
  validTo: z.date().nullable(),
  updatedAt: z.date(),
});
export type FusionMemory = z.infer<typeof fusionMemorySchema>;

export const retrievalContextEnvelopeSchema = z.object({
  ownerScopeType: ownerScopeTypeSchema.optional(),
  ownerScopeId: z.uuid().optional(),
  entityIds: z.array(z.uuid()).optional(),
});
export type RetrievalContextEnvelope = z.infer<typeof retrievalContextEnvelopeSchema>;
