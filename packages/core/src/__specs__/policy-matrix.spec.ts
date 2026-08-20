/**
 * Tests policy matrix behavior.
 *
 * Inputs: Imported dependencies and values passed to the module's documented functions.
 * Outputs: Exported types, values, and behavior provided by the module.
 * Errors: Functions document validation, dependency, and runtime errors individually.
 *
 * @packageDocumentation
 */

import type { SourceTrustClass } from "@entellix/contracts";
import { policyMatrixConfigSchema } from "@entellix/contracts/policy-matrix";
import type { PolicyMatrixConfig } from "@entellix/contracts/policy-matrix";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_POLICY_MATRIX,
  HARD_RULES,
  type EvaluatedClassification,
  type SimulationCandidate,
  evaluateDisposition,
  simulateMatrix,
} from "../policy-matrix.ts";

/**
 * Unit surface for S2.2.2 — the confidence policy-matrix engine. Pure and
 * table-driven: no Postgres, HTTP, or model. The assertions pin the implemented
 * lookup, hard-rule, and simulation behavior.
 *
 * Pinned behavior:
 *   - matrix lookup = most-specific matching cell at/above minConfidence, else
 *     defaults (review); matrixVersion stamped on every decision.
 *   - hard rules run in CODE and are untunable-downward: a matrix cell can force
 *     review/reject but can NEVER escalate a hard-ruled tuple to auto_commit.
 *
 * `EvaluatedClassification` is intentionally the narrow policy-matrix input
 * projection rather than the classifier's complete enriched-candidate shape.
 */

/** Build a hard-rule-free classification matching a given tuple, most fields defaulted.
 *
 * @param overrides - Value supplied for `overrides`.
 * @returns The result produced by `classification`.
 * @throws Errors raised by validation or dependent operations.
 */
function classification(overrides: Partial<EvaluatedClassification> = {}): EvaluatedClassification {
  return {
    candidateId: "00000000-0000-4000-8000-000000000001",
    memoryType: "fact",
    owner: { scopeType: "user" },
    audienceSuggestion: "private_to_owner",
    sourceAuthority: "explicit",
    sensitivity: { level: "normal", aboutAnotherPerson: false },
    confidence: 0.9,
    ...overrides,
  };
}

const FIRST_PARTY: SourceTrustClass = "first_party";

describe("DEFAULT_POLICY_MATRIX — draft config shape", () => {
  it("validates against the contract schema and is marked draft", () => {
    const parsed = policyMatrixConfigSchema.safeParse(DEFAULT_POLICY_MATRIX);
    expect(parsed.success).toBe(true);
    expect(DEFAULT_POLICY_MATRIX.version).toBe("2.2.0-draft");
    // Unmatched tuples must never silently auto-commit — the default is review.
    expect(DEFAULT_POLICY_MATRIX.defaults.disposition).toBe("review");
  });

  it("encodes the org-visible directive/policy anchor rows", () => {
    const orgVisible = DEFAULT_POLICY_MATRIX.cells.filter(
      (cell) => cell.audienceKind === "org_members",
    );
    expect(orgVisible.map((cell) => cell.memoryType).toSorted()).toEqual(["directive", "policy"]);
    for (const cell of orgVisible) expect(cell.disposition).toBe("review");
  });
});

/**
 * Table-driven per-cell coverage over DEFAULT_POLICY_MATRIX. We only loop cells
 * whose tuple can be exercised WITHOUT tripping a hard rule (so the disposition is
 * purely matrix-driven and hardRule is null). Directive/policy org-visible cells
 * are inherently hard-ruled and are covered in the hard-rule section instead.
 */
const pureCells = DEFAULT_POLICY_MATRIX.cells.filter(
  (cell) =>
    !(cell.audienceKind === "org_members" && ["directive", "policy"].includes(cell.memoryType)),
);

