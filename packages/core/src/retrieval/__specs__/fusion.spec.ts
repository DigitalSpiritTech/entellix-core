import type { MemoryStatus, MemoryType, RenderPolicy } from "@entellix/contracts";
import { describe, expect, it, vi } from "vitest";

import { RETRIEVAL_CONFIG_V1 } from "../config.ts";
// RED (S3.1.2): the pure fusion pipeline does not exist yet. These specs pin the
// Postgres-free contract the developer must land in
// `@entellix/core/retrieval/fusion`: RRF fusion (k from config), the
// POST-fusion / PRE-boost hard filters (ACL — never a score input — plus
// temporal validity and status), the boost stage (scope/entity/pin/per-type
// recency decay), and the OFF-by-default rerank hook. Everything is a pure
// function over data with `now` injected, so behavior is provable without a DB.
import type {
  Candidate,
  ContextEnvelope,
  FusedCandidate,
  FusionMemory,
  MemoryAcl,
  RerankFn,
} from "../fusion.ts";
import {
  applyBoosts,
  applyHardFilters,
  applyRelevanceFloor,
  applySemanticDistanceGate,
  fuseAndRank,
  maybeRerank,
  recencyBoost,
  rrfFuse,
} from "../fusion.ts";

/**
 * Pure interface pinned by these specs (fusion.ts):
 *
 *   interface FusedCandidate { id: string; score: number }
 *   interface Candidate { id: string; rank: number }   // == lane candidate shape
 *   type MemoryAcl = (memoryId: string) => boolean       // allowed-set predicate
 *   type RerankFn = (candidates: readonly FusedCandidate[]) => FusedCandidate[]
 *
 *   interface FusionMemory {                             // hydrated projection
 *     id, status, memoryType|null, renderPolicy|null,
 *     ownerScopeType|null, ownerScopeId|null, subjectEntityId|null,
 *     validFrom: Date|null, validTo: Date|null, updatedAt: Date
 *   }
 *   interface ContextEnvelope {                          // current-work context
 *     ownerScopeType?, ownerScopeId?, entityIds?: readonly string[]
 *   }
 *
 *   rrfFuse(lanes: readonly (readonly Candidate[])[], opts: { k: number }): FusedCandidate[]
 *   applyHardFilters(input: { candidates, memories, acl, now, includeHistory? }): FusedCandidate[]
 *   recencyBoost(input: { memoryType, ageMs, config }): number
 *   applyBoosts(input: { candidates, memories, envelope, config, now }): FusedCandidate[]
 *   maybeRerank(input: { candidates, config, rerank? }): FusedCandidate[]
 *   fuseAndRank(input: {
 *     lanes, memories, envelope, acl, config, now, includeHistory?, limit, rerank?
 *   }): FusedCandidate[]
 */

const NOW = new Date("2026-07-07T00:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * DAY);
}

function daysAhead(days: number): Date {
  return new Date(NOW.getTime() + days * DAY);
}

// Active, currently-valid, unboosted memory. Override per test.
function mem(id: string, overrides: Partial<FusionMemory> = {}): FusionMemory {
  return {
    id,
    status: "active" as MemoryStatus,
    memoryType: "fact" as MemoryType,
    renderPolicy: "retrieval" as RenderPolicy,
    ownerScopeType: null,
    ownerScopeId: null,
    subjectEntityId: null,
    validFrom: daysAgo(30),
    validTo: null,
    updatedAt: daysAgo(1),
    ...overrides,
  };
}

const allow: MemoryAcl = () => true;
const denyB: MemoryAcl = (id) => id !== "b";
const ids = (candidates: readonly FusedCandidate[]): string[] => candidates.map((c) => c.id);

