import {
  SPECIFICITY_RANKS,
  type ActiveDirective,
  type EntityContext,
  type PrecedenceConflict,
  type PrecedenceDirective,
  type Resolution,
  type ResolveDirectivesData,
  type RenderDirectiveBlockInput,
  type ReviewLogEntry,
} from "@entellix/contracts/directive-precedence";

export type {
  EntityContext,
  RenderDirectiveBlockInput,
} from "@entellix/contracts/directive-precedence";

/**
 * Directive precedence engine (S2.3.3). Resolves the caller's ACTIVE, in-scope
 * directives by specificity, annotates overrides, and renders a channel-aware
 * directive block; genuinely unresolvable conflicts render both and log a review
 * item (PRD §9 precedence; Decisions 11, 12).
 *
 * The semantic conflict check is INJECTED (`conflictCheck`) so packet-time
 * conflict detection is deterministic in tests and never requires an LLM:
 * detection gates on deterministic subject/entity overlap AND the injected
 * check. Unit specs (`__specs__/directive-precedence.spec.ts`) pin the exact
 * override-annotation and per-channel rendering formats; do not change those
 * strings without updating the specs.
 */

/**
 * Precomputed entity context so ranking/scoping stay pure (no DB in the
 * resolver). `activeIds` is the raw active entity set; `ancestorsById` maps each
 * active entity id to its ancestor entity ids (from entity_edges traversal), so
 * a client-scoped rule is recognised as governing an active project that
 * belongs to that client.
 */
/**
 * Injected semantic opposition check for a directive pair — "do these two rules
 * actually contradict on the same topic?". Deterministic in tests; packet-time
 * detection never calls an LLM. detectDirectConflict gates this behind a
 * deterministic subject/entity-overlap test.
 */
export type ConflictCheck = (a: PrecedenceDirective, b: PrecedenceDirective) => boolean;

export interface ResolveDirectivesInput extends ResolveDirectivesData {
  conflictCheck: ConflictCheck;
}

const ORG_GENERAL_RANK = SPECIFICITY_RANKS.indexOf("org_general");
const USER_GENERAL_RANK = SPECIFICITY_RANKS.indexOf("user_general");

/** General (no-subject) rules rank by owner scope: user-general last, org-general above it. */
function generalRank(directive: PrecedenceDirective): number {
  return directive.ownerScopeType === "user" ? USER_GENERAL_RANK : ORG_GENERAL_RANK;
}

/**
 * Whether an entity-scoped directive's subject entity governs the active
 * context: either the subject is itself active, or it is an ancestor of an
 * active entity (a client rule governs an active project belonging to it).
 */
function subjectGovernsActiveContext(
  subjectEntityId: string,
  entityContext: EntityContext,
): boolean {
  if (entityContext.activeIds.includes(subjectEntityId)) {
    return true;
  }
  return entityContext.activeIds.some((activeId) =>
    (entityContext.ancestorsById[activeId] ?? []).includes(subjectEntityId),
  );
}

/**
 * Specificity rank of a directive as evaluated against the active entity
 * context. PURE. An entity-scoped directive (subjectEntityType task/project/
 * client) whose subject entity is active — directly in `activeIds` OR an
 * ancestor of an active entity (via `ancestorsById`) — ranks at its entity tier
 * (task=0, project=1, client=2). A general directive (no subject entity) ranks
 * `org_general`(3) or `user_general`(4) by owner scope. An entity-scoped
 * directive whose subject is NOT in the active context cannot claim its entity
 * tier and falls back to its owner general tier (resolveDirectives filters such
 * out-of-scope entity directives before ranking, so this fallback is defensive).
 */
export function rankSpecificity(
  directive: PrecedenceDirective,
  entityContext: EntityContext,
): number {
  if (directive.subjectEntityId === null) {
    return generalRank(directive);
  }

  const tierRank = directive.subjectEntityType
    ? SPECIFICITY_RANKS.indexOf(directive.subjectEntityType as (typeof SPECIFICITY_RANKS)[number])
    : -1;
  if (tierRank >= 0 && subjectGovernsActiveContext(directive.subjectEntityId, entityContext)) {
    return tierRank;
  }

  // Out-of-scope (or non-tier) entity rule: cannot claim its entity tier, falls
  // back to its owner general tier.
  return generalRank(directive);
}