describe("evaluateDisposition — table-driven per matrix cell (hard-rule-free tuples)", () => {
  it("has pure cells to exercise", () => {
    expect(pureCells.length).toBeGreaterThan(0);
  });

  for (const [index, cell] of pureCells.entries()) {
    const tuple = `${cell.memoryType}/${cell.audienceKind ?? "*"}/${cell.sourceAuthority ?? "*"}/${cell.sensitivityLevel ?? "*"}`;

    it(`[cell ${index}] ${tuple} at/above minConfidence → ${cell.disposition}`, () => {
      const decision = evaluateDisposition({
        classification: classification({
          candidateId: `00000000-0000-4000-8000-0000000000${(0x10 + index).toString(16)}`,
          memoryType: cell.memoryType,
          audienceSuggestion: cell.audienceKind ?? "private_to_owner",
          sourceAuthority: cell.sourceAuthority ?? "explicit",
          sensitivity: { level: cell.sensitivityLevel ?? "normal", aboutAnotherPerson: false },
          confidence: cell.minConfidence,
        }),
        sourceTrustClass: FIRST_PARTY,
        matrix: DEFAULT_POLICY_MATRIX,
      });

      expect(decision.disposition).toBe(cell.disposition);
      expect(decision.hardRule).toBeNull();
      expect(decision.matrixVersion).toBe(DEFAULT_POLICY_MATRIX.version);
    });
  }
});

/** Cells with a real threshold: a below-threshold candidate must fall to defaults. */
const thresholdCells = pureCells.filter((cell) => cell.minConfidence > 0);

describe("evaluateDisposition — below a cell threshold falls back to defaults", () => {
  for (const [index, cell] of thresholdCells.entries()) {
    const tuple = `${cell.memoryType}/${cell.audienceKind ?? "*"}/${cell.sourceAuthority ?? "*"}/${cell.sensitivityLevel ?? "*"}`;

    it(`[cell ${index}] ${tuple} below minConfidence → defaults (review), reason cites fallback`, () => {
      const decision = evaluateDisposition({
        classification: classification({
          memoryType: cell.memoryType,
          audienceSuggestion: cell.audienceKind ?? "private_to_owner",
          sourceAuthority: cell.sourceAuthority ?? "explicit",
          sensitivity: { level: cell.sensitivityLevel ?? "normal", aboutAnotherPerson: false },
          confidence: Math.max(0, cell.minConfidence - 0.1),
        }),
        sourceTrustClass: FIRST_PARTY,
        matrix: DEFAULT_POLICY_MATRIX,
      });

      expect(decision.disposition).toBe(DEFAULT_POLICY_MATRIX.defaults.disposition);
      expect(decision.reason.toLowerCase()).toMatch(/fallback|default|threshold|confidence/);
      expect(decision.matrixVersion).toBe(DEFAULT_POLICY_MATRIX.version);
    });
  }
});

describe("evaluateDisposition — unmatched tuple falls back to defaults", () => {
  it("routes a type with no cell to defaults (review) with a fallback reason", () => {
    const decision = evaluateDisposition({
      // episodic_event has no cell in the default matrix.
      classification: classification({ memoryType: "episodic_event", confidence: 0.99 }),
      sourceTrustClass: FIRST_PARTY,
      matrix: DEFAULT_POLICY_MATRIX,
    });

    expect(decision.disposition).toBe("review");
    expect(decision.hardRule).toBeNull();
    expect(decision.reason.toLowerCase()).toMatch(/fallback|default/);
    expect(decision.matrixVersion).toBe(DEFAULT_POLICY_MATRIX.version);
  });
});

/**
 * A malicious draft matrix: every dangerous tuple is mapped to auto_commit at
 * minConfidence 0. evaluateDisposition must STILL return review because the hard
 * rules run in code above the matrix — proving the matrix is untunable-downward.
 */