// Deterministic PRNG (mulberry32) so adversarial ACL fixtures are reproducible
// and contain no wall-clock / Math.random nondeterminism.
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("rrfFuse (RRF, k from config, default 60)", () => {
  it("fuses multiple lanes so a candidate surfaced by more lanes outranks a single-lane one at the same rank", () => {
    const laneA: Candidate[] = [
      { id: "shared", rank: 1 },
      { id: "onlyA", rank: 2 },
    ];
    const laneB: Candidate[] = [
      { id: "shared", rank: 1 },
      { id: "onlyB", rank: 2 },
    ];
    const fused = rrfFuse([laneA, laneB], { k: 60 });
    expect(ids(fused)[0]).toBe("shared");
    // shared appears in both lanes -> strictly higher fused score than the
    // single-lane candidates.
    const score = new Map(fused.map((c) => [c.id, c.score]));
    expect(score.get("shared")!).toBeGreaterThan(score.get("onlyA")!);
    expect(score.get("shared")!).toBeGreaterThan(score.get("onlyB")!);
  });

  it("uses k=60: a lone rank-1 candidate scores 1/(60+1)", () => {
    const fused = rrfFuse([[{ id: "x", rank: 1 }]], { k: 60 });
    expect(fused).toHaveLength(1);
    expect(fused[0]!.id).toBe("x");
    expect(fused[0]!.score).toBeCloseTo(1 / 61, 10);
  });

  it("respects k from config for the whole pipeline default", () => {
    expect(RETRIEVAL_CONFIG_V1.rrfK).toBe(60);
  });

  it("returns a single lane in its own rank order", () => {
    const fused = rrfFuse(
      [
        [
          { id: "a", rank: 1 },
          { id: "b", rank: 2 },
          { id: "c", rank: 3 },
        ],
      ],
      { k: 60 },
    );
    expect(ids(fused)).toEqual(["a", "b", "c"]);
  });

  it("is stable on ties (equal fused score keeps first-seen order)", () => {
    // x and y each appear once at rank 1 -> identical score; x is seen first.
    const fused = rrfFuse([[{ id: "x", rank: 1 }], [{ id: "y", rank: 1 }]], { k: 60 });
    expect(ids(fused)).toEqual(["x", "y"]);
  });

  it("handles empty input and all-empty lanes", () => {
    expect(rrfFuse([], { k: 60 })).toEqual([]);
    expect(rrfFuse([[], []], { k: 60 })).toEqual([]);
  });
});

describe("applyHardFilters (POST-fusion, PRE-boost)", () => {
  const fused: FusedCandidate[] = [
    { id: "a", score: 0.5 },
    { id: "b", score: 0.4 },
  ];

  it("drops candidates with no hydrated memory row", () => {
    const out = applyHardFilters({
      candidates: fused,
      memories: [mem("a")],
      acl: allow,
      now: NOW,
    });
    expect(ids(out)).toEqual(["a"]);
  });

  it("drops candidates the ACL forbids and keeps allowed ones", () => {
    const out = applyHardFilters({
      candidates: fused,
      memories: [mem("a"), mem("b")],
      acl: denyB,
      now: NOW,
    });
    expect(ids(out)).toEqual(["a"]);
  });

  it("keeps only active status by default", () => {
    const out = applyHardFilters({
      candidates: [
        { id: "active", score: 0.5 },
        { id: "removed", score: 0.4 },
        { id: "superseded", score: 0.3 },
        { id: "expired", score: 0.2 },
      ],
      memories: [
        mem("active", { status: "active" }),
        mem("removed", { status: "removed" }),
        mem("superseded", { status: "superseded" }),
        mem("expired", { status: "expired" }),
      ],
      acl: allow,
      now: NOW,
    });
    expect(ids(out)).toEqual(["active"]);
  });

  it("includes superseded and expired rows when includeHistory is set", () => {
    const out = applyHardFilters({
      candidates: [
        { id: "active", score: 0.5 },
        { id: "superseded", score: 0.4 },
        { id: "expired", score: 0.3 },
        { id: "rejected", score: 0.2 },
        { id: "pending", score: 0.1 },
      ],
      memories: [
        mem("active", { status: "active" }),
        mem("superseded", { status: "superseded" }),
        mem("expired", { status: "expired" }),
        mem("rejected", { status: "rejected" }),
        mem("pending", { status: "pending_review" }),
      ],
      acl: allow,
      now: NOW,
      includeHistory: true,
    });
    // history reveals superseded/expired but NOT rejected/pending_review.
    expect(ids(out).toSorted()).toEqual(["active", "expired", "superseded"]);
  });

  it("excludes a memory whose valid_to is in the past by default", () => {
    const out = applyHardFilters({
      candidates: [{ id: "expired-window", score: 0.5 }],
      memories: [mem("expired-window", { validTo: daysAgo(1) })],
      acl: allow,
      now: NOW,
    });
    expect(ids(out)).toEqual([]);
  });

  it("retrieves a past-valid_to memory when includeHistory is set", () => {
    const out = applyHardFilters({
      candidates: [{ id: "expired-window", score: 0.5 }],
      memories: [mem("expired-window", { validTo: daysAgo(1) })],
      acl: allow,
      now: NOW,
      includeHistory: true,
    });
    expect(ids(out)).toEqual(["expired-window"]);
  });

  it("excludes a memory whose valid_from is in the future, even with includeHistory", () => {
    const memories = [mem("not-yet", { validFrom: daysAhead(1) })];
    const candidates: FusedCandidate[] = [{ id: "not-yet", score: 0.5 }];
    expect(ids(applyHardFilters({ candidates, memories, acl: allow, now: NOW }))).toEqual([]);
    expect(
      ids(applyHardFilters({ candidates, memories, acl: allow, now: NOW, includeHistory: true })),
    ).toEqual([]);
  });

  it("preserves the incoming (fused) order among survivors", () => {
    const out = applyHardFilters({
      candidates: [
        { id: "a", score: 0.9 },
        { id: "b", score: 0.8 },
        { id: "c", score: 0.7 },
      ],
      memories: [mem("a"), mem("b"), mem("c")],
      acl: allow,
      now: NOW,
    });
    expect(ids(out)).toEqual(["a", "b", "c"]);
  });
});

