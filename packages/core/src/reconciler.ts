/**
 * Implements reconciler behavior for this TypeScript module.
 *
 * Inputs: Imported dependencies and values passed to the module's documented functions.
 * Outputs: Exported types, values, and behavior provided by the module.
 * Errors: Functions document validation, dependency, and runtime errors individually.
 *
 * @packageDocumentation
 */

import {
  type DerivedRowPolicies,
  type MemoryType,
  type OperationSelection,
  type ReconcileConflictAnnotation,
  type ReconcileOperation,
  TYPE_DERIVED_POLICIES,
} from "@entellix/contracts/reconciler";

export type { DerivedRowPolicies, OperationSelection } from "@entellix/contracts/reconciler";
/**
 * Provider-neutral reconciliation rules (S2.2.4). A host adapter applies these
 * decisions transactionally to its canonical memory repository.
 *
 * NO DELETE PATH: this module deliberately exports no delete-named member.
 * EXPIRE ends a row's life via status='expired'; SUPERSEDE closes valid_to and
 * chains superseded_by — rows are never removed (Core invariant 4). The unit
 * spec asserts the exported surface has no delete member; the integration spec
 * asserts row counts never decrease through any operation.
 */

/** Cap for canonicalized non-verbatim content; truncation is sentence-aware. */
export const MAX_CANONICAL_CONTENT_LENGTH = 500;

/** Kinds of failure the reconciler raises as a typed, catchable error. */
export const RECONCILER_ERROR_KINDS = [
  /** A `contradicts` annotation reached the reconciler as auto-committable. */
  "contradiction_not_auto_committable",
  /** The candidate's disposition is not committable (not auto_commit/approved). */
  "invalid_disposition",
  /** A verbatim (directive/policy) row's stored content drifted from the input. */
  "directive_mutated",
  /** A targeted operation did not resolve to one exact tenant/owner row. */
  "invalid_target",
  /** A candidate was redelivered with a different operation than its receipt. */
  "candidate_receipt_conflict",
  /** A durable worker attempted to reconcile after its candidate lease was replaced. */
  "stale_candidate_lease",
] as const;
export type ReconcilerErrorKind = (typeof RECONCILER_ERROR_KINDS)[number];

/**
 * Typed reconciler failure. Structural (not a class subtype) to stay within the
 * functional-TS rules: build with `new Error` then tag it (mirrors
 * createExtractorError in the extractor module).
 */
export interface ReconcilerError extends Error {
  readonly kind: ReconcilerErrorKind;
}

/**
 * Creates reconciler error.
 *
 * @param kind - Value supplied for `kind`.
 * @param message - Value supplied for `message`.
 * @returns The result produced by `createReconcilerError`.
 * @throws Errors raised by validation or dependent operations.
 */
export function createReconcilerError(kind: ReconcilerErrorKind, message: string): ReconcilerError {
  return Object.assign(new Error(message), { kind } as const);
}

/**
 * Determines whether reconciler error.
 *
 * @param value - Value supplied for `value`.
 * @returns The result produced by `isReconcilerError`.
 * @throws Errors raised by validation or dependent operations.
 */
export function isReconcilerError(value: unknown): value is ReconcilerError {
  return (
    value instanceof Error &&
    (RECONCILER_ERROR_KINDS as readonly string[]).includes((value as ReconcilerError).kind)
  );
}

/**
 * Verbatim carve-out guard (Decision 10, PRD §9). For directive/policy content
 * the stored bytes MUST equal the source bytes — no canonicalization,
 * summarization, or merge may touch them. This guard is LIVE (not a stub): it
 * throws the moment stored content drifts from the original, protecting the
 * transactional commit boundary and its byte-equality property tests.
 *
 * @param original - Value supplied for `original`.
 * @param stored - Value supplied for `stored`.
 * @returns Nothing.
 * @throws A ReconcilerError when stored directive or policy content differs from its source.
 */
export function assertDirectiveByteEquality(original: string, stored: string): void {
  if (original !== stored) {
    throw createReconcilerError(
      "directive_mutated",
      "verbatim content (directive/policy) must be byte-identical through the pipeline",
    );
  }
}