/**
 * Whether two directives are in DIRECT conflict. PURE. True only when they share
 * a subject domain (same subjectEntityId, or at least one is a general
 * null-subject directive whose domain spans the other) AND the injected
 * `conflictCheck` says they semantically oppose. Two directives scoped to
 * DIFFERENT entities never directly conflict here.
 */
export function detectDirectConflict(
  a: PrecedenceDirective,
  b: PrecedenceDirective,
  conflictCheck: ConflictCheck,
): boolean {
  const sharesDomain =
    a.subjectEntityId === null ||
    b.subjectEntityId === null ||
    a.subjectEntityId === b.subjectEntityId;
  if (!sharesDomain) {
    return false;
  }
  return conflictCheck(a, b);
}

/** A survivor of the audience+scope filter, carrying its resolved rank. */
interface RankedDirective {
  directive: PrecedenceDirective;
  rank: number;
}

/** The label for the losing rule inside an override annotation ("the org rule"). */
function loserScopeLabel(loser: PrecedenceDirective): string {
  if (loser.subjectEntityType) {
    return `the ${loser.subjectEntityType} rule`;
  }
  return `the ${loser.ownerScopeType} rule`;
}

/** The context noun the winning rule governs ("this project"). */
function winnerContextNoun(winner: PrecedenceDirective): string {
  return winner.subjectEntityType ?? winner.ownerScopeType;
}

/**
 * The override annotation shown when a more specific rule prevails over a
 * broader one, e.g. "Project Acme requires Next.js — overrides the org rule for
 * this project" (pinned by the spec).
 */
function overrideAnnotation(winner: PrecedenceDirective, loser: PrecedenceDirective): string {
  return `${winner.title} — overrides ${loserScopeLabel(loser)} for this ${winnerContextNoun(winner)}`;
}

/**
 * Break a same-specificity conflict. Returns the ordered [winner, loser] plus
 * the resolution kind, or null when genuinely unresolvable (same authority AND
 * recency). PURE.
 */
function breakTie(
  a: PrecedenceDirective,
  b: PrecedenceDirective,
): {
  winner: PrecedenceDirective;
  loser: PrecedenceDirective;
  kind: "tie_source_authority" | "tie_recency";
} | null {
  // Source authority: explicit beats inferred (and both beat integration).
  const aExplicit = a.sourceAuthority === "explicit";
  const bExplicit = b.sourceAuthority === "explicit";
  if (aExplicit !== bExplicit) {
    return aExplicit
      ? { winner: a, loser: b, kind: "tie_source_authority" }
      : { winner: b, loser: a, kind: "tie_source_authority" };
  }

  // Recency: the later validFrom wins.
  if (a.validFrom !== b.validFrom) {
    return a.validFrom > b.validFrom
      ? { winner: a, loser: b, kind: "tie_recency" }
      : { winner: b, loser: a, kind: "tie_recency" };
  }

  return null;
}

/**
 * Resolve ACTIVE directives into a render-ready set. PURE. Order:
 *   1. filter to audienceAllowed AND active-scope (entity-scoped directives
 *      whose subject entity is not in the active context are dropped);
 *   2. rank each survivor by specificity (rankSpecificity);
 *   3. for each direct conflict (detectDirectConflict) → more specific wins
 *      within that entity context, the loser is excluded, the winner gets an
 *      override annotation;
 *   4. same-specificity ties break on source_authority (explicit > inferred)
 *      then recency (later validFrom);
 *   5. still tied (or conflictCheck leaves both standing) → BOTH kept, a
 *      conflict note recorded, and a review-log entry emitted.
 */