describe("ACL is a hard filter, never a score input (adversarial property test)", () => {
  it("never returns a forbidden memory even when it ranks #1 in every lane and is maximally boosted", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const rand = mulberry32(seed);
      const forbiddenId = "FORBIDDEN";
      const allowedCount = 3 + Math.floor(rand() * 6);
      const allowedIds = Array.from({ length: allowedCount }, (_, i) => `ok-${seed}-${i}`);

      // The forbidden memory wins every lane at rank 1; allowed memories trail
      // at random deeper ranks. If ACL were a score component (or applied after
      // boosts) the forbidden id would dominate the output.
      const laneCount = 2 + Math.floor(rand() * 3);
      const lanes: Candidate[][] = Array.from({ length: laneCount }, () => {
        const shuffled = allowedIds.toSorted(() => rand() - 0.5);
        return [{ id: forbiddenId, rank: 1 }, ...shuffled.map((id, i) => ({ id, rank: i + 2 }))];
      });

      const envelope: ContextEnvelope = {
        ownerScopeType: "org",
        ownerScopeId: "org-1",
        entityIds: ["ent-1"],
      };
      // Forbidden row is active, in-window, AND matches every boost — only ACL
      // can keep it out.
      const memories: FusionMemory[] = [
        mem(forbiddenId, {
          ownerScopeType: "org",
          ownerScopeId: "org-1",
          subjectEntityId: "ent-1",
          renderPolicy: "pinned",
          memoryType: "task_state",
          updatedAt: NOW,
        }),
        ...allowedIds.map((id) => mem(id)),
      ];

      const acl: MemoryAcl = (id) => id !== forbiddenId;

      const out = fuseAndRank({
        lanes,
        memories,
        envelope,
        acl,
        config: RETRIEVAL_CONFIG_V1,
        now: NOW,
        limit: 50,
      });

      expect(ids(out)).not.toContain(forbiddenId);
    }
  });

  it("never returns any member of a randomized forbidden set", () => {
    for (let seed = 100; seed <= 130; seed++) {
      const rand = mulberry32(seed);
      const universe = Array.from({ length: 12 }, (_, i) => `m-${i}`);
      const forbidden = new Set(universe.filter(() => rand() < 0.5));
      // Forbidden ids are front-loaded (best ranks) in every lane.
      const ranked = universe.toSorted((a, b) => {
        const af = forbidden.has(a) ? 0 : 1;
        const bf = forbidden.has(b) ? 0 : 1;
        return af - bf;
      });
      const lanes: Candidate[][] = [
        ranked.map((id, i) => ({ id, rank: i + 1 })),
        ranked.toReversed().map((id, i) => ({ id, rank: i + 1 })),
      ];
      const memories = universe.map((id) => mem(id, { updatedAt: NOW }));
      const acl: MemoryAcl = (id) => !forbidden.has(id);

      const out = fuseAndRank({
        lanes,
        memories,
        envelope: {},
        acl,
        config: RETRIEVAL_CONFIG_V1,
        now: NOW,
        limit: 50,
      });

      for (const id of out.map((c) => c.id)) {
        expect(forbidden.has(id)).toBe(false);
      }
    }
  });
});

