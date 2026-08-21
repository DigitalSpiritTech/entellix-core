/**
 * Detects candidate conflicts and selects reconciliation-oriented relations.
 *
 * Inputs: Imported dependencies and values passed to the module's documented functions.
 * Outputs: Exported types, values, and behavior provided by the module.
 * Errors: Functions document validation, dependency, and runtime errors individually.
 *
 * @packageDocumentation
 */

import {
  type ClassifyPairsInput,
  type ConflictAnnotation,
  type ConflictClassification,
  type ConflictDetectorConfig,
  type NeighborCandidate,
  type NeighborQueryFilters,
  type OperationSuggestion,
  classifyPairsInputSchema,
  conflictClassificationOutputSchema,
  conflictDetectorConfigSchema,
} from "@entellix/contracts/conflicts";

import { buildConflictPrompt } from "./conflict-prompt.ts";
import { extractJsonText } from "./model-output.ts";

export { buildConflictPrompt } from "./conflict-prompt.ts";
export type {
  ClassifyPairsInput,
  ConflictCandidate,
  ConflictDetectorConfig,
  FindNeighborsInput,
  NeighborCandidate,
  NeighborQueryFilters,
} from "@entellix/contracts/conflicts";

/** Default nearest-neighbor fan-in for conflict comparison — a handful, not a page. */
export const DEFAULT_NEIGHBOR_LIMIT = 10;

/**
 * The scoping predicate the neighbor query MUST enforce, split out as a pure
 * function so the owner-scope + entity-overlap + active-only invariants are
 * unit-testable without a database. findNeighbors builds its SQL from this.
 */
/**
 * Pure builder for the neighbor-query scoping filters. Conflict neighbors are
 * constrained to the SAME owner_scope (owner_scope_type + owner_scope_id), with
 * at least one OVERLAPPING entity link, and status = 'active'. Splitting this
 * out keeps the scoping invariants testable in isolation from the fused query.
 *
 * @param candidate - Value supplied for `candidate`.
 * @param limit - Value supplied for `limit`.
 * @returns The result produced by `buildNeighborQueryFilters`.
 * @throws Errors raised by validation or dependent operations.
 */
export function buildNeighborQueryFilters(
  candidate: NeighborCandidate,
  limit: number = DEFAULT_NEIGHBOR_LIMIT,
): NeighborQueryFilters {
  return {
    ownerScopeType: candidate.ownerScopeType,
    ownerScopeId: candidate.ownerScopeId,
    entityIds: candidate.entityIds,
    status: "active",
    limit,
  };
}

/** The raw LLM call, injected so unit tests use fakes and the model stays config. */
export type ConflictGenerateFn = (prompt: string) => Promise<string>;

export interface ConflictDetectorDeps {
  generate: ConflictGenerateFn;
  config: ConflictDetectorConfig;
}

export interface ConflictDetector {
  /**
   * Executes classify pairs.
   *
   * @param input - Value supplied for `input`.
   * @returns The result produced by `classifyPairs`.
   * @throws Errors raised by validation or dependent operations.
   */
  classifyPairs(input: ClassifyPairsInput): Promise<ConflictAnnotation[]>;
}

/** Kinds of failure the pair classifier raises as a typed, catchable error. */
export const CONFLICT_DETECTOR_ERROR_KINDS = ["output_invalid"] as const;
export type ConflictDetectorErrorKind = (typeof CONFLICT_DETECTOR_ERROR_KINDS)[number];

/**
 * Typed conflict-detector failure. Structural (not a class subtype) so it stays
 * within the functional-TS rules: build with `new Error` then tag it. Thrown
 * after the LLM output fails Zod validation twice (initial + one retry). Mirrors
 * the classifier's ClassifierError.
 */
export interface ConflictDetectorError extends Error {
  readonly kind: ConflictDetectorErrorKind;
  /** How many generate() attempts were made before giving up (always 2 here). */
  readonly attempts: number;
}

/**
 * Creates conflict detector error.
 *
 * @param kind - Value supplied for `kind`.
 * @param attempts - Value supplied for `attempts`.
 * @param message - Value supplied for `message`.
 * @returns The result produced by `createConflictDetectorError`.
 * @throws Errors raised by validation or dependent operations.
 */
export function createConflictDetectorError(
  kind: ConflictDetectorErrorKind,
  attempts: number,
  message: string,
): ConflictDetectorError {
  return Object.assign(new Error(message), { kind, attempts } as const);
}

/**
 * Determines whether conflict detector error.
 *
 * @param value - Value supplied for `value`.
 * @returns The result produced by `isConflictDetectorError`.
 * @throws Errors raised by validation or dependent operations.
 */
export function isConflictDetectorError(value: unknown): value is ConflictDetectorError {
  return (
    value instanceof Error &&
    (CONFLICT_DETECTOR_ERROR_KINDS as readonly string[]).includes(
      (value as ConflictDetectorError).kind,
    )
  );
}

/** Parses + validates a raw model response; null on invalid JSON or shape.
 *
 * @param raw - Value supplied for `raw`.
 * @param allowedMemoryIds - Value supplied for `allowedMemoryIds`.
 * @returns The result produced by `parseConflictOutput`.
 * @throws Errors raised by validation or dependent operations.
 */
