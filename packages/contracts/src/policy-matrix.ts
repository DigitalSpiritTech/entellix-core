import { z } from "zod";

import { sensitivityAssessmentSchema } from "./classification.ts";
import { sourceTrustClassSchema } from "./events.ts";
import {
  audiencePolicyKindSchema,
  memoryTypeSchema,
  ownerScopeTypeSchema,
  sensitivitySchema,
  sourceAuthoritySchema,
} from "./memory-v2.ts";

/**
 * Confidence policy-matrix contracts (S2.2.2). Dispositions are decided by a
 * config-driven matrix of `memory_type × audience × source_authority ×
 * sensitivity` — policy DATA, not constants baked into code (PRD §10). The
 * matrix maps a classification tuple to a disposition with a per-cell confidence
 * threshold; `@entellix/core` evaluates it and ALSO enforces hard rules in code
 * that a matrix cell can never loosen.
 *
 * Convention mirrors the rest of contracts: `const FOO = [...] as const` →
 * `fooSchema = z.enum(FOO)` → `z.infer`. Deliberately NOT re-exported from the
 * package barrel; import via the `@entellix/contracts/policy-matrix` subpath so
 * the unbuilt index barrel does not gate this.
 *
 * Untunable-downward invariant (enforced in the engine, asserted here in shape):
 * hard rules (org-visible directive/policy, about-another-person, ambient rule
 * proposals, non-first-party directives) can force `review`/`reject`, but NO
 * matrix cell — however permissive — can escalate a hard-ruled classification to
 * `auto_commit` (Decisions 10, 18). The matrix tunes UP the strictness, never
 * down past the hard-rule floor.
 */

const isoDatetimeSchema = z.iso.datetime({ offset: true });

/**
 * The three terminal dispositions the matrix can assign to a candidate:
 * - `auto_commit` — earn commitment without a human (only the least-risky cells).
 * - `review`      — route to the human review queue (the safe default).
 * - `reject`      — do not commit (still reprocessable — never a hard delete).
 * Ordered least→most restrictive so the engine can compare "strictness" and the
 * hard-rule floor can raise (never lower) a matrix outcome.
 */
export const DISPOSITIONS = ["auto_commit", "review", "reject"] as const;
export const dispositionSchema = z.enum(DISPOSITIONS);
export type Disposition = z.infer<typeof dispositionSchema>;

/**
 * One matrix cell: a classification-tuple KEY → `disposition` at/above
 * `minConfidence`. `memoryType` is required (every anchor row keys on a type);
 * `audienceKind`/`sourceAuthority`/`sensitivityLevel` are nullable, where `null`
 * is a wildcard matching any value on that axis. A candidate whose confidence is
 * below `minConfidence` does NOT take this cell — it falls through to the config
 * `defaults` (review). Cell specificity = count of non-null axes; the engine
 * picks the most specific matching cell, ties broken by array order.
 */
export const policyMatrixCellSchema = z.object({
  memoryType: memoryTypeSchema,
  audienceKind: audiencePolicyKindSchema.nullable(),
  sourceAuthority: sourceAuthoritySchema.nullable(),
  sensitivityLevel: sensitivitySchema.nullable(),
  disposition: dispositionSchema,
  minConfidence: z.number().min(0).max(1),
});
export type PolicyMatrixCell = z.infer<typeof policyMatrixCellSchema>;

/**
 * A whole versioned matrix. `version` is stamped onto every disposition record
 * for auditability and reproducibility. `cells` are matched most-specific-first;
 * any tuple that matches no cell (or matches only below-threshold) falls back to
 * `defaults` — which defaults to `review` so an unmatched tuple NEVER silently
 * auto-commits. `defaults.minConfidence` is the confidence floor documented for
 * the default disposition (reserved for a future low-confidence reject tier;
 * the default disposition still applies below it today).
 */
