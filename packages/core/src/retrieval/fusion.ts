/**
 * Implements fusion behavior for this TypeScript module.
 *
 * Inputs: Imported dependencies and values passed to the module's documented functions.
 * Outputs: Exported types, values, and behavior provided by the module.
 * Errors: Functions document validation, dependency, and runtime errors individually.
 *
 * @packageDocumentation
 */

import type { MemoryStatus, MemoryType } from "@entellix/contracts";
import type {
  FusedCandidate,
  FusionMemory,
  RetrievalCandidate as Candidate,
  RetrievalContextEnvelope as ContextEnvelope,
} from "@entellix/contracts/retrieval";

import type { RetrievalConfig } from "./config.ts";

export type {
  RetrievalCandidate as Candidate,
  FusedCandidate,
  FusionMemory,
  RetrievalContextEnvelope as ContextEnvelope,
} from "@entellix/contracts/retrieval";

// Provider-neutral ranked candidate emitted by every retrieval adapter. `rank`
// is 1-based. Optional evidence signals let the pure relevance gate distinguish
// semantic distance, exact lexical matches, and unembedded lexical fallbacks.
// Allowed-set predicate. Returns true iff the acting principal may see the
// memory. This is a POST-fusion filter seam, never a score component — RLS is the
// real ACL boundary; this mirrors it in-process so fusion can prove it drops
// forbidden rows regardless of how high they rank.
export type MemoryAcl = (memoryId: string) => boolean;

// Optional rerank hook. OFF by default (config.rerankEnabled === false); when
// enabled it may reorder the already-filtered, already-boosted candidates.
export type RerankFn = (candidates: readonly FusedCandidate[]) => FusedCandidate[];

// Hydrated projection of a memory row: only the columns fusion needs for hard
// filters (status/temporal) and boosts (scope/entity/pin/recency).
// Statuses revealed only when the caller explicitly requests history.
const HISTORY_STATUSES = new Set<MemoryStatus>(["superseded", "expired"]);

/**
 * Reciprocal Rank Fusion. Each lane contributes `1 / (k + rank)` per candidate;
 * scores sum across lanes so a candidate surfaced by more lanes outranks a
 * single-lane one at the same rank. Ties keep first-seen order (stable).
 *
 * @param lanes - Value supplied for `lanes`.
 * @param opts - Value supplied for `opts`.
 * @returns The result produced by `rrfFuse`.
 * @throws Errors raised by validation or dependent operations.
 */
export function rrfFuse(
  lanes: readonly (readonly Candidate[])[],
  opts: { k: number },
): FusedCandidate[] {
  const scores = new Map<string, number>();
  const order: string[] = [];
  for (const lane of lanes) {
    for (const candidate of lane) {
      if (!scores.has(candidate.id)) order.push(candidate.id);
      scores.set(candidate.id, (scores.get(candidate.id) ?? 0) + 1 / (opts.k + candidate.rank));
    }
  }
  return order.map((id) => ({ id, score: scores.get(id)! })).toSorted((a, b) => b.score - a.score);
}

/**
 * Executes status allowed.
 *
 * @param status - Value supplied for `status`.
 * @param includeHistory - Value supplied for `includeHistory`.
 * @returns The result produced by `statusAllowed`.
 * @throws Errors raised by validation or dependent operations.
 */
function statusAllowed(status: MemoryStatus, includeHistory: boolean): boolean {
  if (status === "active") return true;
  return includeHistory && HISTORY_STATUSES.has(status);
}

/**
 * POST-fusion, PRE-boost hard filters. Drops any candidate that:
 *  - has no hydrated memory row,
 *  - the ACL forbids (always enforced),
 *  - is not `active` (unless `includeHistory`, which also reveals superseded +
 *    expired — never removed/rejected/pending_review),
 *  - has `validTo <= now` (unless `includeHistory`),
 *  - has `validFrom > now` (never surfaced, even with history).
 * Survivors keep their incoming (fused) order.
 *
 * @param input - Value supplied for `input`.
 * @returns The result produced by `applyHardFilters`.
 * @throws Errors raised by validation or dependent operations.
 */
export function applyHardFilters(input: {
  candidates: readonly FusedCandidate[];
  memories: readonly FusionMemory[];
  acl: MemoryAcl;
  now: Date;
  includeHistory?: boolean;
}): FusedCandidate[] {
  const { candidates, memories, acl, now } = input;
  const includeHistory = input.includeHistory ?? false;
  const byId = new Map(memories.map((memory) => [memory.id, memory]));
  const nowMs = now.getTime();

  return candidates.filter((candidate) => {
    const memory = byId.get(candidate.id);
    if (!memory) return false;
    if (!acl(candidate.id)) return false;
    if (!statusAllowed(memory.status, includeHistory)) return false;
    if (memory.validFrom !== null && memory.validFrom.getTime() > nowMs) return false;
    if (!includeHistory && memory.validTo !== null && memory.validTo.getTime() <= nowMs)
      return false;
    return true;
  });
}