describe("recencyBoost (per-type decay with injected age)", () => {
  const config = RETRIEVAL_CONFIG_V1;

  it("gives directives no recency boost at any age", () => {
    expect(recencyBoost({ memoryType: "directive", ageMs: 0, config })).toBe(0);
    expect(recencyBoost({ memoryType: "directive", ageMs: 1000 * DAY, config })).toBe(0);
  });

  it("gives a null/unknown memory type no recency boost", () => {
    expect(recencyBoost({ memoryType: null, ageMs: 0, config })).toBe(0);
  });

  it("is positive and strictly decreasing in age for a decaying type", () => {
    const half = config.recencyHalfLifeMsByType.task_state as number;
    const fresh = recencyBoost({ memoryType: "task_state", ageMs: 0, config });
    const older = recencyBoost({ memoryType: "task_state", ageMs: half, config });
    const oldest = recencyBoost({ memoryType: "task_state", ageMs: 2 * half, config });
    expect(fresh).toBeGreaterThan(0);
    expect(older).toBeLessThan(fresh);
    expect(oldest).toBeLessThan(older);
    expect(oldest).toBeGreaterThan(0);
  });

  it("decays task_state faster than fact at a common age (half-life ordering)", () => {
    const t = config.recencyHalfLifeMsByType.task_state as number;
    const taskFraction =
      recencyBoost({ memoryType: "task_state", ageMs: t, config }) /
      recencyBoost({ memoryType: "task_state", ageMs: 0, config });
    const factFraction =
      recencyBoost({ memoryType: "fact", ageMs: t, config }) /
      recencyBoost({ memoryType: "fact", ageMs: 0, config });
    expect(taskFraction).toBeLessThan(factFraction);
  });
});

describe("applyBoosts (reorders survivors after filtering)", () => {
  const config = RETRIEVAL_CONFIG_V1;
  const equalBase: FusedCandidate[] = [
    { id: "plain", score: 1 },
    { id: "boosted", score: 1 },
  ];

  it("raises a scope match to the envelope above a non-match", () => {
    const out = applyBoosts({
      candidates: equalBase,
      memories: [
        mem("plain", { ownerScopeType: null, ownerScopeId: null, updatedAt: daysAgo(1) }),
        mem("boosted", { ownerScopeType: "org", ownerScopeId: "org-1", updatedAt: daysAgo(1) }),
      ],
      envelope: { ownerScopeType: "org", ownerScopeId: "org-1" },
      config,
      now: NOW,
    });
    expect(ids(out)[0]).toBe("boosted");
  });

  it("raises an entity match to the envelope above a non-match", () => {
    const out = applyBoosts({
      candidates: equalBase,
      memories: [
        mem("plain", { subjectEntityId: null, updatedAt: daysAgo(1) }),
        mem("boosted", { subjectEntityId: "ent-1", updatedAt: daysAgo(1) }),
      ],
      envelope: { entityIds: ["ent-1"] },
      config,
      now: NOW,
    });
    expect(ids(out)[0]).toBe("boosted");
  });

  it("raises a pinned memory (renderPolicy = pinned) above a non-pinned one", () => {
    const out = applyBoosts({
      candidates: equalBase,
      memories: [
        mem("plain", { renderPolicy: "retrieval", updatedAt: daysAgo(1) }),
        mem("boosted", { renderPolicy: "pinned", updatedAt: daysAgo(1) }),
      ],
      envelope: {},
      config,
      now: NOW,
    });
    expect(ids(out)[0]).toBe("boosted");
  });

  it("ranks a newer task_state above an older one at equal base score", () => {
    const out = applyBoosts({
      candidates: [
        { id: "old", score: 1 },
        { id: "new", score: 1 },
      ],
      memories: [
        mem("old", { memoryType: "task_state", updatedAt: daysAgo(20) }),
        mem("new", { memoryType: "task_state", updatedAt: daysAgo(1) }),
      ],
      envelope: {},
      config,
      now: NOW,
    });
    expect(ids(out)).toEqual(["new", "old"]);
  });
});