export const policyMatrixConfigSchema = z.object({
  version: z.string().min(1),
  cells: z.array(policyMatrixCellSchema),
  defaults: z.object({
    disposition: dispositionSchema.default("review"),
    minConfidence: z.number().min(0).max(1),
  }),
});
export type PolicyMatrixConfig = z.infer<typeof policyMatrixConfigSchema>;

/**
 * The audit record persisted for a single disposition decision. `matrixVersion`
 * ties the decision to the exact matrix that produced it; `hardRule` names the
 * untunable-downward rule that governed the outcome, or is `null` when the
 * decision came purely from the matrix/defaults. `reason` is a short
 * human-facing explanation (no chain-of-thought). The developer persists these
 * fields with the candidate or host audit record.
 */
export const dispositionRecordSchema = z.object({
  candidateId: z.uuid(),
  disposition: dispositionSchema,
  matrixVersion: z.string().min(1),
  reason: z.string().min(1),
  hardRule: z.string().nullable(),
  decidedAt: isoDatetimeSchema,
});
export type DispositionRecord = z.infer<typeof dispositionRecordSchema>;

export const HARD_RULE_IDS = [
  "org_visible_directive_or_policy",
  "about_another_person",
  "ambient_source_rule_proposal",
  "non_first_party_directive",
] as const;
export const hardRuleIdSchema = z.enum(HARD_RULE_IDS);
export type HardRuleId = z.infer<typeof hardRuleIdSchema>;

/** Narrow classifier projection consumed by the policy matrix. */
export const evaluatedClassificationSchema = z.object({
  candidateId: z.uuid(),
  memoryType: memoryTypeSchema,
  owner: z.object({ scopeType: ownerScopeTypeSchema }),
  audienceSuggestion: audiencePolicyKindSchema,
  sourceAuthority: sourceAuthoritySchema,
  sensitivity: sensitivityAssessmentSchema,
  confidence: z.number().min(0).max(1),
});
export type EvaluatedClassification = z.infer<typeof evaluatedClassificationSchema>;

export const evaluateDispositionInputSchema = z.object({
  classification: evaluatedClassificationSchema,
  sourceTrustClass: sourceTrustClassSchema,
  matrix: policyMatrixConfigSchema,
});
export type EvaluateDispositionInput = z.infer<typeof evaluateDispositionInputSchema>;

export const dispositionDecisionSchema = z.object({
  disposition: dispositionSchema,
  matrixVersion: z.string().min(1),
  reason: z.string().min(1),
  hardRule: hardRuleIdSchema.nullable(),
});
export type DispositionDecision = z.infer<typeof dispositionDecisionSchema>;

export const simulationCandidateSchema = z.object({
  classification: evaluatedClassificationSchema,
  sourceTrustClass: sourceTrustClassSchema,
});
export type SimulationCandidate = z.infer<typeof simulationCandidateSchema>;

export const simulateMatrixInputSchema = z.object({
  candidates: z.array(simulationCandidateSchema),
  activeMatrix: policyMatrixConfigSchema,
  draftMatrix: policyMatrixConfigSchema,
});
export type SimulateMatrixInput = z.infer<typeof simulateMatrixInputSchema>;

export const simulationCandidateDiffSchema = z.object({
  candidateId: z.uuid(),
  activeDisposition: dispositionSchema,
  draftDisposition: dispositionSchema,
  changed: z.boolean(),
});
export type SimulationCandidateDiff = z.infer<typeof simulationCandidateDiffSchema>;

const dispositionCountsSchema = z.record(dispositionSchema, z.number().int().nonnegative());

export const simulationDiffSchema = z.object({
  perCandidate: z.array(simulationCandidateDiffSchema),
  summary: z.object({
    total: z.number().int().nonnegative(),
    changed: z.number().int().nonnegative(),
    activeCounts: dispositionCountsSchema,
    draftCounts: dispositionCountsSchema,
  }),
});
export type SimulationDiff = z.infer<typeof simulationDiffSchema>;