/**
 * POST-fusion, PRE-boost relevance floor. Drops any candidate whose FUSED score
 * is strictly below `floor`, gating raw query relevance so off-topic noise is
 * never surfaced even when the limit is under-filled. Like applyHardFilters it is
 * a FILTER: it never mutates scores and preserves the incoming order. A floor of
 * `0` (or negative) is a no-op passthrough. Always-on pinned/directive governance
 * is NOT rescued here — it is handled separately by the packet composer, not by
 * surviving this floor.
 *
 * @param input - Value supplied for `input`.
 * @returns The result produced by `applyRelevanceFloor`.
 * @throws Errors raised by validation or dependent operations.
 */
export function applyRelevanceFloor(input: {
  candidates: readonly FusedCandidate[];
  floor: number;
}): FusedCandidate[] {
  const { candidates, floor } = input;
  return floor <= 0 ? [...candidates] : candidates.filter((c) => c.score >= floor);
}

/**
 * POST-fusion, PRE-boost semantic-distance gate. Bounds RAW query relevance by the
 * vector lane's cosine distance so clearly-unrelated nearest neighbours are trimmed
 * on a small corpus (where the RRF-rank floor can't discriminate — the vector lane
 * returns every memory as a neighbour). A candidate survives iff it has exact
 * lexical/entity support OR its vector cosine distance is within `maxCosineDistance`
 * (a missing distance counts as +∞, so a candidate with neither support nor a
 * distance is dropped). Like applyHardFilters it is a FILTER: it never mutates
 * scores and preserves the incoming order. Always-on
 * pinned/directive governance is NOT rescued here — the packet composer owns that.
 *
 * @param input - Value supplied for `input`.
 * @returns The result produced by `applySemanticDistanceGate`.
 * @throws Errors raised by validation or dependent operations.
 */
export function applySemanticDistanceGate(input: {
  candidates: readonly FusedCandidate[];
  vectorDistanceById: ReadonlyMap<string, number>;
  lexicalOrEntityIds: ReadonlySet<string>;
  maxCosineDistance: number;
}): FusedCandidate[] {
  const { candidates, vectorDistanceById, lexicalOrEntityIds, maxCosineDistance } = input;
  return candidates.filter(
    (c) =>
      lexicalOrEntityIds.has(c.id) ||
      (vectorDistanceById.get(c.id) ?? Number.POSITIVE_INFINITY) <= maxCosineDistance,
  );
}

/**
 * Per-type recency contribution: `recency * 0.5^(ageMs / halfLife)`. A `null`
 * half-life (or unknown/null type) yields no recency boost, so time-invariant
 * types (directives) are unaffected by age.
 *
 * @param input - Value supplied for `input`.
 * @returns The result produced by `recencyBoost`.
 * @throws Errors raised by validation or dependent operations.
 */
export function recencyBoost(input: {
  memoryType: MemoryType | null;
  ageMs: number;
  config: RetrievalConfig;
}): number {
  const { memoryType, ageMs, config } = input;
  if (memoryType === null) return 0;
  const halfLife = config.recencyHalfLifeMsByType[memoryType];
  if (halfLife === null || halfLife === undefined) return 0;
  return config.boosts.recency * Math.pow(0.5, ageMs / halfLife);
}

/**
 * Executes scope matches.
 *
 * @param memory - Value supplied for `memory`.
 * @param envelope - Value supplied for `envelope`.
 * @returns The result produced by `scopeMatches`.
 * @throws Errors raised by validation or dependent operations.
 */
function scopeMatches(memory: FusionMemory, envelope: ContextEnvelope): boolean {
  return (
    envelope.ownerScopeType !== undefined &&
    envelope.ownerScopeId !== undefined &&
    memory.ownerScopeType === envelope.ownerScopeType &&
    memory.ownerScopeId === envelope.ownerScopeId
  );
}

/**
 * Executes entity matches.
 *
 * @param memory - Value supplied for `memory`.
 * @param envelope - Value supplied for `envelope`.
 * @returns The result produced by `entityMatches`.
 * @throws Errors raised by validation or dependent operations.
 */
function entityMatches(memory: FusionMemory, envelope: ContextEnvelope): boolean {
  return (
    memory.subjectEntityId !== null &&
    (envelope.entityIds?.includes(memory.subjectEntityId) ?? false)
  );
}

/**
 * Executes boost for.
 *
 * @param memory - Value supplied for `memory`.
 * @param envelope - Value supplied for `envelope`.
 * @param config - Value supplied for `config`.
 * @param now - Value supplied for `now`.
 * @returns The result produced by `boostFor`.
 * @throws Errors raised by validation or dependent operations.
 */
function boostFor(
  memory: FusionMemory,
  envelope: ContextEnvelope,
  config: RetrievalConfig,
  now: Date,
): number {
  let boost = 0;
  if (scopeMatches(memory, envelope)) boost += config.boosts.scopeMatch;
  if (entityMatches(memory, envelope)) boost += config.boosts.entityMatch;
  if (memory.renderPolicy === "pinned") boost += config.boosts.pin;
  boost += recencyBoost({
    memoryType: memory.memoryType,
    ageMs: now.getTime() - memory.updatedAt.getTime(),
    config,
  });
  return boost;
}