describe("boosts apply AFTER filters and can only reorder survivors", () => {
  it("never resurrects a filtered-out memory no matter how boostable it is", () => {
    // "ghost" would win every boost (pinned + scope + entity + freshest) but is
    // removed -> the hard filter drops it before boosting can see it.
    const out = fuseAndRank({
      lanes: [
        [
          { id: "ghost", rank: 1 },
          { id: "real", rank: 2 },
        ],
      ],
      memories: [
        mem("ghost", {
          status: "removed",
          renderPolicy: "pinned",
          ownerScopeType: "org",
          ownerScopeId: "org-1",
          subjectEntityId: "ent-1",
          memoryType: "task_state",
          updatedAt: NOW,
        }),
        mem("real"),
      ],
      envelope: { ownerScopeType: "org", ownerScopeId: "org-1", entityIds: ["ent-1"] },
      acl: allow,
      config: RETRIEVAL_CONFIG_V1,
      now: NOW,
      limit: 10,
    });
    expect(ids(out)).toEqual(["real"]);
  });
});

describe("maybeRerank (hook stubbed OFF by default)", () => {
  const candidates: FusedCandidate[] = [
    { id: "a", score: 0.9 },
    { id: "b", score: 0.8 },
  ];

  it("returns the pre-rerank order unchanged when rerankEnabled is false", () => {
    const out = maybeRerank({ candidates, config: RETRIEVAL_CONFIG_V1 });
    expect(out).toEqual(candidates);
  });

  it("does not invoke the rerank fn when disabled", () => {
    const rerank = vi.fn<RerankFn>((c) => c.toReversed());
    const out = maybeRerank({ candidates, config: RETRIEVAL_CONFIG_V1, rerank });
    expect(rerank).not.toHaveBeenCalled();
    expect(ids(out)).toEqual(["a", "b"]);
  });

  it("applies the rerank fn only when the config explicitly enables it", () => {
    const rerank = vi.fn<RerankFn>((c) => c.toReversed());
    const out = maybeRerank({
      candidates,
      config: { ...RETRIEVAL_CONFIG_V1, rerankEnabled: true },
      rerank,
    });
    expect(rerank).toHaveBeenCalledTimes(1);
    expect(ids(out)).toEqual(["b", "a"]);
  });
});

describe("fuseAndRank (full pure pipeline)", () => {
  it("fuses, filters, boosts and truncates to the limit", () => {
    const lanes: Candidate[][] = [
      [
        { id: "a", rank: 1 },
        { id: "b", rank: 2 },
        { id: "gone", rank: 3 },
      ],
      [
        { id: "b", rank: 1 },
        { id: "c", rank: 2 },
      ],
    ];
    const out = fuseAndRank({
      lanes,
      memories: [mem("a"), mem("b"), mem("c"), mem("gone", { status: "superseded" })],
      envelope: {},
      acl: allow,
      config: RETRIEVAL_CONFIG_V1,
      now: NOW,
      limit: 2,
    });
    expect(out).toHaveLength(2);
    expect(ids(out)).not.toContain("gone");
  });

  it("does not invoke the rerank hook by default (rerank stays identity)", () => {
    const rerank = vi.fn<RerankFn>((c) => c.toReversed());
    fuseAndRank({
      lanes: [[{ id: "a", rank: 1 }]],
      memories: [mem("a")],
      envelope: {},
      acl: allow,
      config: RETRIEVAL_CONFIG_V1,
      now: NOW,
      limit: 10,
      rerank,
    });
    expect(rerank).not.toHaveBeenCalled();
  });
});

// RED (S4.2.1 relevance-gated retrieval): a new POST-fusion / PRE-boost pure
// filter that drops candidates whose fused score is strictly below the config
// floor, so off-topic noise is never surfaced even when the limit is under-filled.
describe("applyRelevanceFloor (drops below-floor candidates, POST-fusion PRE-boost)", () => {
  it("drops candidates scoring strictly below the floor and keeps the rest", () => {
    const out = applyRelevanceFloor({
      candidates: [
        { id: "high", score: 0.5 },
        { id: "low", score: 0.05 },
      ],
      floor: 0.1,
    });
    expect(ids(out)).toEqual(["high"]);
  });

  it("keeps a candidate exactly at the floor (score >= floor)", () => {
    const out = applyRelevanceFloor({
      candidates: [{ id: "edge", score: 0.1 }],
      floor: 0.1,
    });
    expect(ids(out)).toEqual(["edge"]);
  });

  it("preserves the incoming order among survivors (stable filter)", () => {
    const out = applyRelevanceFloor({
      candidates: [
        { id: "a", score: 0.9 },
        { id: "drop", score: 0.01 },
        { id: "b", score: 0.8 },
        { id: "c", score: 0.7 },
      ],
      floor: 0.1,
    });
    expect(ids(out)).toEqual(["a", "b", "c"]);
  });

  it("never mutates the surviving candidates (identical id + score)", () => {
    const candidates: FusedCandidate[] = [
      { id: "a", score: 0.9 },
      { id: "b", score: 0.8 },
    ];
    const out = applyRelevanceFloor({ candidates, floor: 0.5 });
    expect(out).toEqual([
      { id: "a", score: 0.9 },
      { id: "b", score: 0.8 },
    ]);
  });

  it("is a no-op passthrough when the floor is 0 or negative", () => {
    const candidates: FusedCandidate[] = [
      { id: "a", score: 0.5 },
      { id: "b", score: 0 },
      { id: "c", score: 0.01 },
    ];
    expect(ids(applyRelevanceFloor({ candidates, floor: 0 }))).toEqual(["a", "b", "c"]);
    expect(ids(applyRelevanceFloor({ candidates, floor: -1 }))).toEqual(["a", "b", "c"]);
  });
});

