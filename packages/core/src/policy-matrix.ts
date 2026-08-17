import type { SourceTrustClass } from "@entellix/contracts";
import type {
  Disposition,
  DispositionDecision,
  EvaluateDispositionInput,
  EvaluatedClassification,
  HardRuleId,
  PolicyMatrixCell,
  PolicyMatrixConfig,
  SimulateMatrixInput,
  SimulationCandidateDiff,
  SimulationDiff,
} from "@entellix/contracts/policy-matrix";
import {
  dispositionDecisionSchema,
  evaluateDispositionInputSchema,
  policyMatrixConfigSchema,
  simulateMatrixInputSchema,
  simulationDiffSchema,
} from "@entellix/contracts/policy-matrix";

export type {
  DispositionDecision,
  EvaluateDispositionInput,
  EvaluatedClassification,
  HardRuleId,
  SimulateMatrixInput,
  SimulationCandidate,
  SimulationCandidateDiff,
  SimulationDiff,
} from "@entellix/contracts/policy-matrix";

/**
 * Confidence policy-matrix engine (S2.2.2). Turns an enriched classification into
 * a governed disposition by looking up a versioned matrix config, and enforces
 * hard rules IN CODE that no matrix cell can loosen. Pure functions
 * (`evaluateDisposition`, `simulateMatrix`). Persistence belongs to a host adapter.
 *
 * Behavior is pinned by pipeline/__specs__/policy-matrix.spec.ts (pure,
 * table-driven) and test/pipeline-policy-matrix.test.ts (persistence).
 *
 * ── Matrix change procedure (full runbook: docs/runbooks/policy-matrix-change.md) ─
 *   1. SIMULATE — run the host distribution's matrix simulation command over
 *      sampled candidates,
 *      diffing the draft matrix against the active one. Review every `changed`
 *      candidate — especially any moving TOWARD auto_commit.
 *   2. REVIEW — Ted signs off on the diff (story DoD: the initial matrix and any
 *      change is reviewed before activation). DEFAULT_POLICY_MATRIX ships as a
 *      DRAFT (version '2.2.0-draft') and is NOT active until that sign-off.
 *   3. ACTIVATE — bump the matrix `version`, land it as config, and record the
 *      activation. Every disposition thereafter stamps the new version for audit.
 */

/*
 * The policy matrix keys on a narrow PROJECTION of the classifier's governance
 * verdict (`Classification`, S2.2.1): the memory type, the owner scope, the
 * suggested audience kind, the source authority, and the sensitivity assessment.
 * `SensitivityAssessment` is imported from the sibling classifier contracts — the
 * single source of truth for the `aboutAnotherPerson` flag the hard rules read.
 * `EvaluatedClassification` is the matrix-input tuple the engine and simulation
 * consume; the owner projection is a binary scope (`active_org_id` is context,
 * never a default owner — Decision 4/5), narrower than the classifier's
 * confidence-carrying `OwnerAssessment`.
 */
/**
 * Hard-rule identifiers. Enforced in code BEFORE/OVER the matrix lookup; the
 * matching id is stamped onto `DispositionDecision.hardRule` so an auto_commit
 * that was blocked is auditable. Untunable-downward: these force at least
 * `review` (a matrix cell may make it stricter — `reject` — but never
 * `auto_commit`).
 */
export const HARD_RULES = {
  /**
   * audience≠private_to_owner AND type∈{directive,policy} → review, REGARDLESS
   * of owner: a user-owned directive whose audience reaches beyond the owner
   * (org_members, project_members, …) is still org-visible, so it may never
   * auto-commit (Decision 18; S2.3.2 "org-visible directives review-gated
   * regardless of confidence").
   */
  orgVisibleDirectiveOrPolicy: "org_visible_directive_or_policy",
  /** sensitivity.aboutAnotherPerson → review (Decision 18). */
  aboutAnotherPerson: "about_another_person",
  /** ambient/external (external_included) content proposing a rule → review (Decision 18). */
  ambientRuleProposal: "ambient_source_rule_proposal",
  /** directive from a non-first-party trust class → review (Decision 10). */
  nonFirstPartyDirective: "non_first_party_directive",
} as const;
/** The hard-rule floor: raises `auto_commit` to `review`, passes review/reject through. */
function applyHardRuleFloor(matrixDisposition: Disposition): Disposition {
  return matrixDisposition === "auto_commit" ? "review" : matrixDisposition;
}

