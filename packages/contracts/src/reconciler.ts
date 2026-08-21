/**
 * Defines canonical-memory reconciliation operations, inputs, and results.
 *
 * Inputs: Imported dependencies and values passed to the module's documented functions.
 * Outputs: Exported types, values, and behavior provided by the module.
 * Errors: Functions document validation, dependency, and runtime errors individually.
 *
 * @packageDocumentation
 */

import { z } from "zod";

import {
  type MemoryType,
  type RenderPolicy,
  memoryTypeSchema,
  ownerScopeTypeSchema,
  renderPolicySchema,
  sensitivitySchema,
  sourceAuthoritySchema,
} from "./memory-v2.ts";

/**
 * Reconciler contracts. The reconciler is the single transactional
 * writer that turns a governed, enriched candidate into a canonical `memories`
 * row with bi-temporal validity and full version history. It is the ONLY place
 * canonical memory is minted — external agents never write `memories` (Core
 * invariant 3). The seven operations are executable dispositions; REVIEW is a
 * disposition handled upstream by the policy matrix, never an operation here.
 *
 * Convention (repo-wide): `const FOO = [...] as const` → `fooSchema = z.enum(FOO)`
 * → `z.infer`. These arrays are the single source of truth for the reconciler,
 * its specs, and the supersession evaluation metric.
 */

const isoDatetimeSchema = z.iso.datetime({ offset: true });

/**
 * The seven reconcile operations. `REVIEW` is deliberately
 * absent — it is a policy-matrix disposition, not a bi-temporal write. A
 * candidate that should be reviewed never reaches the reconciler as an
 * auto-committable operation.
 * - `ADD`      — new canonical memory; opens the first valid_from window.
 * - `UPDATE`   — in-place correction of a live row (no supersession chain).
 * - `SUPERSEDE`— close the target's valid_to + open a new row's valid_from.
 * - `MERGE`    — fold a duplicate-with-new-detail into the target row.
 * - `SPLIT`    — one candidate becomes multiple canonical rows.
 * - `EXPIRE`   — end-of-life a row (status=expired), never DELETE.
 * - `NOOP`     — exact duplicate; nothing new is written.
 */
export const RECONCILE_OPERATIONS = [
  "ADD",
  "UPDATE",
  "SUPERSEDE",
  "MERGE",
  "SPLIT",
  "EXPIRE",
  "NOOP",
] as const;
export const reconcileOperationSchema = z.enum(RECONCILE_OPERATIONS);
export type ReconcileOperation = z.infer<typeof reconcileOperationSchema>;

/**
 * Row-policy shape derived from a memory's type at commit. `renderPolicy` and
 * `contentVerbatim` are not free choices per row:
 * they are a function of `memoryType`, so a service worker cannot silently mint
 * a pinned/verbatim row of the wrong type. Overrides exist ONLY through the
 * review path (not encoded here). `defaultTtlDays` seeds `expires_at` for
 * lifecycle-bounded types.
 */
export const typeDerivedPolicySchema = z.object({
  renderPolicy: renderPolicySchema,
  contentVerbatim: z.boolean(),
  defaultTtlDays: z.number().int().positive().nullable(),
});
export type TypeDerivedPolicy = z.infer<typeof typeDerivedPolicySchema>;

/**
 * Type-to-row-policy map. Encoded choices:
 *
 * - `directive`  → { pinned, verbatim, no-ttl }. The canonical verbatim type:
 *   byte-identical storage and always pinned into packets.
 * - `policy`     → { pinned, verbatim, no-ttl }. A `policy` memory
 *   materializes as an org-level directive, so it inherits directive semantics —
 *   verbatim + pinned. This is why the policy-matrix hard rules treat
 *   "directives/policies" together (org-visible → review). Documented choice.
 * - `task_state` → { retrieval, non-verbatim, ttl=14 }. Lifecycle-bounded: a
 *   task state goes stale, so it self-expires after 14 days unless refreshed.
 * - `observation`→ { never, non-verbatim, no-ttl }. Documented choice: raw
 *   observations are ambient signal that feed DERIVED memories; they are
 *   retained (audit/derivation) but not surfaced raw, hence render_policy
 *   `never` rather than `retrieval`. (Switch to `retrieval` only if a future
 *   retrieval test needs raw observations surfaced — it does not today.)
 * - everything else (`fact`, `preference`, `decision`, `procedure`,
 *   `episodic_event`) → { retrieval, non-verbatim, no-ttl }: the normal
 *   recall-first path.
 */
export const TYPE_DERIVED_POLICIES: Record<MemoryType, TypeDerivedPolicy> = {
  fact: { renderPolicy: "retrieval", contentVerbatim: false, defaultTtlDays: null },
  preference: { renderPolicy: "retrieval", contentVerbatim: false, defaultTtlDays: null },
  directive: { renderPolicy: "pinned", contentVerbatim: true, defaultTtlDays: null },
  decision: { renderPolicy: "retrieval", contentVerbatim: false, defaultTtlDays: null },
  task_state: { renderPolicy: "retrieval", contentVerbatim: false, defaultTtlDays: 14 },
  procedure: { renderPolicy: "retrieval", contentVerbatim: false, defaultTtlDays: null },
  episodic_event: { renderPolicy: "retrieval", contentVerbatim: false, defaultTtlDays: null },
  observation: { renderPolicy: "never", contentVerbatim: false, defaultTtlDays: null },
  policy: { renderPolicy: "pinned", contentVerbatim: true, defaultTtlDays: null },
};

/**
 * Conflict projection consumed at the reconcile boundary. Hosts map persisted
 * conflict annotations into this narrower operation-oriented shape; `memoryId`
 * names the target and `materiallyDifferent` distinguishes MERGE from NOOP.
 */