describe("fuseAndRank applies the relevance floor (POST-fusion, PRE-boost)", () => {
  it("excludes a below-floor off-topic candidate even when survivors under-fill the limit", () => {
    // 'offtopic' appears once at a deep rank -> tiny fused score below the floor.
    // 'ontopic' appears at rank 1 -> comfortably above it. limit=10 is never hit,
    // so the floor (not the limit) is what must exclude 'offtopic'.
    const offTopicScore = 1 / (60 + 50);
    // Floor sits in the (offtopic rank-50, ontopic rank-1] RRF window: 0.01364 is
    // above offtopic (1/110 ≈ 0.00909) but below ontopic rank-1 (1/61 ≈ 0.01639).
    const floor = 1.5 * offTopicScore;
    const out = fuseAndRank({
      lanes: [
        [
          { id: "ontopic", rank: 1 },
          { id: "offtopic", rank: 50 },
        ],
      ],
      memories: [mem("ontopic"), mem("offtopic")],
      envelope: {},
      acl: allow,
      config: { ...RETRIEVAL_CONFIG_V1, relevanceFloor: floor },
      now: NOW,
      limit: 10,
    });
    expect(ids(out)).toEqual(["ontopic"]);
  });

  it("does not let a boost resurrect a candidate the floor already dropped (floor is pre-boost)", () => {
    // 'weak' clears the floor ONLY if its scope/entity/pin/recency boost were
    // added first. Because the floor runs PRE-boost it sees the bare fused score
    // and drops 'weak' before any boost can lift it.
    const weakScore = 1 / (60 + 40);
    // Floor sits in the (weak rank-40, strong rank-1] RRF window: 0.0132 is above
    // weak's bare score (1/100 = 0.01) but below strong rank-1 (1/61 ≈ 0.01639),
    // so the pre-boost floor drops weak even though its boost would clear it.
    const floor = (weakScore + 1 / 61) / 2;
    const out = fuseAndRank({
      lanes: [
        [
          { id: "strong", rank: 1 },
          { id: "weak", rank: 40 },
        ],
      ],
      memories: [
        mem("strong"),
        mem("weak", {
          renderPolicy: "pinned",
          ownerScopeType: "org",
          ownerScopeId: "org-1",
          subjectEntityId: "ent-1",
          memoryType: "task_state",
          updatedAt: NOW,
        }),
      ],
      envelope: { ownerScopeType: "org", ownerScopeId: "org-1", entityIds: ["ent-1"] },
      acl: allow,
      config: { ...RETRIEVAL_CONFIG_V1, relevanceFloor: floor },
      now: NOW,
      limit: 10,
    });
    expect(ids(out)).toEqual(["strong"]);
  });

  it("drops no candidate for the floor when relevanceFloor is 0 (pre-floor behavior)", () => {
    const lanes: Candidate[][] = [
      [
        { id: "a", rank: 1 },
        { id: "b", rank: 30 },
      ],
    ];
    const out = fuseAndRank({
      lanes,
      memories: [mem("a"), mem("b")],
      envelope: {},
      acl: allow,
      config: { ...RETRIEVAL_CONFIG_V1, relevanceFloor: 0 },
      now: NOW,
      limit: 10,
    });
    expect(ids(out).toSorted()).toEqual(["a", "b"]);
  });
});