/**
 * Additive boost stage applied AFTER filtering: scope/entity/pin/recency only
 * REORDER the survivors (stable on ties). A boost can never resurrect a
 * filtered-out row because it only ever sees the post-filter candidate set.
 *
 * @param input - Value supplied for `input`.
 * @returns The result produced by `applyBoosts`.
 * @throws Errors raised by validation or dependent operations.
 */
export function applyBoosts(input: {
  candidates: readonly FusedCandidate[];
  memories: readonly FusionMemory[];
  envelope: ContextEnvelope;
  config: RetrievalConfig;
  now: Date;
}): FusedCandidate[] {
  const { candidates, memories, envelope, config, now } = input;
  const byId = new Map(memories.map((memory) => [memory.id, memory]));

  return candidates
    .map((candidate) => {
      const memory = byId.get(candidate.id);
      const boost = memory ? boostFor(memory, envelope, config, now) : 0;
      return { id: candidate.id, score: candidate.score + boost };
    })
    .toSorted((a, b) => b.score - a.score);
}

/**
 * Rerank hook seam. Identity unless `config.rerankEnabled` is explicitly true AND
 * a `rerank` fn is supplied. When disabled it MUST NOT invoke `rerank` (no
 * reranker on the normal path — Decision 20).
 *
 * @param input - Value supplied for `input`.
 * @returns The result produced by `maybeRerank`.
 * @throws Errors raised by validation or dependent operations.
 */
export function maybeRerank(input: {
  candidates: readonly FusedCandidate[];
  config: RetrievalConfig;
  rerank?: RerankFn;
}): FusedCandidate[] {
  const { candidates, config, rerank } = input;
  if (!config.rerankEnabled || rerank === undefined) return [...candidates];
  return rerank(candidates);
}

/**
 * Full pure pipeline: rrfFuse → applyHardFilters → applySemanticDistanceGate →
 * applyRelevanceFloor → applyBoosts → maybeRerank → truncate to `limit`.
 * Deterministic given injected `now`. The gate and the (disabled) floor both run
 * PRE-boost so a scope/entity/pin/recency boost can never resurrect a candidate
 * dropped for low raw relevance. The gate derives its inputs from the lane
 * convention `lanes[0]` = semantic (carries `distance`), `lanes[1]` = lexical,
 * `lanes[2]` = entity.
 *
 * @param input - Value supplied for `input`.
 * @returns The result produced by `fuseAndRank`.
 * @throws Errors raised by validation or dependent operations.
 */
export function fuseAndRank(input: {
  lanes: readonly (readonly Candidate[])[];
  memories: readonly FusionMemory[];
  envelope: ContextEnvelope;
  acl: MemoryAcl;
  config: RetrievalConfig;
  now: Date;
  includeHistory?: boolean;
  limit: number;
  rerank?: RerankFn;
}): FusedCandidate[] {
  const { lanes, memories, envelope, acl, config, now, includeHistory, limit, rerank } = input;
  const fused = rrfFuse(lanes, { k: config.rrfK });
  const filtered = applyHardFilters({ candidates: fused, memories, acl, now, includeHistory });
  // Semantic lane (lanes[0]) carries cosine distance per candidate. Once a
  // candidate has a distance, that signal is authoritative unless the lexical
  // lane marks a high-signal exact phrase/identifier match or the entity lane
  // resolves it. Broad FTS support remains a valid fallback only for unembedded
  // candidates whose lexical metadata explicitly proves that no current
  // embedding exists. Unknown embedding presence fails closed. A semantic-lane
  // candidate WITHOUT a distance is not a vector-origin candidate (only the
  // vector lane sets distance), so it is treated as non-gateable rather than
  // dropped — the gate bounds vector relevance only.
  const vectorDistanceById = new Map<string, number>();
  const lexicalOrEntityIds = new Set<string>();
  for (const candidate of lanes[0] ?? []) {
    if (candidate.distance !== undefined) vectorDistanceById.set(candidate.id, candidate.distance);
    else lexicalOrEntityIds.add(candidate.id);
  }
  for (const candidate of lanes[1] ?? []) {
    if (candidate.exactMatch === true || candidate.hasEmbedding === false) {
      lexicalOrEntityIds.add(candidate.id);
    }
  }
  for (const candidate of lanes[2] ?? []) lexicalOrEntityIds.add(candidate.id);
  const gated = applySemanticDistanceGate({
    candidates: filtered,
    vectorDistanceById,
    lexicalOrEntityIds,
    maxCosineDistance: config.maxCosineDistance,
  });
  const floored = applyRelevanceFloor({ candidates: gated, floor: config.relevanceFloor });
  const boosted = applyBoosts({ candidates: floored, memories, envelope, config, now });
  const reranked = maybeRerank({ candidates: boosted, config, rerank });
  return reranked.slice(0, limit);
}
