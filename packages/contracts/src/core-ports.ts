/**
 * Defines provider-neutral callable ports used by the core memory engine.
 *
 * Inputs: Imported dependencies and values passed to the module's documented functions.
 * Outputs: Exported types, values, and behavior provided by the module.
 * Errors: Functions document validation, dependency, and runtime errors individually.
 *
 * @packageDocumentation
 */

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