export const RECONCILE_CONFLICT_RELATIONS = [
  "supersedes",
  "contradicts",
  "duplicates",
  "coexists",
] as const;
export const reconcileConflictRelationSchema = z.enum(RECONCILE_CONFLICT_RELATIONS);
export type ReconcileConflictRelation = z.infer<typeof reconcileConflictRelationSchema>;

export const reconcileConflictAnnotationSchema = z.object({
  relation: reconcileConflictRelationSchema,
  /** The existing active memory this candidate conflicts with. */
  memoryId: z.uuid(),
  /** Detector confidence in the relation (0..1). */
  confidence: z.number().min(0).max(1),
  /**
   * For `duplicates`: whether the candidate adds material new content over the
   * neighbor. true → MERGE (fold in the new detail); false/absent → NOOP.
   */
  materiallyDifferent: z.boolean().optional(),
});
export type ReconcileConflictAnnotation = z.infer<typeof reconcileConflictAnnotationSchema>;

/** One entity edge to write into memory_entity_links on commit (from the classifier). */
export const reconcileEntityLinkSchema = z.object({
  entityId: z.uuid(),
  role: z.string().min(1).default("about"),
  confidence: z.number().min(0).max(1).optional(),
});
export type ReconcileEntityLink = z.infer<typeof reconcileEntityLinkSchema>;

/**
 * Dispositions that may reach the reconciler. Only `auto_commit` (policy-matrix
 * green-lit) and `approved` (human review approved) are committable; anything
 * else is a guard violation (a `review`/`reject` candidate must not flow here).
 */
export const RECONCILE_DISPOSITIONS = ["auto_commit", "approved", "review", "reject"] as const;
export const reconcileDispositionSchema = z.enum(RECONCILE_DISPOSITIONS);
export type ReconcileDisposition = z.infer<typeof reconcileDispositionSchema>;

/**
 * The enriched, governed candidate the reconciler commits. Carries the full v2
 * axis set (owner/audience/type/sensitivity) resolved by the classifier suite
 * plus persistence and provenance fields required by the transactional writer.
 * This commit-boundary projection is intentionally narrower than classifier
 * output and richer in host-owned identifiers.
 */
export const reconcileCandidateSchema = z.object({
  /** The persisted memory_candidates row to flip to `committed` (when present). */
  candidateId: z.uuid().optional(),
  /** v1 organization_id FK the canonical row hangs off (NOT ownership; context). */
  organizationId: z.uuid(),
  /** Acting principal, recorded as version provenance (changed_by). */
  actorUserId: z.uuid(),
  /** Append-only source event this candidate ultimately derives from. */
  sourceEventId: z.uuid().nullable().optional(),
  ownerScopeType: ownerScopeTypeSchema,
  ownerScopeId: z.uuid(),
  subjectEntityId: z.uuid().nullable().optional(),
  memoryType: memoryTypeSchema,
  /** Candidate text; canonicalized on commit unless the type is verbatim. */
  text: z.string().min(1),
  audiencePolicyId: z.uuid(),
  confidence: z.number().min(0).max(1),
  sourceAuthority: sourceAuthoritySchema,
  sensitivity: sensitivitySchema,
  disposition: reconcileDispositionSchema,
  entityLinks: z.array(reconcileEntityLinkSchema).default([]),
  /**
   * Explicit effective date parsed from the source ("starting in March"). When
   * present it sets valid_from instead of defaulting to capture time.
   */
  effectiveValidFrom: isoDatetimeSchema.optional(),
});
export type ReconcileCandidate = z.infer<typeof reconcileCandidateSchema>;

/**
 * One reconcile request: an enriched candidate + the operation to execute.
 * `targetMemoryId` is required by SUPERSEDE/UPDATE/MERGE/EXPIRE (the row acted
 * on) and unused by ADD/SPLIT/NOOP-on-new. `conflictAnnotations` carry the
 * neighborhood analysis so the reconciler can confirm the operation.
 */
export const reconcileInputSchema = z.object({
  candidate: reconcileCandidateSchema,
  operation: reconcileOperationSchema,
  targetMemoryId: z.uuid().optional(),
  conflictAnnotations: z.array(reconcileConflictAnnotationSchema).default([]),
});
export type ReconcileInput = z.infer<typeof reconcileInputSchema>;

/**
 * The outcome of one reconcile. `memoryId` is the canonical row written (null
 * for NOOP, which mints nothing). `supersededMemoryId` is set by SUPERSEDE.
 * `versionRecorded` asserts a memory_versions row was written for this mutation
 * for every mutation. `projectionsMarkedDirty` records that
 * affected projection_manifests were flagged for regeneration.
 */
export const reconcileResultSchema = z.object({
  operation: reconcileOperationSchema,
  memoryId: z.uuid().nullable(),
  supersededMemoryId: z.uuid().optional(),
  versionRecorded: z.boolean(),
  projectionsMarkedDirty: z.boolean(),
});
export type ReconcileResult = z.infer<typeof reconcileResultSchema>;

export const derivedRowPoliciesSchema = z.object({
  renderPolicy: renderPolicySchema,
  contentVerbatim: z.boolean(),
  expiresAt: z.date().nullable(),
});
export type DerivedRowPolicies = z.infer<typeof derivedRowPoliciesSchema>;

export const operationSelectionSchema = z.object({
  operation: reconcileOperationSchema,
  targetMemoryId: z.uuid().optional(),
});
export type OperationSelection = z.infer<typeof operationSelectionSchema>;

/**
 * Re-export for convenience so hosts can import the reconciler vocabulary from
 * this one subpath rather than the package barrel.
 */
export type { MemoryType, RenderPolicy };
