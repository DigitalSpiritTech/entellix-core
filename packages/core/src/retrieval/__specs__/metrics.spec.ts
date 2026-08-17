import { describe, expect, it } from "vitest";

// RED (S3.1.1 DoD "per-lane hit-contribution metric emitted"): the metrics
// module does not exist yet. This pins the PURE aggregator that maps the fused
// (finally returned) memory ids + each lane's candidate ids to per-lane
// contribution counts, so the emitted metric is provable without Postgres.
// Import fails until `@entellix/core/retrieval/metrics` exports
// `laneHitContributions`.
import { laneHitContributions } from "../metrics.ts";

/**
 * Contract under test:
 *
 *   laneHitContributions(input: {
 *     fusedIds: readonly string[]
 *     lanes: readonly { lane: string; candidateIds: readonly string[] }[]
 *   }): { lane: string; hitCount: number }[]
 *
 * For each lane (in input order) `hitCount` is how many of the FINAL fused ids
 * that lane surfaced as a candidate. A fused id present in several lanes counts
 * once for each. Candidate ids that never made it into `fusedIds` do not count.
 */
describe("laneHitContributions", () => {
  it("counts, per lane, how many fused ids that lane surfaced", () => {
    const result = laneHitContributions({
      fusedIds: ["m1", "m2", "m3"],
      lanes: [
        { lane: "vector", candidateIds: ["m1", "m9"] },
        { lane: "fts", candidateIds: ["m2", "m3"] },
        { lane: "entity", candidateIds: ["m3"] },
      ],
    });
    expect(result).toEqual([
      { lane: "vector", hitCount: 1 },
      { lane: "fts", hitCount: 2 },
      { lane: "entity", hitCount: 1 },
    ]);
  });

  it("preserves lane input order", () => {
    const result = laneHitContributions({
      fusedIds: ["m1"],
      lanes: [
        { lane: "entity", candidateIds: ["m1"] },
        { lane: "vector", candidateIds: ["m1"] },
        { lane: "fts", candidateIds: [] },
      ],
    });
    expect(result.map((r) => r.lane)).toEqual(["entity", "vector", "fts"]);
  });

  it("attributes a fused id to every lane that surfaced it", () => {
    const result = laneHitContributions({
      fusedIds: ["shared"],
      lanes: [
        { lane: "vector", candidateIds: ["shared"] },
        { lane: "fts", candidateIds: ["shared"] },
      ],
    });
    expect(result).toEqual([
      { lane: "vector", hitCount: 1 },
      { lane: "fts", hitCount: 1 },
    ]);
  });

  it("does not count candidates that never entered the fused set", () => {
    const result = laneHitContributions({
      fusedIds: ["m1"],
      lanes: [{ lane: "fts", candidateIds: ["m1", "noise-a", "noise-b"] }],
    });
    expect(result).toEqual([{ lane: "fts", hitCount: 1 }]);
  });

  it("reports zero for every lane when nothing was returned", () => {
    const result = laneHitContributions({
      fusedIds: [],
      lanes: [
        { lane: "vector", candidateIds: ["m1"] },
        { lane: "fts", candidateIds: ["m2"] },
      ],
    });
    expect(result).toEqual([
      { lane: "vector", hitCount: 0 },
      { lane: "fts", hitCount: 0 },
    ]);
  });

  it("reports zero for a lane that contributed none of the fused ids", () => {
    const result = laneHitContributions({
      fusedIds: ["m1", "m2"],
      lanes: [
        { lane: "vector", candidateIds: ["m1", "m2"] },
        { lane: "entity", candidateIds: ["m9"] },
      ],
    });
    expect(result).toEqual([
      { lane: "vector", hitCount: 2 },
      { lane: "entity", hitCount: 0 },
    ]);
  });
});
