/**
 * Defines conflict relations and detector results for candidate reconciliation.
 *
 * Inputs: Imported dependencies and values passed to the module's documented functions.
 * Outputs: Exported types, values, and behavior provided by the module.
 * Errors: Functions document validation, dependency, and runtime errors individually.
 *
 * @packageDocumentation
 */

import { z } from "zod";

import { memoryTypeSchema, ownerScopeTypeSchema } from "./memory-v2.ts";

/**
 * Conflict-detection contracts. Before a classified candidate is
 * committed, it is compared against the caller's existing ACTIVE memories in the
 * same owner + entity neighborhood. Nearest neighbors (vector + FTS, scoped to
 * the same owner_scope with overlapping entity links) are classified pairwise
 * into one of four relations, and those annotations drive a reconciler
 * operation suggestion. Conflict annotations are
 * staging metadata on a candidate — never canonical memory, never written by an
 * external agent (only the service-role pipeline persists them).
 *
 * Convention mirrors the rest of contracts: `const FOO = [...] as const` →
 * `fooSchema = z.enum(FOO)` → `z.infer`. Deliberately NOT re-exported from the
 * package barrel; import via the `@entellix/contracts/conflicts` subpath.
 */

/**
 * The four relations a (candidate, neighbor) pair can hold. `supersedes`: the
 * candidate replaces the neighbor (state change — "Acme uses Next.js" over
 * "Acme uses Webflow"). `contradicts`: they disagree but neither cleanly wins
 * (murky preference reversal → review, never auto-resolved). `duplicates`: the
 * candidate restates the neighbor (merge/no-op). `coexists`: no conflict, both
 * remain valid.
 */
export const CONFLICT_RELATIONS = ["supersedes", "contradicts", "duplicates", "coexists"] as const;
export const conflictRelationSchema = z.enum(CONFLICT_RELATIONS);
export type ConflictRelation = z.infer<typeof conflictRelationSchema>;

/** Conflict-classifier prompt id, versioned CONFIG (not code) so changes audit. */
export const CONFLICT_PROMPT_VERSION = "conflict/2026-07-06";

/**
 * Cap on the human-facing rationale a conflict annotation carries. Short by
 * construction — one sentence explaining the relation, no chain-of-thought.
 */
export const CONFLICT_RATIONALE_MAX_LENGTH = 280;

/**
 * A nearest-neighbor active memory returned by findNeighbors, scoped to the
 * candidate's owner and overlapping entity links. `similarity` is the fused
 * vector + lexical score used to rank neighbors before pairwise classification.
 */
export const neighborSchema = z.object({
  memoryId: z.uuid(),
  content: z.string().min(1),
  memoryType: memoryTypeSchema,
  ownerScopeType: ownerScopeTypeSchema,
  ownerScopeId: z.uuid(),
  entityIds: z.array(z.uuid()),
  similarity: z.number(),
});
export type Neighbor = z.infer<typeof neighborSchema>;

/**
 * One conflict classification as emitted by the LLM for a single neighbor
 * (Zod-validated model output). The detector assembles the full annotation by
 * stamping the candidate id onto each of these. `existingMemoryId` is the
 * neighbor the relation is about.
 */
export const conflictClassificationSchema = z.object({
  existingMemoryId: z.uuid(),
  relation: conflictRelationSchema,
  confidence: z.number().min(0).max(1),
  rationale: z.string().trim().min(1).max(CONFLICT_RATIONALE_MAX_LENGTH),
});
export type ConflictClassification = z.infer<typeof conflictClassificationSchema>;

/** Whole-response classifier output: 0..N pair classifications, one per neighbor. */
export const conflictClassificationOutputSchema = z.object({
  annotations: z.array(conflictClassificationSchema),
});
export type ConflictClassificationOutput = z.infer<typeof conflictClassificationOutputSchema>;

/**
 * A conflict annotation as persisted to `memory_candidate_conflicts`: the
 * candidate, the existing memory it relates to, the relation + confidence, and
 * a short rationale. PK is (candidateId, existingMemoryId) — one relation per
 * pair.
 */
export const conflictAnnotationSchema = z.object({
  candidateId: z.uuid(),
  existingMemoryId: z.uuid(),
  relation: conflictRelationSchema,
  confidence: z.number().min(0).max(1),
  rationale: z.string().trim().min(1).max(CONFLICT_RATIONALE_MAX_LENGTH),
});
export type ConflictAnnotation = z.infer<typeof conflictAnnotationSchema>;

/**
 * Operations a conflict analysis can suggest. This is intentionally a
 * conflict-specific vocabulary: it excludes write-only SPLIT/EXPIRE/UPDATE and
 * includes REVIEW, which stops the candidate before reconciliation.
 */
export const CONFLICT_OPERATIONS = ["ADD", "SUPERSEDE", "MERGE", "NOOP", "REVIEW"] as const;
export const conflictOperationSchema = z.enum(CONFLICT_OPERATIONS);
export type ConflictOperation = z.infer<typeof conflictOperationSchema>;

/**
 * The disposition hint conflict detection hands the reconciler: which operation
 * to run, the target existing memory (when the operation acts on one), and the
 * driving relation (null when there was no conflicting neighbor → a plain ADD).
 */
export const operationSuggestionSchema = z.object({
  operation: conflictOperationSchema,
  targetMemoryId: z.uuid().nullable(),
  relation: conflictRelationSchema.nullable(),
});
export type OperationSuggestion = z.infer<typeof operationSuggestionSchema>;

/** Candidate projection accepted by a host-owned neighbor search adapter. */
export const neighborCandidateSchema = z.object({
  text: z.string().min(1),
  ownerScopeType: ownerScopeTypeSchema,
  ownerScopeId: z.uuid(),
  entityIds: z.array(z.uuid()),
});
export type NeighborCandidate = z.infer<typeof neighborCandidateSchema>;

export const findNeighborsInputSchema = z.object({
  candidate: neighborCandidateSchema,
  limit: z.number().int().positive().optional(),
});
export type FindNeighborsInput = z.infer<typeof findNeighborsInputSchema>;

export const neighborQueryFiltersSchema = neighborCandidateSchema.omit({ text: true }).extend({
  status: z.literal("active"),
  limit: z.number().int().positive(),
});
export type NeighborQueryFilters = z.infer<typeof neighborQueryFiltersSchema>;

/** Versioned model and prompt selection supplied to the conflict detector. */
export const conflictDetectorConfigSchema = z.object({
  model: z.string().trim().min(1),
  promptVersion: z.string().trim().min(1),
});
export type ConflictDetectorConfig = z.infer<typeof conflictDetectorConfigSchema>;

export const conflictCandidateSchema = z.object({
  id: z.uuid(),
  text: z.string().min(1),
});
export type ConflictCandidate = z.infer<typeof conflictCandidateSchema>;

export const classifyPairsInputSchema = z.object({
  candidate: conflictCandidateSchema,
  neighbors: z.array(neighborSchema),
});
export type ClassifyPairsInput = z.infer<typeof classifyPairsInputSchema>;
