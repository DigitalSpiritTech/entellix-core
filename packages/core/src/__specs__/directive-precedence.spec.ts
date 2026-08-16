import {
  SPECIFICITY_RANKS,
  type PrecedenceContext,
  type PrecedenceDirective,
} from "@entellix/contracts/directive-precedence";
import { describe, expect, it } from "vitest";

import {
  type ConflictCheck,
  type EntityContext,
  detectDirectConflict,
  rankSpecificity,
  renderDirectiveBlock,
  resolveDirectives,
} from "../directive-precedence.ts";

/**
 * Unit surface for S2.3.3 — directive precedence + override annotations. Pure
 * resolver + renderer + pair-conflict primitive, exercised with hand-built
 * directives and an INJECTED deterministic conflict check (no LLM, no Postgres,
 * no HTTP — see ai/testing.md).
 *
 * The ratified case (Decision 11, executable) is encoded here directly from the
 * golden set: `directive/no-nextjs-org` (org-general "never Next.js") vs
 * `directive/acme-requires-nextjs` (project-scoped "use Next.js on Acme"). In
 * Acme context the project rule wins WITH an override annotation and the org
 * rule is excluded; outside Acme the project rule is filtered by scope and the
 * org rule stands.
 */

const RANK = {
  task: SPECIFICITY_RANKS.indexOf("task"),
  project: SPECIFICITY_RANKS.indexOf("project"),
  client: SPECIFICITY_RANKS.indexOf("client"),
  org_general: SPECIFICITY_RANKS.indexOf("org_general"),
  user_general: SPECIFICITY_RANKS.indexOf("user_general"),
} as const;

// Stable, uuid-shaped ids.
const ORG_RULE_ID = "00000000-0000-4000-8000-000000000001";
const PROJECT_RULE_ID = "00000000-0000-4000-8000-000000000002";
const STYLE_RULE_ID = "00000000-0000-4000-8000-000000000003";
const CLIENT_RULE_ID = "00000000-0000-4000-8000-000000000004";
const OTHER_PROJECT_RULE_ID = "00000000-0000-4000-8000-000000000005";
const TASK_RULE_ID = "00000000-0000-4000-8000-000000000006";

const TIE_A_ID = "00000000-0000-4000-8000-000000000011";
const TIE_B_ID = "00000000-0000-4000-8000-000000000012";

const ACME_PROJECT_ID = "00000000-0000-4000-8000-0000000000a1";
const ACME_CLIENT_ID = "00000000-0000-4000-8000-0000000000a2";
const OTHER_PROJECT_ID = "00000000-0000-4000-8000-0000000000a3";
const ACME_TASK_ID = "00000000-0000-4000-8000-0000000000a4";

const ACTOR_USER_ID = "00000000-0000-4000-8000-0000000000b1";
const ORG_ID = "00000000-0000-4000-8000-0000000000c1";

function directive(
  overrides: Partial<PrecedenceDirective> & Pick<PrecedenceDirective, "memoryId">,
): PrecedenceDirective {
  return {
    content: "Some rule.",
    title: "Some rule",
    subjectEntityId: null,
    subjectEntityType: null,
    ownerScopeType: "org",
    sourceAuthority: "explicit",
    validFrom: "2026-01-01T00:00:00Z",
    audienceAllowed: true,
    ...overrides,
  };
}

/** org-general "Never use Next.js for new work." (golden: directive/no-nextjs-org). */
const orgRule = directive({
  memoryId: ORG_RULE_ID,
  content: "Never use Next.js for new work.",
  title: "Org standard: no Next.js",
  ownerScopeType: "org",
});

/** project-scoped "use Next.js on Acme" (golden: directive/acme-requires-nextjs). */
const projectRule = directive({
  memoryId: PROJECT_RULE_ID,
  content: "For the Acme redesign, use Next.js.",
  title: "Project Acme requires Next.js",
  subjectEntityId: ACME_PROJECT_ID,
  subjectEntityType: "project",
  ownerScopeType: "org",
  validFrom: "2026-02-01T00:00:00Z",
});

/** user-general interaction style (golden: directive/user-communication-style). */
const styleRule = directive({
  memoryId: STYLE_RULE_ID,
  content: "Always give me the TLDR first, then details.",
  title: "TLDR first",
  ownerScopeType: "user",
});