function parseConflictOutput(
  raw: string,
  allowedMemoryIds?: ReadonlySet<string>,
): ConflictClassification[] | null {
  let json: unknown;
  try {
    json = JSON.parse(extractJsonText(raw));
  } catch {
    return null;
  }
  const parsed = conflictClassificationOutputSchema.safeParse(json);
  if (!parsed.success) return null;
  if (
    allowedMemoryIds &&
    parsed.data.annotations.some((annotation) => !allowedMemoryIds.has(annotation.existingMemoryId))
  ) {
    return null;
  }
  return parsed.data.annotations;
}

/**
 * Classifies each (candidate, neighbor) pair into a relation via the injected
 * LLM. Output is Zod-validated (conflictClassificationOutputSchema), retried
 * once on invalid, and each classification is stamped with the candidate id to
 * form a ConflictAnnotation. Returns an empty array when there are no neighbors
 * (no LLM call).
 *
 * @param deps - Value supplied for `deps`.
 * @returns The result produced by `createConflictDetector`.
 * @throws Errors raised by validation or dependent operations.
 */
export function createConflictDetector(deps: ConflictDetectorDeps): ConflictDetector {
  const { generate } = deps;
  conflictDetectorConfigSchema.parse(deps.config);
  return {
    /**
     * Executes classify pairs.
     *
     * @param rawInput - Value supplied for `rawInput`.
     * @returns The result produced by `classifyPairs`.
     * @throws Errors raised by validation or dependent operations.
     */
    async classifyPairs(rawInput: ClassifyPairsInput): Promise<ConflictAnnotation[]> {
      const input = classifyPairsInputSchema.parse(rawInput);
      const { candidate, neighbors } = input;
      if (neighbors.length === 0) return [];

      const prompt = buildConflictPrompt(candidate, neighbors);
      const allowedMemoryIds = new Set(neighbors.map((neighbor) => neighbor.memoryId));

      let classifications = parseConflictOutput(await generate(prompt), allowedMemoryIds);
      if (classifications === null) {
        // Zod-validate LLM output; retry exactly once on invalid, then give up
        // with a typed error (never a third attempt).
        classifications = parseConflictOutput(await generate(prompt), allowedMemoryIds);
        if (classifications === null) {
          throw createConflictDetectorError(
            "output_invalid",
            2,
            "conflict-detector output failed validation twice (initial + one retry)",
          );
        }
      }

      return classifications.map((classification) => ({
        candidateId: candidate.id,
        existingMemoryId: classification.existingMemoryId,
        relation: classification.relation,
        confidence: classification.confidence,
        rationale: classification.rationale,
      }));
    },
  };
}

/**
 * Confidence at or above which a `supersedes` relation is trusted enough to
 * suggest an automatic SUPERSEDE (below it, the pipeline falls back to review).
 */
export const SUPERSEDE_CONFIDENCE_THRESHOLD = 0.7;

/**
 * Turns a candidate's conflict annotations into a single reconciler operation
 * suggestion. PURE — no I/O. Precedence:
 *   - a confident `supersedes` (confidence ≥ SUPERSEDE_CONFIDENCE_THRESHOLD)
 *       → SUPERSEDE targeting that memory
 *   - a `contradicts` → REVIEW (contextual preferences are never auto-resolved)
 *   - a below-threshold `supersedes` → REVIEW targeting that memory (the
 *     detector saw a probable replacement but is not confident enough to
 *     auto-supersede; silently ADDing next to it would leave two live rows
 *     that disagree)
 *   - a `duplicates` → MERGE targeting the duplicate
 *   - nothing conflicting / only `coexists` / no neighbors → ADD (no target)
 *
 * @param annotations - Value supplied for `annotations`.
 * @returns The result produced by `suggestOperation`.
 * @throws Errors raised by validation or dependent operations.
 */
export function suggestOperation(annotations: ConflictAnnotation[]): OperationSuggestion {
  const supersede = annotations.find(
    (annotation) =>
      annotation.relation === "supersedes" &&
      annotation.confidence >= SUPERSEDE_CONFIDENCE_THRESHOLD,
  );
  if (supersede) {
    return {
      operation: "SUPERSEDE",
      targetMemoryId: supersede.existingMemoryId,
      relation: "supersedes",
    };
  }

  const contradicts = annotations.find((annotation) => annotation.relation === "contradicts");
  if (contradicts) {
    return {
      operation: "REVIEW",
      targetMemoryId: contradicts.existingMemoryId,
      relation: "contradicts",
    };
  }

  // A supersedes below the confidence threshold: not trusted enough to
  // auto-supersede, not safe to ADD alongside — fall back to review.
  const uncertainSupersede = annotations.find((annotation) => annotation.relation === "supersedes");
  if (uncertainSupersede) {
    return {
      operation: "REVIEW",
      targetMemoryId: uncertainSupersede.existingMemoryId,
      relation: "supersedes",
    };
  }

  const duplicates = annotations.find((annotation) => annotation.relation === "duplicates");
  if (duplicates) {
    return {
      operation: "MERGE",
      targetMemoryId: duplicates.existingMemoryId,
      relation: "duplicates",
    };
  }

  return { operation: "ADD", targetMemoryId: null, relation: null };
}
