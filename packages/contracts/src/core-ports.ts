import { z } from "zod";

import { dispositionDecisionSchema } from "./policy-matrix.ts";

export const persistBatchContextSchema = z.object({
  batchId: z.string().min(1),
  sourceEventIds: z.array(z.uuid()),
  actorUserId: z.uuid(),
  activeOrgId: z.uuid().nullable(),
});
export type PersistBatchContext = z.infer<typeof persistBatchContextSchema>;

export const applyDispositionInputSchema = z.object({
  candidateId: z.uuid(),
  decision: dispositionDecisionSchema,
  lockedAt: z.date().optional(),
});
export type ApplyDispositionInput = z.infer<typeof applyDispositionInputSchema>;

export const packetConflictWriteOptionsSchema = z.object({
  reviewerUserId: z.uuid().optional(),
});
export type PacketConflictWriteOptions = z.infer<typeof packetConflictWriteOptionsSchema>;