const acmeContext: EntityContext = {
  activeIds: [ACME_PROJECT_ID],
  ancestorsById: { [ACME_PROJECT_ID]: [ACME_CLIENT_ID] },
};

function context(overrides: Partial<PrecedenceContext> = {}): PrecedenceContext {
  return {
    actorUserId: ACTOR_USER_ID,
    activeOrgId: ORG_ID,
    activeEntityIds: [ACME_PROJECT_ID],
    channel: "packet",
    ...overrides,
  };
}

const pairKey = (a: string, b: string): string => [a, b].toSorted().join("|");

/** Deterministic semantic conflict check over an explicit set of id pairs. */
function conflictOn(pairs: Array<[string, string]>): ConflictCheck {
  const set = new Set(pairs.map(([a, b]) => pairKey(a, b)));
  return (a, b) => set.has(pairKey(a.memoryId, b.memoryId));
}

const RATIFIED_OVERRIDE_ANNOTATION =
  "Project Acme requires Next.js — overrides the org rule for this project";

function activeById(resolution: ReturnType<typeof resolveDirectives>, memoryId: string) {
  return resolution.active.find((entry) => entry.memoryId === memoryId);
}

describe("rankSpecificity — subject tier vs active context", () => {
  it("ranks an entity-scoped directive whose subject is active at its entity tier", () => {
    expect(rankSpecificity(projectRule, acmeContext)).toBe(RANK.project);
  });

  it("recognises a client-scoped rule via ancestor expansion of an active project", () => {
    const clientRule = directive({
      memoryId: CLIENT_RULE_ID,
      subjectEntityId: ACME_CLIENT_ID,
      subjectEntityType: "client",
      ownerScopeType: "org",
    });
    // ACME_CLIENT is an ANCESTOR of the active ACME_PROJECT → client tier applies.
    expect(rankSpecificity(clientRule, acmeContext)).toBe(RANK.client);
  });

  it("ranks a general org directive at org_general and a user directive at user_general", () => {
    expect(rankSpecificity(orgRule, acmeContext)).toBe(RANK.org_general);
    expect(rankSpecificity(styleRule, acmeContext)).toBe(RANK.user_general);
  });

  it("demotes an entity-scoped directive whose subject is NOT in the active context", () => {
    const otherProjectRule = directive({
      memoryId: OTHER_PROJECT_RULE_ID,
      subjectEntityId: OTHER_PROJECT_ID,
      subjectEntityType: "project",
      ownerScopeType: "org",
    });
    expect(rankSpecificity(otherProjectRule, acmeContext)).toBe(RANK.org_general);
  });
});

describe("detectDirectConflict — subject overlap AND injected semantics", () => {
  it("detects a conflict between a general org rule and an overlapping project rule", () => {
    expect(
      detectDirectConflict(orgRule, projectRule, conflictOn([[ORG_RULE_ID, PROJECT_RULE_ID]])),
    ).toBe(true);
  });

  it("reports no conflict when the injected semantic check says the rules do not oppose", () => {
    expect(
      detectDirectConflict(orgRule, styleRule, conflictOn([[ORG_RULE_ID, PROJECT_RULE_ID]])),
    ).toBe(false);
  });

  it("never conflicts two directives scoped to DIFFERENT entities, even if semantics say so", () => {
    const projectA = directive({
      memoryId: PROJECT_RULE_ID,
      subjectEntityId: ACME_PROJECT_ID,
      subjectEntityType: "project",
    });
    const projectB = directive({
      memoryId: OTHER_PROJECT_RULE_ID,
      subjectEntityId: OTHER_PROJECT_ID,
      subjectEntityType: "project",
    });
    expect(
      detectDirectConflict(
        projectA,
        projectB,
        conflictOn([[PROJECT_RULE_ID, OTHER_PROJECT_RULE_ID]]),
      ),
    ).toBe(false);
  });
});