/** `type/audience/authority/sensitivity` tuple string for a readable decision reason. */
function cellTuple(cell: PolicyMatrixCell): string {
  return `${cell.memoryType}/${cell.audienceKind ?? "*"}/${cell.sourceAuthority ?? "*"}/${cell.sensitivityLevel ?? "*"}`;
}

/**
 * The first hard rule that fires for a tuple, in untunable-downward precedence
 * order (about-another-person → org-visible directive/policy → ambient rule
 * proposal → non-first-party directive), or null when none applies. Enforced in
 * CODE, above the matrix, so no cell — however permissive — can bypass it
 * (Decisions 10, 18).
 */
function detectHardRule(
  classification: EvaluatedClassification,
  sourceTrustClass: SourceTrustClass,
): HardRuleId | null {
  const { memoryType, audienceSuggestion, sensitivity } = classification;
  const isRuleType = memoryType === "directive" || memoryType === "policy";

  if (sensitivity.aboutAnotherPerson) return HARD_RULES.aboutAnotherPerson;
  // Deliberately owner-independent: a USER-owned directive with an org-visible
  // audience is just as governing for others as an org-owned one, so it gets the
  // same untunable review floor (bypass found in Sprint 2.2 review).
  if (audienceSuggestion !== "private_to_owner" && isRuleType)
    return HARD_RULES.orgVisibleDirectiveOrPolicy;
  if (sourceTrustClass === "external_included" && isRuleType) return HARD_RULES.ambientRuleProposal;
  if (memoryType === "directive" && sourceTrustClass !== "first_party")
    return HARD_RULES.nonFirstPartyDirective;
  return null;
}

/**
 * The most-specific matrix cell matching a tuple AT/ABOVE its confidence
 * threshold, or null when none does. Specificity = count of non-null (non-
 * wildcard) axes; ties resolve to the earlier cell in array order (strict `>`).
 */
function matchCell(
  matrix: PolicyMatrixConfig,
  classification: EvaluatedClassification,
): PolicyMatrixCell | null {
  const { memoryType, audienceSuggestion, sourceAuthority, sensitivity, confidence } =
    classification;
  let best: PolicyMatrixCell | null = null;
  let bestSpecificity = -1;

  for (const cell of matrix.cells) {
    if (cell.memoryType !== memoryType) continue;
    if (cell.audienceKind !== null && cell.audienceKind !== audienceSuggestion) continue;
    if (cell.sourceAuthority !== null && cell.sourceAuthority !== sourceAuthority) continue;
    if (cell.sensitivityLevel !== null && cell.sensitivityLevel !== sensitivity.level) continue;
    if (confidence < cell.minConfidence) continue;

    const specificity =
      (cell.audienceKind === null ? 0 : 1) +
      (cell.sourceAuthority === null ? 0 : 1) +
      (cell.sensitivityLevel === null ? 0 : 1);
    if (specificity > bestSpecificity) {
      best = cell;
      bestSpecificity = specificity;
    }
  }
  return best;
}

/**
 * Evaluate a single classification against the matrix (PURE). Order of operations:
 *   1. Compute the matrix disposition: most-specific matching cell whose
 *      `minConfidence <= confidence`; else fall back to `defaults` (review).
 *   2. Apply the hard-rule floor: if any hard rule fires, the disposition may not
 *      be `auto_commit` (capped to at least `review`); a stricter matrix `reject`
 *      is preserved. Stamp `hardRule` with the firing rule id.
 *   3. Always stamp `matrixVersion = matrix.version`.
 */
export function evaluateDisposition(rawInput: EvaluateDispositionInput): DispositionDecision {
  const { classification, sourceTrustClass, matrix } =
    evaluateDispositionInputSchema.parse(rawInput);
  const cell = matchCell(matrix, classification);
  const matrixDisposition = cell ? cell.disposition : matrix.defaults.disposition;
  const hardRule = detectHardRule(classification, sourceTrustClass);

  if (hardRule !== null) {
    const disposition = applyHardRuleFloor(matrixDisposition);
    return dispositionDecisionSchema.parse({
      disposition,
      matrixVersion: matrix.version,
      reason: `hard rule '${hardRule}' enforced — floored to '${disposition}' (untunable-downward)`,
      hardRule,
    });
  }

  const reason = cell
    ? `matched cell ${cellTuple(cell)} at confidence ${classification.confidence} ≥ ${cell.minConfidence}`
    : `no matrix cell matched at/above threshold — fell back to defaults ('${matrixDisposition}')`;
  return dispositionDecisionSchema.parse({
    disposition: matrixDisposition,
    matrixVersion: matrix.version,
    reason,
    hardRule: null,
  });
}

