// Pure merge-gate helper for the S4.2.3 distractor-exclusion contract.
//
// The retrieval eval harness needs a
// Postgres-free, deterministic way to decide whether a single retrieval result
// honours the relevance-gated merge: relevant recall must survive, off-topic
// distractors gated out by the semantic-distance gate must be gone entirely, and
// always-on pinned/directive governance rows must surface. This function is that decision
// as a plain function so the contract is provable in a unit spec without a DB,
// VOYAGE_API_KEY, or the live eval.
//
// Ranks are 1-based: the id at `returnedIds[i]` has rank `i + 1`. "Within
// maxRank" means `rank <= maxRank`. There is deliberately NO rank window on
// exclusion — a leaked distractor at any rank fails the gate, because a
// gated-out memory should never appear at all.

/**
 * Evaluate one retrieval result against the three merge-gate guards.
 *
 * @param input.returnedIds  Retrieved ids in retrieval-rank order (rank = index + 1).
 * @param input.expectedIds  Ids that must appear within `maxRank` (recall guard).
 * @param input.excludedIds  Off-topic distractor ids that must not appear at ANY
 *                           rank (floor guard).
 * @param input.governanceIds Pinned/directive ids that must surface within
 *                           `maxRank` regardless of query similarity (always-on
 *                           guard). Omitted or empty means no governance
 *                           requirement.
 * @param input.maxRank      1-based inclusive rank window for the recall and
 *                           governance guards. Defaults to 5.
 * @returns The ids that failed each guard (each in its input array's order) and
 *          `passed`, the AND of all three arrays being empty.
 */
export function evaluateExclusionCase(input: {
  returnedIds: readonly string[];
  expectedIds: readonly string[];
  excludedIds: readonly string[];
  governanceIds?: readonly string[];
  maxRank?: number;
}): {
  missingExpected: string[];
  leakedExcluded: string[];
  missingGovernance: string[];
  passed: boolean;
} {
  const maxRank = input.maxRank ?? 5;

  // 1-based rank of an id, or 0 when it is absent from the result set.
  const rankOf = (id: string): number => input.returnedIds.indexOf(id) + 1;

  // Present within the inclusive rank window (recall + governance guards).
  const withinRank = (id: string): boolean => {
    const rank = rankOf(id);
    return rank > 0 && rank <= maxRank;
  };

  // Recall guard: expected ids absent OR beyond maxRank, in input order.
  const missingExpected = input.expectedIds.filter((id) => !withinRank(id));

  // Floor guard: excluded ids present at ANY rank (no window), in input order.
  const leakedExcluded = input.excludedIds.filter((id) => rankOf(id) > 0);

  // Always-on guard: governance ids absent OR beyond maxRank, in input order.
  const missingGovernance = (input.governanceIds ?? []).filter((id) => !withinRank(id));

  const passed =
    missingExpected.length === 0 && leakedExcluded.length === 0 && missingGovernance.length === 0;

  return { missingExpected, leakedExcluded, missingGovernance, passed };
}
