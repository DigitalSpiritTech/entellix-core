/**
 * Implements config behavior for this TypeScript module.
 *
 * Inputs: Imported dependencies and values passed to the module's documented functions.
 * Outputs: Exported types, values, and behavior provided by the module.
 * Errors: Functions document validation, dependency, and runtime errors individually.
 *
 * @packageDocumentation
 */

import { z } from "zod";

/**
 * Versioned retrieval tuning config (S3.1.2 DoD "adjustment config documented").
 *
 * All fusion tunables live here in ONE audited, versioned place instead of
 * scattered magic numbers, so a tuning change is a single reviewable diff with a
 * bumped `version` tag. `RETRIEVAL_CONFIG_V1` is the frozen baseline the pure
 * fusion pipeline (`fusion.ts`) reads from.
 *
 * Knobs:
 * - `version`      — non-empty tag written to the audit trail; bump on any change.
 * - `rrfK`         — Reciprocal Rank Fusion constant `k` (default 60). Higher `k`
 *                    flattens the contribution of top ranks, so lanes agree more
 *                    slowly; 60 is the standard RRF default.
 * - `boosts`       — additive post-filter weights (never a score input to fusion,
 *                    only reorder survivors):
 *     - `scopeMatch`  added when a memory's owner scope equals the request scope.
 *     - `entityMatch` added when a memory's subject entity is in the request set.
 *     - `pin`         added when `renderPolicy = 'pinned'`.
 *     - `recency`     max recency contribution; decayed per-type (see below).
 * - `recencyHalfLifeMsByType` — per memory-type recency half-life in ms; `null`
 *                    means the type gets NO recency decay (e.g. directives are
 *                    time-invariant). Fast-moving types (`task_state`) use a small
 *                    half-life; durable facts use a large one.
 * - `rerankEnabled` — the rerank hook is a stub, OFF by default. It is enabled
 *                    only if retrieval evals demand it (Decision 20: no reranker
 *                    on the normal path until fixtures justify it).
 * - `maxCosineDistance` — post-fusion bound on the semantic (vector) lane's raw
 *                    cosine DISTANCE (pgvector `<=>`, `1 - cosine_similarity`, in
 *                    `[0, 2]`). A candidate survives iff it has exact lexical/entity
 *                    support OR its vector distance is within this bound, so
 *                    clearly-unrelated nearest neighbours are trimmed while precise
 *                    FTS/entity hits are always kept. This is the discriminating
 *                    relevance gate on a small corpus (the RRF-rank floor could
 *                    not be — every memory is a nearest neighbour there). It is the
 *                    #1 live-calibration target: run `pnpm eval:retrieval`.
 * - `relevanceFloor` — post-fusion minimum FUSED RRF score a candidate must clear
 *                    to survive (S4.2.1). Applied at the same seam as the ACL /
 *                    status hard filters, so it is a FILTER on raw query relevance,
 *                    never a score input to fusion or boosting. `0` disables it.
 *                    DISABLED (`0`): the RRF-rank floor proved a structural no-op
 *                    on small corpora (every candidate cleared it) and is
 *                    superseded by `maxCosineDistance`; kept as a disabled optional
 *                    tail guard (ADR 21 supersedes the floor part of ADR 20).
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export const retrievalConfigSchema = z.object({
  version: z.string().min(1),
  rrfK: z.number().int().positive(),
  boosts: z.object({
    scopeMatch: z.number().min(0),
    entityMatch: z.number().min(0),
    pin: z.number().min(0),
    recency: z.number().min(0),
  }),
  recencyHalfLifeMsByType: z.record(z.string(), z.number().positive().nullable()),
  rerankEnabled: z.boolean(),
  maxCosineDistance: z.number().min(0),
  relevanceFloor: z.number().min(0),
});
export type RetrievalConfig = z.infer<typeof retrievalConfigSchema>;

export const RETRIEVAL_CONFIG_V1: RetrievalConfig = {
  version: "retrieval-config-v4",
  rrfK: 60,
  boosts: {
    scopeMatch: 0.1,
    entityMatch: 0.1,
    pin: 0.2,
    recency: 0.05,
  },
  recencyHalfLifeMsByType: {
    // Fast-moving working state decays quickly.
    task_state: 3 * DAY_MS,
    observation: 14 * DAY_MS,
    episodic_event: 30 * DAY_MS,
    preference: 90 * DAY_MS,
    // Durable knowledge decays slowly.
    fact: 180 * DAY_MS,
    decision: 365 * DAY_MS,
    procedure: 365 * DAY_MS,
    // Time-invariant governance: no recency decay.
    directive: null,
    policy: null,
  },
  rerankEnabled: false,
  // Post-fusion bound on the semantic (vector) lane's raw cosine distance. pgvector
  // `<=>` returns cosine distance = 1 - cosine_similarity, in [0, 2]. The expanded
  // Voyage-4 fixture calibration rejected 0.5, 0.55, and 0.58 because each lost
  // relevant recall. The expanded 14-case set passes 14/14 at 0.6, including the
  // narrow Northwind database case and its three explicit exclusions, making 0.6
  // the tightest tested recall-preserving bound. Move it only with a version bump
  // plus Voyage-backed eval evidence (ADR 23).
  maxCosineDistance: 0.6,
  // DISABLED (0). The post-fusion floor on the FUSED RRF score (S4.2.1) proved a
  // structural no-op on small corpora: the vector lane returns every memory as a
  // shallow-rank nearest neighbour, so every candidate cleared the floor and
  // nothing was trimmed. Superseded by `maxCosineDistance` (ADR 21); retained at 0
  // as a disabled optional tail guard rather than removed.
  relevanceFloor: 0,
};