// RED (semantic-distance relevance gate): the shipped RRF-rank floor can't
// discriminate on a small corpus — the vector lane returns every memory as a
// nearest neighbour, so every candidate clears the fused-score floor and nothing
// is trimmed. This gate instead bounds the actual semantic cosine DISTANCE from
// the vector lane, while keeping exact lexical/entity matches (whose lanes are
// already precise). It is a pure POST-fusion FILTER: never mutates scores, keeps
// incoming order.
describe("applySemanticDistanceGate (bounds vector-lane cosine distance, keeps lexical/entity)", () => {
  it("keeps a candidate whose vector distance is within the bound", () => {
    const out = applySemanticDistanceGate({
      candidates: [{ id: "close", score: 0.5 }],
      vectorDistanceById: new Map([["close", 0.3]]),
      lexicalOrEntityIds: new Set<string>(),
      maxCosineDistance: 0.6,
    });
    expect(ids(out)).toEqual(["close"]);
  });

  it("keeps a candidate exactly at the bound (distance <= max)", () => {
    const out = applySemanticDistanceGate({
      candidates: [{ id: "edge", score: 0.5 }],
      vectorDistanceById: new Map([["edge", 0.6]]),
      lexicalOrEntityIds: new Set<string>(),
      maxCosineDistance: 0.6,
    });
    expect(ids(out)).toEqual(["edge"]);
  });

  it("drops an off-topic candidate whose distance exceeds the bound with no lexical/entity support", () => {
    const out = applySemanticDistanceGate({
      candidates: [{ id: "far", score: 0.5 }],
      vectorDistanceById: new Map([["far", 0.9]]),
      lexicalOrEntityIds: new Set<string>(),
      maxCosineDistance: 0.6,
    });
    expect(ids(out)).toEqual([]);
  });

  it("keeps a FAR candidate (distance > max) when it is an exact lexical/entity match", () => {
    const out = applySemanticDistanceGate({
      candidates: [{ id: "exact", score: 0.5 }],
      vectorDistanceById: new Map([["exact", 0.9]]),
      lexicalOrEntityIds: new Set(["exact"]),
      maxCosineDistance: 0.6,
    });
    expect(ids(out)).toEqual(["exact"]);
  });

  it("keeps a candidate with no vector distance (absent from the map) when it has lexical/entity support", () => {
    const out = applySemanticDistanceGate({
      candidates: [{ id: "lexonly", score: 0.5 }],
      vectorDistanceById: new Map<string, number>(),
      lexicalOrEntityIds: new Set(["lexonly"]),
      maxCosineDistance: 0.6,
    });
    expect(ids(out)).toEqual(["lexonly"]);
  });

  it("drops a candidate with no vector distance and no lexical/entity support", () => {
    const out = applySemanticDistanceGate({
      candidates: [{ id: "orphan", score: 0.5 }],
      vectorDistanceById: new Map<string, number>(),
      lexicalOrEntityIds: new Set<string>(),
      maxCosineDistance: 0.6,
    });
    expect(ids(out)).toEqual([]);
  });

  it("is order-stable among survivors and never mutates scores", () => {
    const candidates: FusedCandidate[] = [
      { id: "a", score: 0.9 },
      { id: "drop", score: 0.8 },
      { id: "b", score: 0.7 },
      { id: "c", score: 0.6 },
    ];
    const out = applySemanticDistanceGate({
      candidates,
      vectorDistanceById: new Map([
        ["a", 0.1],
        ["drop", 0.95],
        ["b", 0.2],
        ["c", 0.3],
      ]),
      lexicalOrEntityIds: new Set<string>(),
      maxCosineDistance: 0.6,
    });
    expect(out).toEqual([
      { id: "a", score: 0.9 },
      { id: "b", score: 0.7 },
      { id: "c", score: 0.6 },
    ]);
  });
});