const MALICIOUS_MATRIX: PolicyMatrixConfig = policyMatrixConfigSchema.parse({
  version: "malicious-1",
  cells: [
    // org-visible directive → attacker wants auto_commit
    {
      memoryType: "directive",
      audienceKind: "org_members",
      sourceAuthority: null,
      sensitivityLevel: null,
      disposition: "auto_commit",
      minConfidence: 0,
    },
    // about-another-person fact → attacker wants auto_commit
    {
      memoryType: "fact",
      audienceKind: "private_to_owner",
      sourceAuthority: "explicit",
      sensitivityLevel: "normal",
      disposition: "auto_commit",
      minConfidence: 0,
    },
    // ambient / non-first-party directive (private, so NOT org-visible) → auto_commit
    {
      memoryType: "directive",
      audienceKind: "private_to_owner",
      sourceAuthority: null,
      sensitivityLevel: null,
      disposition: "auto_commit",
      minConfidence: 0,
    },
  ],
  defaults: { disposition: "auto_commit", minConfidence: 0 },
});

describe("evaluateDisposition — hard-rule bypass attempts fail", () => {
  it("(a) org-visible directive → review, hardRule=org_visible_directive_or_policy", () => {
    const decision = evaluateDisposition({
      classification: classification({
        memoryType: "directive",
        owner: { scopeType: "org" },
        audienceSuggestion: "org_members",
        confidence: 0.99,
      }),
      sourceTrustClass: FIRST_PARTY,
      matrix: MALICIOUS_MATRIX,
    });

    expect(decision.disposition).toBe("review");
    expect(decision.hardRule).toBe(HARD_RULES.orgVisibleDirectiveOrPolicy);
  });

  it("(b) about-another-person → review, hardRule=about_another_person", () => {
    const decision = evaluateDisposition({
      classification: classification({
        memoryType: "fact",
        sensitivity: { level: "normal", aboutAnotherPerson: true },
        confidence: 0.99,
      }),
      sourceTrustClass: FIRST_PARTY,
      matrix: MALICIOUS_MATRIX,
    });

    expect(decision.disposition).toBe("review");
    expect(decision.hardRule).toBe(HARD_RULES.aboutAnotherPerson);
  });

  it("(c) ambient/external content proposing a directive → review unconditionally", () => {
    const decision = evaluateDisposition({
      classification: classification({
        memoryType: "directive",
        // user-private so the org-visible rule does NOT fire; the ambient rule does.
        owner: { scopeType: "user" },
        audienceSuggestion: "private_to_owner",
        confidence: 0.99,
      }),
      sourceTrustClass: "external_included",
      matrix: MALICIOUS_MATRIX,
    });

    expect(decision.disposition).toBe("review");
    expect(decision.hardRule).toBe(HARD_RULES.ambientRuleProposal);
  });

  it("(e) USER-owned org-visible directive → review (owner never gates the org-visible rule)", () => {
    // Bypass attempt found in Sprint 2.2 review: owner=user + audience=org_members
    // + first_party used to slip past every hard rule, letting a permissive cell
    // auto-commit an org-visible directive. The rule must be owner-independent.
    const decision = evaluateDisposition({
      classification: classification({
        memoryType: "directive",
        owner: { scopeType: "user" },
        audienceSuggestion: "org_members",
        confidence: 0.99,
      }),
      sourceTrustClass: FIRST_PARTY,
      matrix: MALICIOUS_MATRIX,
    });

    expect(decision.disposition).toBe("review");
    expect(decision.hardRule).toBe(HARD_RULES.orgVisibleDirectiveOrPolicy);
  });

  it("(d) non-first-party (integration) directive → review, hardRule=non_first_party_directive", () => {
    const decision = evaluateDisposition({
      classification: classification({
        memoryType: "directive",
        owner: { scopeType: "user" },
        audienceSuggestion: "private_to_owner",
        confidence: 0.99,
      }),
      sourceTrustClass: "integration",
      matrix: MALICIOUS_MATRIX,
    });

    expect(decision.disposition).toBe("review");
    expect(decision.hardRule).toBe(HARD_RULES.nonFirstPartyDirective);
  });

  it("stamps the (malicious) matrix version on the blocked decision too", () => {
    const decision = evaluateDisposition({
      classification: classification({
        memoryType: "fact",
        sensitivity: { level: "normal", aboutAnotherPerson: true },
        confidence: 0.99,
      }),
      sourceTrustClass: FIRST_PARTY,
      matrix: MALICIOUS_MATRIX,
    });
    expect(decision.matrixVersion).toBe(MALICIOUS_MATRIX.version);
  });
});

