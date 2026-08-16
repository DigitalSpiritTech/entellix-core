import { z } from "zod";

import { conflictRelationSchema } from "./conflicts.ts";
import { audiencePolicyKindSchema, memoryTypeSchema, ownerScopeTypeSchema } from "./memory-v2.ts";
import { dispositionSchema } from "./policy-matrix.ts";
import { reconcileOperationSchema } from "./reconciler.ts";

/**
 * Review-queue contracts (S2.3.1). The human-in-the-loop surface: candidates the
 * policy matrix routed to `review` (plus the S1.2.2 migration-flagged backlog)
 * are shown with evidence, suggested disposition, and conflict targets for a
 * ~10-second decision. Every action writes a `memory_reviews` audit row and, when
 * it commits canonical memory, flows through the reconciler — the review UI never
 * writes `memories` directly (Core invariant 3; PRD §10, Decisions 10–12, 18).
 *
 * Convention mirrors the rest of contracts: `const FOO = [...] as const` →
 * `fooSchema = z.enum(FOO)` → `z.infer`. Imported via the
 * `@entellix/contracts/reviews` subpath (not the package barrel), like the other
 * pipeline contracts.
 */

const isoDatetimeSchema = z.iso.datetime({ offset: true });

/**
 * The eight reviewer actions (PRD §10 "Actions" line). Grouped by effect:
 * - COMMIT-ish (flow through the reconciler): `approve` (commit as suggested),
 *   `approve_with_edit` (commit with edits — directive edits stay byte-exact),
 *   `rescope` (change owner/audience, then commit), `save_as_user_private` (force
 *   owner=user + private_to_owner, then commit), `merge_with_existing` (MERGE into
 *   a target), `supersede_existing` (SUPERSEDE a target).
 * - NON-COMMIT (no canonical write): `reject` (candidate rejected — still
 *   reprocessable, never a hard delete), `mark_sensitive` (escalate sensitivity +
 *   re-gate to review; nothing commits on this action).
 */
export const REVIEW_ACTIONS = [
  "approve",
  "approve_with_edit",
  "rescope",
  "save_as_user_private",
  "reject",
  "merge_with_existing",
  "supersede_existing",
  "mark_sensitive",
] as const;
export const reviewActionSchema = z.enum(REVIEW_ACTIONS);
export type ReviewAction = z.infer<typeof reviewActionSchema>;

/**
 * Default staleness horizon: a candidate sitting in `review` longer than this
 * auto-expires (status `expired`) with a review row noting the auto-expiry. The
 * expiry is routing, never a discard — an expired candidate stays reprocessable.
 */
export const STALE_CANDIDATE_EXPIRY_DAYS = 30;

/** Cap on the free-text reviewer note stored on a decision. Short by construction. */
export const REVIEW_NOTE_MAX_LENGTH = 1000;

/**
 * A conflict target surfaced on a queue item: the existing active memory this
 * candidate collides with, the detected relation, and (best-effort) the existing
 * memory's content so the reviewer sees what they'd supersede/merge without a
 * second fetch.
 */
export const reviewQueueConflictSchema = z.object({
  existingMemoryId: z.uuid(),
  relation: conflictRelationSchema,
  existingContent: z.string().optional(),
});
export type ReviewQueueConflict = z.infer<typeof reviewQueueConflictSchema>;

/**
 * One row of the review queue: everything the reviewer needs for a fast decision.
 * `whoWouldSee` is a short human string rendering the suggested audience ("You
 * only", "Everyone at Acme", …) so the reviewer never has to decode a policy id.
 * `disposition`/`dispositionReason` echo the matrix verdict that routed the
 * candidate here (typically `review`) for auditability.
 */
export const reviewQueueItemSchema = z.object({
  candidateId: z.uuid(),
  candidateText: z.string().min(1),
  evidenceSpan: z.string().min(1),
  reasonSummary: z.string().min(1),
  suggestedType: memoryTypeSchema,
  suggestedOwner: ownerScopeTypeSchema,
  suggestedAudienceKind: audiencePolicyKindSchema,
  sourceEventIds: z.array(z.uuid()),
  conflicts: z.array(reviewQueueConflictSchema),
  whoWouldSee: z.string(),
  disposition: dispositionSchema,
  dispositionReason: z.string().nullable(),
  createdAt: isoDatetimeSchema,
});
export type ReviewQueueItem = z.infer<typeof reviewQueueItemSchema>;

/**
 * Optional overrides a reviewer applies before commit. Only present for actions
 * that edit the candidate (`approve_with_edit`, `rescope`). For a DIRECTIVE the
 * edited `content` is stored byte-exact — the reconciler's verbatim carve-out
 * (Decision 10) applies to the reviewer's text just as it does to captured text.
 */
export const reviewDecisionEditsSchema = z.object({
  content: z.string().min(1).optional(),
  memoryType: memoryTypeSchema.optional(),
  ownerScopeType: ownerScopeTypeSchema.optional(),
  audienceKind: audiencePolicyKindSchema.optional(),
});
export type ReviewDecisionEdits = z.infer<typeof reviewDecisionEditsSchema>;

/**
 * A single review decision. `targetMemoryId` is REQUIRED by `merge_with_existing`
 * and `supersede_existing` (the existing row acted on) and ignored otherwise;
 * `edits` is meaningful only for `approve_with_edit`/`rescope`. The service
 * validates those pairings (a merge/supersede without a target is a bad request).
 */
export const reviewDecisionInputSchema = z.object({
  candidateId: z.uuid(),
  action: reviewActionSchema,
  edits: reviewDecisionEditsSchema.optional(),
  targetMemoryId: z.uuid().optional(),
  note: z.string().max(REVIEW_NOTE_MAX_LENGTH).optional(),
});
export type ReviewDecisionInput = z.infer<typeof reviewDecisionInputSchema>;

/** A batch of decisions, executed independently (solo-operator speed). */
export const reviewDecisionBatchInputSchema = z.object({
  decisions: z.array(reviewDecisionInputSchema).min(1),
});
export type ReviewDecisionBatchInput = z.infer<typeof reviewDecisionBatchInputSchema>;

/**
 * The reconciler effect of a decision, when there was one. `null` for actions
 * that write no canonical memory (`reject`, `mark_sensitive`). `memoryId` is null
 * for a NOOP reconcile (exact duplicate).
 */
export const reviewReconcileOutcomeSchema = z.object({
  operation: reconcileOperationSchema,
  memoryId: z.uuid().nullable(),
});
export type ReviewReconcileOutcome = z.infer<typeof reviewReconcileOutcomeSchema>;

/**
 * The outcome of one decision: the candidate it resolved, the action taken, the
 * `memory_reviews` row id written for the audit trail, and the reconciler effect
 * (null when the action committed nothing).
 */
export const reviewDecisionResultSchema = z.object({
  candidateId: z.uuid(),
  action: reviewActionSchema,
  reviewId: z.uuid(),
  reconcileOutcome: reviewReconcileOutcomeSchema.nullable(),
});
export type ReviewDecisionResult = z.infer<typeof reviewDecisionResultSchema>;