describe("fuseAndRank applies the semantic-distance gate (POST-fusion, derived from lanes)", () => {
  // Deterministic bound independent of the shipped default so the fixture is
  // stable if the default is retuned.
  const config = { ...RETRIEVAL_CONFIG_V1, maxCosineDistance: 0.6 };

  it("excludes an off-topic memory that only the semantic lane returns with a large distance, even under the limit", () => {
    // semantic lane (lanes[0]) surfaces both; 'offtopic' is a far neighbour
    // (0.95 > 0.6) with no lexical/entity support, so the gate drops it even
    // though limit=10 is never reached.
    const semantic: Candidate[] = [
      { id: "ontopic", rank: 1, distance: 0.2 },
      { id: "offtopic", rank: 2, distance: 0.95 },
    ];
    const lexical: Candidate[] = [];
    const entity: Candidate[] = [];
    const out = fuseAndRank({
      lanes: [semantic, lexical, entity],
      memories: [mem("ontopic"), mem("offtopic")],
      envelope: {},
      acl: allow,
      config,
      now: NOW,
      limit: 10,
    });
    expect(ids(out)).toEqual(["ontopic"]);
  });

  it("includes a relevant semantic-lane memory whose distance is within the bound", () => {
    const semantic: Candidate[] = [{ id: "close", rank: 1, distance: 0.3 }];
    const out = fuseAndRank({
      lanes: [semantic, [], []],
      memories: [mem("close")],
      envelope: {},
      acl: allow,
      config,
      now: NOW,
      limit: 10,
    });
    expect(ids(out)).toEqual(["close"]);
  });

  it("drops an embedded far candidate despite broad FTS support, but keeps high-signal exact lexical matches", () => {
    const semantic: Candidate[] = [
      { id: "broad", rank: 1, distance: 0.9 },
      { id: "phrase", rank: 2, distance: 0.9 },
      { id: "identifier", rank: 3, distance: 0.9 },
    ];
    // FTS match metadata distinguishes incidental term overlap from the two
    // high-signal lexical cases that may override an authoritative semantic
    // distance: an exact phrase and a digit-bearing identifier.
    const lexical = [
      { id: "broad", rank: 1, exactMatch: false },
      { id: "phrase", rank: 2, exactMatch: true },
      { id: "identifier", rank: 3, exactMatch: true },
    ];
    const out = fuseAndRank({
      lanes: [semantic, lexical, []],
      memories: [mem("broad"), mem("phrase"), mem("identifier")],
      envelope: {},
      acl: allow,
      config,
      now: NOW,
      limit: 10,
    });
    expect(ids(out).toSorted()).toEqual(["identifier", "phrase"]);
  });

  it("drops an embedded broad FTS candidate that falls outside the vector top-N window", () => {
    // Missing vector-window membership is not evidence that a row is
    // unembedded. The lexical lane carries the authoritative embedding-presence
    // metadata so broad term overlap cannot rescue an embedded row whose
    // semantic distance was not returned in the bounded vector window.
    const semantic: Candidate[] = [{ id: "in-window", rank: 1, distance: 0.2 }];
    const lexical: Candidate[] = [
      { id: "embedded-outside-window", rank: 1, exactMatch: false, hasEmbedding: true },
    ];
    const out = fuseAndRank({
      lanes: [semantic, lexical, []],
      memories: [mem("in-window"), mem("embedded-outside-window")],
      envelope: {},
      acl: allow,
      config,
      now: NOW,
      limit: 10,
    });
    expect(ids(out)).toEqual(["in-window"]);
  });

  it("does not infer that broad FTS candidates with unknown embedding presence are unembedded", () => {
    const lexical: Candidate[] = [{ id: "unknown", rank: 1, exactMatch: false }];
    const out = fuseAndRank({
      lanes: [[], lexical, []],
      memories: [mem("unknown")],
      envelope: {},
      acl: allow,
      config,
      now: NOW,
      limit: 10,
    });
    expect(ids(out)).toEqual([]);
  });

  it("keeps an explicitly unembedded memory with broad FTS support", () => {
    // Ordinary lexical support remains a valid fallback only when the lane
    // explicitly proves the row has no current embedding.
    const semantic: Candidate[] = [];
    const lexical: Candidate[] = [
      { id: "lexhit", rank: 1, exactMatch: false, hasEmbedding: false },
    ];
    const entity: Candidate[] = [];
    const out = fuseAndRank({
      lanes: [semantic, lexical, entity],
      memories: [mem("lexhit")],
      envelope: {},
      acl: allow,
      config,
      now: NOW,
      limit: 10,
    });
    expect(ids(out)).toEqual(["lexhit"]);
  });

  it("keeps exact lexical and entity rescues even when embedded rows are outside the vector window", () => {
    const lexical: Candidate[] = [{ id: "exact", rank: 1, exactMatch: true, hasEmbedding: true }];
    const entity: Candidate[] = [{ id: "entity", rank: 1, hasEmbedding: true }];
    const out = fuseAndRank({
      lanes: [[], lexical, entity],
      memories: [mem("exact"), mem("entity")],
      envelope: {},
      acl: allow,
      config,
      now: NOW,
      limit: 10,
    });
    expect(ids(out).toSorted()).toEqual(["entity", "exact"]);
  });
});