describe("resolveDirectives — the ratified org-vs-project override case (Decision 11)", () => {
  it("in Acme context: project rule wins WITH override annotation, org rule excluded", () => {
    const resolution = resolveDirectives({
      directives: [orgRule, projectRule, styleRule],
      context: context({ activeEntityIds: [ACME_PROJECT_ID], channel: "packet" }),
      entityContext: acmeContext,
      conflictCheck: conflictOn([[ORG_RULE_ID, PROJECT_RULE_ID]]),
    });

    const activeIds = resolution.active.map((entry) => entry.memoryId);
    expect(activeIds).toContain(PROJECT_RULE_ID);
    expect(activeIds).toContain(STYLE_RULE_ID);
    expect(activeIds).not.toContain(ORG_RULE_ID);

    const project = activeById(resolution, PROJECT_RULE_ID);
    expect(project?.rank).toBe(RANK.project);
    expect(project?.overrideAnnotation).toBe(RATIFIED_OVERRIDE_ANNOTATION);

    // user-general style directive rides along everywhere, no override.
    expect(activeById(resolution, STYLE_RULE_ID)?.overrideAnnotation).toBeNull();

    // The conflict is DECIDED (more specific won), so no review is logged.
    expect(resolution.conflicts).toHaveLength(1);
    expect(resolution.conflicts[0]).toMatchObject({
      resolution: "more_specific_won",
    });
    expect(new Set(resolution.conflicts[0]!.memoryIds)).toEqual(
      new Set([PROJECT_RULE_ID, ORG_RULE_ID]),
    );
    expect(resolution.reviewLogEntries).toHaveLength(0);
  });

  it("outside Acme context: project rule filtered by scope, org rule stands (no override)", () => {
    const resolution = resolveDirectives({
      directives: [orgRule, projectRule, styleRule],
      context: context({ activeEntityIds: [], channel: "packet" }),
      entityContext: { activeIds: [], ancestorsById: {} },
      conflictCheck: conflictOn([[ORG_RULE_ID, PROJECT_RULE_ID]]),
    });

    const activeIds = resolution.active.map((entry) => entry.memoryId);
    expect(activeIds).toContain(ORG_RULE_ID);
    expect(activeIds).toContain(STYLE_RULE_ID);
    expect(activeIds).not.toContain(PROJECT_RULE_ID);

    expect(activeById(resolution, ORG_RULE_ID)?.overrideAnnotation).toBeNull();
    expect(resolution.conflicts).toHaveLength(0);
    expect(resolution.reviewLogEntries).toHaveLength(0);
  });
});

describe("resolveDirectives — tie-break chain at equal specificity", () => {
  const base = {
    subjectEntityId: null,
    subjectEntityType: null,
    ownerScopeType: "org",
  } as const;

  it("same rank → explicit source authority beats inferred", () => {
    const explicit = directive({ ...base, memoryId: TIE_A_ID, sourceAuthority: "explicit" });
    const inferred = directive({ ...base, memoryId: TIE_B_ID, sourceAuthority: "inferred" });
    const resolution = resolveDirectives({
      directives: [explicit, inferred],
      context: context(),
      entityContext: acmeContext,
      conflictCheck: conflictOn([[TIE_A_ID, TIE_B_ID]]),
    });

    const activeIds = resolution.active.map((entry) => entry.memoryId);
    expect(activeIds).toContain(TIE_A_ID);
    expect(activeIds).not.toContain(TIE_B_ID);
    expect(resolution.conflicts[0]?.resolution).toBe("tie_source_authority");
    expect(resolution.reviewLogEntries).toHaveLength(0);
  });

  it("same rank + same authority → later validFrom wins on recency", () => {
    const older = directive({
      ...base,
      memoryId: TIE_A_ID,
      sourceAuthority: "explicit",
      validFrom: "2026-01-01T00:00:00Z",
    });
    const newer = directive({
      ...base,
      memoryId: TIE_B_ID,
      sourceAuthority: "explicit",
      validFrom: "2026-03-01T00:00:00Z",
    });
    const resolution = resolveDirectives({
      directives: [older, newer],
      context: context(),
      entityContext: acmeContext,
      conflictCheck: conflictOn([[TIE_A_ID, TIE_B_ID]]),
    });

    const activeIds = resolution.active.map((entry) => entry.memoryId);
    expect(activeIds).toContain(TIE_B_ID);
    expect(activeIds).not.toContain(TIE_A_ID);
    expect(resolution.conflicts[0]?.resolution).toBe("tie_recency");
    expect(resolution.reviewLogEntries).toHaveLength(0);
  });

  it("same rank + authority + recency → unresolvable: BOTH render, conflict noted, review logged", () => {
    const a = directive({
      ...base,
      memoryId: TIE_A_ID,
      sourceAuthority: "explicit",
      validFrom: "2026-01-01T00:00:00Z",
    });
    const b = directive({
      ...base,
      memoryId: TIE_B_ID,
      sourceAuthority: "explicit",
      validFrom: "2026-01-01T00:00:00Z",
    });
    const resolution = resolveDirectives({
      directives: [a, b],
      context: context(),
      entityContext: acmeContext,
      conflictCheck: conflictOn([[TIE_A_ID, TIE_B_ID]]),
    });

    const activeIds = resolution.active.map((entry) => entry.memoryId);
    expect(activeIds).toContain(TIE_A_ID);
    expect(activeIds).toContain(TIE_B_ID);
    expect(resolution.conflicts[0]?.resolution).toBe("unresolved");
    expect(resolution.reviewLogEntries).toHaveLength(1);
    expect(resolution.reviewLogEntries[0]).toMatchObject({ kind: "directive_conflict" });
    expect(new Set(resolution.reviewLogEntries[0]!.memoryIds)).toEqual(
      new Set([TIE_A_ID, TIE_B_ID]),
    );
  });
});