export function resolveDirectives(input: ResolveDirectivesInput): Resolution {
  const entityContext = input.entityContext ?? {
    activeIds: input.context.activeEntityIds,
    ancestorsById: {},
  };

  // 1. Filter to audience-allowed AND active-scope. A general (no-subject)
  // directive is always in scope; an entity-scoped directive is in scope only
  // when its subject governs the active context.
  const survivors: RankedDirective[] = input.directives
    .filter((directive) => {
      if (!directive.audienceAllowed) {
        return false;
      }
      if (directive.subjectEntityId === null) {
        return true;
      }
      return subjectGovernsActiveContext(directive.subjectEntityId, entityContext);
    })
    .map((directive) => ({ directive, rank: rankSpecificity(directive, entityContext) }));

  const conflicts: PrecedenceConflict[] = [];
  const reviewLogEntries: ReviewLogEntry[] = [];
  const excluded = new Set<string>();
  const annotations = new Map<string, string>();

  // 3–5. Compare each surviving pair once for a direct conflict.
  for (let i = 0; i < survivors.length; i += 1) {
    for (let j = i + 1; j < survivors.length; j += 1) {
      const a = survivors[i]!;
      const b = survivors[j]!;
      if (!detectDirectConflict(a.directive, b.directive, input.conflictCheck)) {
        continue;
      }

      if (a.rank !== b.rank) {
        // More specific (lower rank) wins in-context; loser excluded, winner
        // annotated.
        const [winner, loser] = a.rank < b.rank ? [a, b] : [b, a];
        excluded.add(loser.directive.memoryId);
        if (!annotations.has(winner.directive.memoryId)) {
          annotations.set(
            winner.directive.memoryId,
            overrideAnnotation(winner.directive, loser.directive),
          );
        }
        conflicts.push({
          memoryIds: [winner.directive.memoryId, loser.directive.memoryId],
          resolution: "more_specific_won",
          note: `${winner.directive.title} is more specific than ${loserScopeLabel(loser.directive)}; it prevails for this ${winnerContextNoun(winner.directive)}.`,
        });
        continue;
      }

      // Same specificity: break on authority then recency; tie winners get NO
      // annotation.
      const tie = breakTie(a.directive, b.directive);
      if (tie) {
        excluded.add(tie.loser.memoryId);
        conflicts.push({
          memoryIds: [tie.winner.memoryId, tie.loser.memoryId],
          resolution: tie.kind,
          note:
            tie.kind === "tie_source_authority"
              ? `${tie.winner.title} wins on source authority (explicit over inferred).`
              : `${tie.winner.title} wins on recency (more recent validFrom).`,
        });
        continue;
      }

      // Genuinely unresolvable: BOTH stand, conflict noted, review logged.
      const note = `Directives "${a.directive.title}" and "${b.directive.title}" conflict at equal specificity, authority, and recency — needs a human.`;
      conflicts.push({
        memoryIds: [a.directive.memoryId, b.directive.memoryId],
        resolution: "unresolved",
        note,
      });
      reviewLogEntries.push({
        kind: "directive_conflict",
        memoryIds: [a.directive.memoryId, b.directive.memoryId],
        note,
      });
    }
  }

  const active: ActiveDirective[] = survivors
    .filter((survivor) => !excluded.has(survivor.directive.memoryId))
    .map((survivor) => ({
      memoryId: survivor.directive.memoryId,
      content: survivor.directive.content,
      rank: survivor.rank,
      overrideAnnotation: annotations.get(survivor.directive.memoryId) ?? null,
    }));

  return { active, conflicts, reviewLogEntries };
}

/**
 * Render the resolved directives into a channel-aware block. PURE.
 *   - `packet` / `file`: directive content VERBATIM, override annotations as
 *     SEPARATE annotation lines (content bytes never mutated);
 *   - `hook_injection`: declarative framing wrapper AROUND the verbatim bytes —
 *     presents each rule as information in effect, never an imperative paraphrase
 *     (Decision 12).
 * Exact strings are pinned by the spec's inline snapshots.
 */
export function renderDirectiveBlock(input: RenderDirectiveBlockInput): string {
  const { active } = input.resolution;

  if (input.channel === "hook_injection") {
    const lines = ["Project information — the following operating rules are in effect:"];
    for (const directive of active) {
      lines.push(`- Rule in effect: "${directive.content}"`);
      if (directive.overrideAnnotation !== null) {
        lines.push(`  Note: ${directive.overrideAnnotation}`);
      }
    }
    return lines.join("\n");
  }

  // packet / file: identical verbatim rendering.
  const lines = ["Directives in effect:"];
  for (const directive of active) {
    lines.push(`- ${directive.content}`);
    if (directive.overrideAnnotation !== null) {
      lines.push(`  ↳ ${directive.overrideAnnotation}`);
    }
  }
  return lines.join("\n");
}