/**
 * Canonicalize content for commit. PURE.
 *
 * Verbatim types (directive, policy — where TYPE_DERIVED_POLICIES.contentVerbatim
 * is true): BYTE-IDENTICAL passthrough. The input is returned unchanged.
 *
 * Non-verbatim types: a short, normalized, retrieval-friendly form —
 *   1. leading/trailing whitespace trimmed,
 *   2. all internal whitespace runs (spaces, tabs, newlines) collapsed to a
 *      single space,
 *   3. truncated to MAX_CANONICAL_CONTENT_LENGTH at the last sentence boundary
 *      (. ! ?) at or before the cap, falling back to a word boundary, so the
 *      stored text never ends mid-sentence with trailing punctuation-only noise.
 *
 * @param input - Value supplied for `input`.
 * @returns The result produced by `canonicalizeContent`.
 * @throws Errors raised by validation or dependent operations.
 */
export function canonicalizeContent(input: { text: string; memoryType: MemoryType }): string {
  // Verbatim carve-out (Decision 10): directive/policy content is returned
  // byte-for-byte, so the byte-equality property test holds through commit.
  if (TYPE_DERIVED_POLICIES[input.memoryType].contentVerbatim) return input.text;

  // Non-verbatim: trim + collapse every whitespace run (spaces/tabs/newlines)
  // to a single space, then bound the length.
  const normalized = input.text.replace(/\s+/gu, " ").trim();
  if (normalized.length <= MAX_CANONICAL_CONTENT_LENGTH) return normalized;

  const capped = normalized.slice(0, MAX_CANONICAL_CONTENT_LENGTH);
  // Prefer the last sentence boundary (. ! ?) at/before the cap so stored text
  // never ends mid-sentence; fall back to the last word boundary so it never
  // ends mid-word.
  const lastSentence = Math.max(
    capped.lastIndexOf("."),
    capped.lastIndexOf("!"),
    capped.lastIndexOf("?"),
  );
  if (lastSentence >= 0) return capped.slice(0, lastSentence + 1).trimEnd();

  const lastSpace = capped.lastIndexOf(" ");
  return (lastSpace > 0 ? capped.slice(0, lastSpace) : capped).trimEnd();
}

/**
 * Derive render_policy / content_verbatim / expires_at from the memory type at
 * commit (Decision 17). PURE — reads TYPE_DERIVED_POLICIES and resolves
 * `defaultTtlDays` against the injected `now`.
 *
 * @param memoryType - Value supplied for `memoryType`.
 * @param now - Value supplied for `now`.
 * @returns The result produced by `deriveRowPolicies`.
 * @throws Errors raised by validation or dependent operations.
 */
export function deriveRowPolicies(memoryType: MemoryType, now: Date): DerivedRowPolicies {
  const policy = TYPE_DERIVED_POLICIES[memoryType];
  const expiresAt =
    policy.defaultTtlDays === null
      ? null
      : new Date(now.getTime() + policy.defaultTtlDays * 24 * 60 * 60 * 1000);
  return {
    renderPolicy: policy.renderPolicy,
    contentVerbatim: policy.contentVerbatim,
    expiresAt,
  };
}

/**
 * Decide the reconcile operation from the conflict annotations (and an optional
 * upstream guess). PURE. Precedence:
 *   - `contradicts` present → THROW (contradictions route to review, never
 *     auto-commit; reaching the reconciler is a guard violation).
 *   - confident `supersedes` → SUPERSEDE(target).
 *   - `duplicates` with materiallyDifferent → MERGE(target); else NOOP(target).
 *   - otherwise → the upstream operation guess, or ADD when there is none.
 *
 * @param input - Value supplied for `input`.
 * @returns The result produced by `selectOperation`.
 * @throws Errors raised by validation or dependent operations.
 */
export function selectOperation(input: {
  dispositionOperationGuess?: ReconcileOperation;
  conflictAnnotations: ReconcileConflictAnnotation[];
}): OperationSelection {
  const { dispositionOperationGuess, conflictAnnotations } = input;

  // Contradictions never auto-commit — reaching the reconciler is a guard
  // violation (they route to review upstream, S2.2.3).
  if (conflictAnnotations.some((annotation) => annotation.relation === "contradicts")) {
    throw createReconcilerError(
      "contradiction_not_auto_committable",
      "a contradicting candidate reached the reconciler — contradictions route to review, never auto-commit",
    );
  }

  const supersedes = conflictAnnotations.find((annotation) => annotation.relation === "supersedes");
  if (supersedes) return { operation: "SUPERSEDE", targetMemoryId: supersedes.memoryId };

  const duplicates = conflictAnnotations.find((annotation) => annotation.relation === "duplicates");
  if (duplicates) {
    return {
      operation: duplicates.materiallyDifferent ? "MERGE" : "NOOP",
      targetMemoryId: duplicates.memoryId,
    };
  }

  return { operation: dispositionOperationGuess ?? "ADD" };
}