describe("resolveDirectives — audience filter", () => {
  it("drops an audience-disallowed directive regardless of how specific it is", () => {
    // task-scoped is the MOST specific tier, but the caller may not see it.
    const secretTaskRule = directive({
      memoryId: TASK_RULE_ID,
      subjectEntityId: ACME_TASK_ID,
      subjectEntityType: "task",
      ownerScopeType: "org",
      audienceAllowed: false,
    });
    const resolution = resolveDirectives({
      directives: [secretTaskRule, styleRule],
      context: context({ activeEntityIds: [ACME_TASK_ID] }),
      entityContext: { activeIds: [ACME_TASK_ID], ancestorsById: {} },
      conflictCheck: conflictOn([]),
    });

    const activeIds = resolution.active.map((entry) => entry.memoryId);
    expect(activeIds).not.toContain(TASK_RULE_ID);
    expect(activeIds).toContain(STYLE_RULE_ID);
  });
});

describe("renderDirectiveBlock — channel-aware, verbatim-preserving", () => {
  // Resolution shaped like the ratified case: project rule with an override
  // annotation, plus the user-general style rule.
  const resolution = {
    active: [
      {
        memoryId: PROJECT_RULE_ID,
        content: "For the Acme redesign, use Next.js.",
        rank: RANK.project,
        overrideAnnotation: RATIFIED_OVERRIDE_ANNOTATION,
      },
      {
        memoryId: STYLE_RULE_ID,
        content: "Always give me the TLDR first, then details.",
        rank: RANK.user_general,
        overrideAnnotation: null,
      },
    ],
    conflicts: [
      {
        memoryIds: [PROJECT_RULE_ID, ORG_RULE_ID] as [string, string],
        resolution: "more_specific_won" as const,
        note: "Project Acme rule overrides the org rule in this context.",
      },
    ],
    reviewLogEntries: [],
  };

  it("packet: verbatim content lines with override annotations as SEPARATE lines", () => {
    const block = renderDirectiveBlock({ resolution, channel: "packet" });
    expect(block).toMatchInlineSnapshot(`
      "Directives in effect:
      - For the Acme redesign, use Next.js.
        ↳ Project Acme requires Next.js — overrides the org rule for this project
      - Always give me the TLDR first, then details."
    `);
    // Verbatim bytes always present; annotation never merged into content.
    expect(block).toContain("For the Acme redesign, use Next.js.");
    expect(block).toContain("Always give me the TLDR first, then details.");
  });

  it("file: identical verbatim rendering to packet", () => {
    expect(renderDirectiveBlock({ resolution, channel: "file" })).toBe(
      renderDirectiveBlock({ resolution, channel: "packet" }),
    );
  });

  it("hook_injection: declarative framing AROUND the same verbatim bytes (Decision 12)", () => {
    const block = renderDirectiveBlock({ resolution, channel: "hook_injection" });
    expect(block).toMatchInlineSnapshot(`
      "Project information — the following operating rules are in effect:
      - Rule in effect: "For the Acme redesign, use Next.js."
        Note: Project Acme requires Next.js — overrides the org rule for this project
      - Rule in effect: "Always give me the TLDR first, then details.""
    `);
    // Same verbatim bytes present; framing is declarative, not imperative.
    expect(block).toContain("For the Acme redesign, use Next.js.");
    expect(block).toContain("Always give me the TLDR first, then details.");
  });
});
