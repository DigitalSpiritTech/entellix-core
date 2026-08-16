import {
  eventSourceTypeSchema,
  memoryTypeSchema,
  ownerScopeTypeSchema,
  recordEventInputSchema,
  renderPolicySchema,
  sensitivitySchema,
  sourceAuthoritySchema,
} from "@entellix/contracts";
import { candidateStatusSchema, memoryCandidateSchema } from "@entellix/contracts/candidates";
import { classificationSchema } from "@entellix/contracts/classification";
import { dispositionDecisionSchema } from "@entellix/contracts/policy-matrix";
import { z } from "zod";

export const STANDALONE_ACTOR_ID = "00000000-0000-4000-8000-000000000011";
export const STANDALONE_WORKSPACE_ID = "00000000-0000-4000-8000-000000000022";

export const standaloneEventStatusSchema = z.enum(["queued", "processing", "completed", "failed"]);
export type StandaloneEventStatus = z.infer<typeof standaloneEventStatusSchema>;

export const standaloneEventSchema = z.object({
  id: z.uuid(),
  rawEvent: z.string(),
  sourceContext: z.string().nullable(),
  sourceType: eventSourceTypeSchema,
  sourceTrustClass: z.enum(["first_party", "external_included", "integration"]),
  status: standaloneEventStatusSchema,
  attempts: z.number().int().nonnegative(),
  error: z.string().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type StandaloneEvent = z.infer<typeof standaloneEventSchema>;

export const recordStandaloneEventInputSchema = recordEventInputSchema.pick({
  rawEvent: true,
  sourceContext: true,
  sourceType: true,
  sourceTrustClass: true,
  sessionId: true,
  messageId: true,
});
export type RecordStandaloneEventInput = z.input<typeof recordStandaloneEventInputSchema>;

export const eventReceiptSchema = z.object({
  eventId: z.uuid(),
  deduped: z.boolean(),
});
export type EventReceipt = z.infer<typeof eventReceiptSchema>;

export const candidateGovernanceSchema = z.object({
  classification: classificationSchema,
  decision: dispositionDecisionSchema,
});
export type CandidateGovernance = z.infer<typeof candidateGovernanceSchema>;

export const standaloneMemorySchema = z.object({
  id: z.uuid(),
  sourceCandidateId: z.uuid().nullable(),
  text: z.string().min(1),
  scope: z.enum(["profile", "organization"]),
  status: z.enum(["active", "removed", "superseded", "expired"]),
  memoryType: memoryTypeSchema,
  ownerScopeType: ownerScopeTypeSchema,
  renderPolicy: renderPolicySchema,
  confidence: z.number().min(0).max(1),
  sourceAuthority: sourceAuthoritySchema,
  sensitivity: sensitivitySchema,
  embedding: z.array(z.number()).nullable(),
  validFrom: z.date(),
  validTo: z.date().nullable(),
  expiresAt: z.date().nullable(),
  supersededBy: z.uuid().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type StandaloneMemory = z.infer<typeof standaloneMemorySchema>;

export const persistCandidateDecisionSchema = z.object({
  candidateId: z.uuid(),
  governance: candidateGovernanceSchema,
  status: candidateStatusSchema,
});
export type PersistCandidateDecision = z.infer<typeof persistCandidateDecisionSchema>;

export const commitCandidateInputSchema = z.object({
  candidate: memoryCandidateSchema,
  governance: candidateGovernanceSchema,
  operation: z.enum(["ADD", "SUPERSEDE", "MERGE", "NOOP"]),
  targetMemoryId: z.uuid().nullable(),
  embedding: z.array(z.number()).nullable().default(null),
  now: z.date(),
});
export type CommitCandidateInput = z.infer<typeof commitCandidateInputSchema>;

export const retentionResultSchema = z.object({
  eventsRedacted: z.number().int().nonnegative(),
  candidatesRedacted: z.number().int().nonnegative(),
  memoriesExpired: z.number().int().nonnegative(),
});
export type RetentionResult = z.infer<typeof retentionResultSchema>;

export const deleteResultSchema = z.object({
  reviews: z.number().int().nonnegative(),
  memories: z.number().int().nonnegative(),
  candidates: z.number().int().nonnegative(),
  events: z.number().int().nonnegative(),
});
export type DeleteResult = z.infer<typeof deleteResultSchema>;

export const standaloneExportSchema = z.object({
  format: z.literal("entellix-standalone-export/v1"),
  exportedAt: z.iso.datetime({ offset: true }),
  workspaceId: z.uuid(),
  memories: z.array(
    standaloneMemorySchema.omit({ embedding: true }).extend({
      validFrom: z.iso.datetime({ offset: true }),
      validTo: z.iso.datetime({ offset: true }).nullable(),
      expiresAt: z.iso.datetime({ offset: true }).nullable(),
      createdAt: z.iso.datetime({ offset: true }),
      updatedAt: z.iso.datetime({ offset: true }),
    }),
  ),
  events: z.array(
    standaloneEventSchema.extend({
      createdAt: z.iso.datetime({ offset: true }),
      updatedAt: z.iso.datetime({ offset: true }),
    }),
  ),
  candidates: z.array(z.record(z.string(), z.unknown())),
  reviews: z.array(z.record(z.string(), z.unknown())),
});
export type StandaloneExport = z.infer<typeof standaloneExportSchema>;