describe("evaluateDisposition — untunable-downward only blocks escalation, not stricter cells", () => {
  it("a matrix reject on a hard-ruled tuple stays reject (hard rule floors at review, not auto_commit)", () => {
    const strictMatrix: PolicyMatrixConfig = policyMatrixConfigSchema.parse({
      version: "strict-1",
      cells: [
        {
          memoryType: "fact",
          audienceKind: "private_to_owner",
          sourceAuthority: "explicit",
          sensitivityLevel: "normal",
          disposition: "reject",
          minConfidence: 0,
        },
      ],
      defaults: { disposition: "review", minConfidence: 0.5 },
    });

    const decision = evaluateDisposition({
      classification: classification({
        memoryType: "fact",
        sensitivity: { level: "normal", aboutAnotherPerson: true },
        confidence: 0.99,
      }),
      sourceTrustClass: FIRST_PARTY,
      matrix: strictMatrix,
    });

    // reject is stricter than the review floor, so it is preserved; the rule still fired.
    expect(decision.disposition).toBe("reject");
    expect(decision.hardRule).toBe(HARD_RULES.aboutAnotherPerson);
  });
});

describe("simulateMatrix — diff a draft matrix against the active one (pure)", () => {
  /** Draft = default matrix with the fact cell flipped auto_commit → review. */
  const draftMatrix: PolicyMatrixConfig = policyMatrixConfigSchema.parse({
    ...DEFAULT_POLICY_MATRIX,
    version: "2.2.1-draft",
    cells: DEFAULT_POLICY_MATRIX.cells.map((cell) =>
      cell.memoryType === "fact" ? { ...cell, disposition: "review" } : cell,
    ),
  });

  const candidates: SimulationCandidate[] = [
    {
      // fact/explicit/normal @0.9 → auto_commit under active, review under draft (FLIPS)
      classification: classification({
        candidateId: "00000000-0000-4000-8000-0000000000f1",
        memoryType: "fact",
        confidence: 0.9,
      }),
      sourceTrustClass: FIRST_PARTY,
    },
    {
      // preference/private/explicit/normal @0.8 → auto_commit under both (unchanged)
      classification: classification({
        candidateId: "00000000-0000-4000-8000-0000000000f2",
        memoryType: "preference",
        confidence: 0.8,
      }),
      sourceTrustClass: FIRST_PARTY,
    },
    {
      // task_state/inferred → review under both (unchanged)
      classification: classification({
        candidateId: "00000000-0000-4000-8000-0000000000f3",
        memoryType: "task_state",
        sourceAuthority: "inferred",
        confidence: 0.9,
      }),
      sourceTrustClass: FIRST_PARTY,
    },
  ];

  it("pinpoints exactly the candidate the flipped cell affects", () => {
    const diff = simulateMatrix({
      candidates,
      activeMatrix: DEFAULT_POLICY_MATRIX,
      draftMatrix,
    });

    const changed = diff.perCandidate.filter((entry) => entry.changed);
    expect(changed).toHaveLength(1);
    expect(changed[0]!.candidateId).toBe("00000000-0000-4000-8000-0000000000f1");
    expect(changed[0]!.activeDisposition).toBe("auto_commit");
    expect(changed[0]!.draftDisposition).toBe("review");
  });

  it("summary counts match the per-candidate outcomes", () => {
    const diff = simulateMatrix({
      candidates,
      activeMatrix: DEFAULT_POLICY_MATRIX,
      draftMatrix,
    });

    expect(diff.summary.total).toBe(3);
    expect(diff.summary.changed).toBe(1);
    // active: fact→auto_commit, preference→auto_commit, task_state→review
    expect(diff.summary.activeCounts.auto_commit).toBe(2);
    expect(diff.summary.activeCounts.review).toBe(1);
    // draft: fact→review, preference→auto_commit, task_state→review
    expect(diff.summary.draftCounts.auto_commit).toBe(1);
    expect(diff.summary.draftCounts.review).toBe(2);
  });
});
