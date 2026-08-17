import { describe, expect, it } from "vitest";

// RED (S4.2.3 distractor-exclusion merge gate): the pure merge-gate helper does
// not exist yet. These specs pin the Postgres-free contract the developer must
// live in `@entellix/core/retrieval/eval-exclusion`. Any host evaluation harness
// can delegate its three merge-gate assertions to this one pure function so the
// distractor-exclusion contract is provable without a DB or provider API key.
//
// The three merge-gate assertions (per the ClickUp story) are:
//   (1) an off-topic memory below the floor is DROPPED (never returned),
//   (2) pinned/directive governance rows STILL SURFACE, and
//   (3) relevant recall is NOT regressed (expected memories still present).
//
// Pure interface pinned by these specs (eval-exclusion.ts):
//
//   evaluateExclusionCase(input: {
//     returnedIds: readonly string[]
//     expectedIds: readonly string[]
//     excludedIds: readonly string[]
//     governanceIds?: readonly string[]
//     maxRank?: number                     // default 5, 1-based
//   }): {
//     missingExpected: string[]
//     leakedExcluded: string[]
//     missingGovernance: string[]
//     passed: boolean
//   }
//
// Rules: rank is the 1-based position in returnedIds; "within maxRank" means
// index + 1 <= maxRank. leakedExcluded flags an excluded id at ANY rank (a
// distractor must be gone entirely). missingExpected / missingGovernance list
// ids absent OR beyond maxRank. passed is the AND of all three arrays being
// empty. Each returned array follows its corresponding input array's order.
import { evaluateExclusionCase } from "../eval-exclusion.ts";

describe("evaluateExclusionCase (pure merge-gate for distractor exclusion)", () => {
  it("passes when expected recall is intact, no distractor leaks, and governance surfaces", () => {
    const out = evaluateExclusionCase({
      returnedIds: ["gov", "exp-1", "exp-2", "noise"],
      expectedIds: ["exp-1", "exp-2"],
      excludedIds: ["distractor"],
      governanceIds: ["gov"],
    });
    expect(out).toEqual({
      missingExpected: [],
      leakedExcluded: [],
      missingGovernance: [],
      passed: true,
    });
  });

  it("flags a leaked distractor appearing at any rank (floor guard)", () => {
    const out = evaluateExclusionCase({
      returnedIds: ["exp-1", "distractor", "exp-2"],
      expectedIds: ["exp-1", "exp-2"],
      excludedIds: ["distractor"],
    });
    expect(out.leakedExcluded).toEqual(["distractor"]);
    expect(out.passed).toBe(false);
  });

  it("leaks an excluded id even when it appears beyond maxRank (no rank window on exclusion)", () => {
    const out = evaluateExclusionCase({
      returnedIds: ["a", "b", "c", "d", "e", "distractor"],
      expectedIds: ["a"],
      excludedIds: ["distractor"],
      maxRank: 3,
    });
    expect(out.leakedExcluded).toEqual(["distractor"]);
    expect(out.passed).toBe(false);
  });

  it("reports the leaked distractors in excludedIds input order", () => {
    const out = evaluateExclusionCase({
      returnedIds: ["second", "first", "exp"],
      expectedIds: ["exp"],
      excludedIds: ["first", "second"],
    });
    expect(out.leakedExcluded).toEqual(["first", "second"]);
  });

  it("flags an expected memory that is missing entirely (recall guard)", () => {
    const out = evaluateExclusionCase({
      returnedIds: ["exp-1", "other"],
      expectedIds: ["exp-1", "exp-2"],
      excludedIds: [],
    });
    expect(out.missingExpected).toEqual(["exp-2"]);
    expect(out.passed).toBe(false);
  });

  it("flags an expected memory present but beyond maxRank", () => {
    const out = evaluateExclusionCase({
      returnedIds: ["a", "b", "exp-late"],
      expectedIds: ["exp-late"],
      excludedIds: [],
      maxRank: 2,
    });
    expect(out.missingExpected).toEqual(["exp-late"]);
    expect(out.passed).toBe(false);
  });

  it("keeps an expected memory exactly at maxRank (rank == maxRank is within)", () => {
    const out = evaluateExclusionCase({
      returnedIds: ["a", "b", "exp-edge"],
      expectedIds: ["exp-edge"],
      excludedIds: [],
      maxRank: 3,
    });
    expect(out.missingExpected).toEqual([]);
    expect(out.passed).toBe(true);
  });

  it("reports missing expected memories in expectedIds input order", () => {
    const out = evaluateExclusionCase({
      returnedIds: ["present"],
      expectedIds: ["gone-a", "present", "gone-b"],
      excludedIds: [],
    });
    expect(out.missingExpected).toEqual(["gone-a", "gone-b"]);
  });

  it("surfaces a governance row within maxRank and passes the always-on guard", () => {
    const out = evaluateExclusionCase({
      returnedIds: ["gov", "exp"],
      expectedIds: ["exp"],
      excludedIds: [],
      governanceIds: ["gov"],
    });
    expect(out.missingGovernance).toEqual([]);
    expect(out.passed).toBe(true);
  });

  it("flags a governance row that is missing or beyond maxRank (always-on guard)", () => {
    const out = evaluateExclusionCase({
      returnedIds: ["exp", "a", "b", "gov"],
      expectedIds: ["exp"],
      excludedIds: [],
      governanceIds: ["gov"],
      maxRank: 3,
    });
    expect(out.missingGovernance).toEqual(["gov"]);
    expect(out.passed).toBe(false);
  });

  it("treats omitted governanceIds as an empty always-on guard", () => {
    const out = evaluateExclusionCase({
      returnedIds: ["exp"],
      expectedIds: ["exp"],
      excludedIds: [],
    });
    expect(out.missingGovernance).toEqual([]);
    expect(out.passed).toBe(true);
  });

  it("treats an empty governanceIds array as no governance requirement", () => {
    const out = evaluateExclusionCase({
      returnedIds: ["exp"],
      expectedIds: ["exp"],
      excludedIds: [],
      governanceIds: [],
    });
    expect(out.missingGovernance).toEqual([]);
    expect(out.passed).toBe(true);
  });

  it("defaults maxRank to 5 when omitted", () => {
    const within = evaluateExclusionCase({
      returnedIds: ["a", "b", "c", "d", "exp-5"],
      expectedIds: ["exp-5"],
      excludedIds: [],
    });
    expect(within.missingExpected).toEqual([]);
    expect(within.passed).toBe(true);

    const beyond = evaluateExclusionCase({
      returnedIds: ["a", "b", "c", "d", "e", "exp-6"],
      expectedIds: ["exp-6"],
      excludedIds: [],
    });
    expect(beyond.missingExpected).toEqual(["exp-6"]);
    expect(beyond.passed).toBe(false);
  });

  it("combines all three guards into passed (AND of every array being empty)", () => {
    const out = evaluateExclusionCase({
      returnedIds: ["gov", "exp-1", "distractor", "noise"],
      expectedIds: ["exp-1", "exp-2"],
      excludedIds: ["distractor"],
      governanceIds: ["gov", "gov-missing"],
    });
    expect(out.missingExpected).toEqual(["exp-2"]);
    expect(out.leakedExcluded).toEqual(["distractor"]);
    expect(out.missingGovernance).toEqual(["gov-missing"]);
    expect(out.passed).toBe(false);
  });
});