/** A fresh zeroed disposition tally — never shared between the active/draft counts. */
function emptyDispositionCounts(): Record<Disposition, number> {
  return { auto_commit: 0, review: 0, reject: 0 };
}

/**
 * Replay N candidates against a draft matrix and diff dispositions vs the active
 * matrix, BEFORE activating (PRD §10 simulation mode). PURE — no persistence.
 */
export function simulateMatrix(rawInput: SimulateMatrixInput): SimulationDiff {
  const { candidates, activeMatrix, draftMatrix } = simulateMatrixInputSchema.parse(rawInput);
  const activeCounts = emptyDispositionCounts();
  const draftCounts = emptyDispositionCounts();

  const perCandidate = candidates.map((candidate): SimulationCandidateDiff => {
    const active = evaluateDisposition({
      classification: candidate.classification,
      sourceTrustClass: candidate.sourceTrustClass,
      matrix: activeMatrix,
    });
    const draft = evaluateDisposition({
      classification: candidate.classification,
      sourceTrustClass: candidate.sourceTrustClass,
      matrix: draftMatrix,
    });
    activeCounts[active.disposition] += 1;
    draftCounts[draft.disposition] += 1;
    return {
      candidateId: candidate.classification.candidateId,
      activeDisposition: active.disposition,
      draftDisposition: draft.disposition,
      changed: active.disposition !== draft.disposition,
    };
  });

  return simulationDiffSchema.parse({
    perCandidate,
    summary: {
      total: perCandidate.length,
      changed: perCandidate.filter((entry) => entry.changed).length,
      activeCounts,
      draftCounts,
    },
  });
}

/**
 * DEFAULT_POLICY_MATRIX — the initial DRAFT matrix (version '2.2.0-draft'),
 * encoding the PRD §10 anchor rows. Marked draft on purpose: the story DoD
 * requires Ted to review before activation (see the matrix change procedure
 * above). Parsed through the contract schema so a malformed row fails at module
 * load, not at first use.
 *
 * Anchor rows encoded (cells matched most-specific-first, ties by array order):
 *   1. first-person preference (private, explicit, normal) → auto_commit @ 0.6
 *   2. entity fact (explicit, normal) → auto_commit @ 0.7
 *   3. org-visible directive (org_members) → review  (belt-and-suspenders; the
 *      org-visible hard rule already forces review)
 *   4. org-visible policy (org_members) → review     (ditto)
 *   5. task_state from a trusted integration (source_authority=integration,
 *      normal) → auto_commit @ 0.5
 *   6. task_state inferred/casual (source_authority=inferred) → review
 *   defaults → review @ 0.5 (unmatched tuples never silently auto-commit)
 *
 * Rows for "about-another-person → review" and "ambient rule proposal → review"
 * are intentionally NOT matrix cells: they are hard rules (about_another_person,
 * ambient_source_rule_proposal) enforced in code above the matrix, so no cell —
 * however permissive — can bypass them.
 */
export const DEFAULT_POLICY_MATRIX: PolicyMatrixConfig = policyMatrixConfigSchema.parse({
  version: "2.2.0-draft",
  cells: [
    {
      memoryType: "preference",
      audienceKind: "private_to_owner",
      sourceAuthority: "explicit",
      sensitivityLevel: "normal",
      disposition: "auto_commit",
      minConfidence: 0.6,
    },
    {
      memoryType: "fact",
      audienceKind: null,
      sourceAuthority: "explicit",
      sensitivityLevel: "normal",
      disposition: "auto_commit",
      minConfidence: 0.7,
    },
    {
      memoryType: "directive",
      audienceKind: "org_members",
      sourceAuthority: null,
      sensitivityLevel: null,
      disposition: "review",
      minConfidence: 0,
    },
    {
      memoryType: "policy",
      audienceKind: "org_members",
      sourceAuthority: null,
      sensitivityLevel: null,
      disposition: "review",
      minConfidence: 0,
    },
    {
      memoryType: "task_state",
      audienceKind: null,
      sourceAuthority: "integration",
      sensitivityLevel: "normal",
      disposition: "auto_commit",
      minConfidence: 0.5,
    },
    {
      memoryType: "task_state",
      audienceKind: null,
      sourceAuthority: "inferred",
      sensitivityLevel: null,
      disposition: "review",
      minConfidence: 0,
    },
  ],
  defaults: {
    disposition: "review",
    minConfidence: 0.5,
  },
});
