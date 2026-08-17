import type { SourceTrustClass } from "@entellix/contracts";
import type { DirectiveCreationContext } from "@entellix/contracts/directives";
import { DIRECTIVE_PACKET_CAP_DEFAULT } from "@entellix/contracts/directives";
import { describe, expect, it } from "vitest";

import {
  type DirectivePacketDirectiveInput,
  assertDirectiveRowInvariant,
  buildDirectivePacketBlock,
  canCreateDirective,
} from "../directives.ts";

/**
 * Core unit surface for S2.3.2 — the directive engine's PURE parts (no Postgres, no
 * model). Exercises the creation gate truth table, the packet-block line cap +
 * ranked overflow, verbatim byte-equality of pinned content, and the row
 * invariant (canCreateDirective / buildDirectivePacketBlock /
 * assertDirectiveRowInvariant).
 */

const uuid = (n: number): string => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;

// ---------------------------------------------------------------------------
// canCreateDirective — creation gate truth table (Decisions 10, 18).
// ---------------------------------------------------------------------------

function ctx(overrides: Partial<DirectiveCreationContext> = {}): DirectiveCreationContext {
  return {
    via: "pipeline",
    sourceTrustClass: "first_party",
    isFirstPersonExplicit: true,
    ...overrides,
  };
}

describe("canCreateDirective — creation gate truth table", () => {
  it("allows the review UI path unconditionally (trust/explicit irrelevant)", () => {
    const trusts: SourceTrustClass[] = ["first_party", "external_included", "integration"];
    for (const sourceTrustClass of trusts) {
      for (const isFirstPersonExplicit of [true, false]) {
        const result = canCreateDirective(
          ctx({ via: "review_ui", sourceTrustClass, isFirstPersonExplicit }),
        );
        expect(result.allowed).toBe(true);
        expect(result.forcedReview).toBe(false);
      }
    }
  });

  it("allows the pipeline path only for a first-party first-person explicit statement", () => {
    const result = canCreateDirective(
      ctx({ via: "pipeline", sourceTrustClass: "first_party", isFirstPersonExplicit: true }),
    );
    expect(result.allowed).toBe(true);
    expect(result.forcedReview).toBe(false);
  });

  it("forces review for a first-party but non-first-person pipeline statement (ambient)", () => {
    const result = canCreateDirective(
      ctx({ via: "pipeline", sourceTrustClass: "first_party", isFirstPersonExplicit: false }),
    );
    expect(result.forcedReview).toBe(true);
    expect(result.allowed).toBe(false);
  });

  it("forces review for external_included content proposing a rule, even if explicit", () => {
    const result = canCreateDirective(
      ctx({ via: "pipeline", sourceTrustClass: "external_included", isFirstPersonExplicit: true }),
    );
    expect(result.forcedReview).toBe(true);
    expect(result.allowed).toBe(false);
  });

  it("forces review for an integration-sourced rule proposal, even if explicit", () => {
    const result = canCreateDirective(
      ctx({ via: "pipeline", sourceTrustClass: "integration", isFirstPersonExplicit: true }),
    );
    expect(result.forcedReview).toBe(true);
    expect(result.allowed).toBe(false);
  });

  it("never yields a silently-allowed directive except the two legit paths", () => {
    const vias = ["pipeline", "review_ui"] as const;
    const trusts: SourceTrustClass[] = ["first_party", "external_included", "integration"];
    for (const via of vias) {
      for (const sourceTrustClass of trusts) {
        for (const isFirstPersonExplicit of [true, false]) {
          const result = canCreateDirective(ctx({ via, sourceTrustClass, isFirstPersonExplicit }));
          // Exactly one of allowed/forcedReview is set — no ambiguous/dropped state.
          expect(result.allowed).toBe(!result.forcedReview);

          const isLegit =
            via === "review_ui" ||
            (via === "pipeline" && sourceTrustClass === "first_party" && isFirstPersonExplicit);
          expect(result.allowed).toBe(isLegit);
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// buildDirectivePacketBlock — line cap + ranked overflow (PRD §9).
// ---------------------------------------------------------------------------

function directive(
  rank: number,
  overrides: Partial<DirectivePacketDirectiveInput> = {},
): DirectivePacketDirectiveInput {
  return {
    memoryId: uuid(rank + 1),
    content: `directive line for rank ${rank}`,
    precedenceRank: rank,
    title: `directive #${rank}`,
    ...overrides,
  };
}

/** Total content-line count across a set of pinned entries. */
function countLines(contents: string[]): number {
  return contents.reduce((sum, content) => sum + content.split("\n").length, 0);
}

describe("buildDirectivePacketBlock — cap + overflow", () => {
  it("pins 15 and overflows 5 by rank, listing overflow by title with a fetch hint", () => {
    const directives = Array.from({ length: 20 }, (_, rank) => directive(rank));
    const block = buildDirectivePacketBlock({ directives });

    expect(block.pinned).toHaveLength(DIRECTIVE_PACKET_CAP_DEFAULT);
    expect(block.overflow).toHaveLength(5);
    // Pinned are the lowest-rank (best precedence) directives 0..14.
    expect(block.pinned.map((entry) => entry.memoryId)).toEqual(
      Array.from({ length: 15 }, (_, rank) => uuid(rank + 1)),
    );
    // Overflow are the highest-rank 15..19, listed by title.
    expect(block.overflow.map((entry) => entry.title)).toEqual(
      Array.from({ length: 5 }, (_, i) => `directive #${15 + i}`),
    );
    // Fetch hint present (non-empty) when something overflowed.
    expect(block.fetchHint.length).toBeGreaterThan(0);
  });

  it("counts REAL content lines, not directive count, against the cap", () => {
    // rank 0 is a 3-line directive; twelve 1-line directives follow (3 + 12 = 15
    // = cap). The 14th directive (rank 13) is a 1-liner that must overflow.
    const multiLine = directive(0, { content: "line one\nline two\nline three" });
    const oneLiners = Array.from({ length: 13 }, (_, i) => directive(i + 1));
    const block = buildDirectivePacketBlock({ directives: [multiLine, ...oneLiners] });

    // 13 directives pinned (1 three-line + 12 one-line) == 15 lines exactly.
    expect(block.pinned).toHaveLength(13);
    expect(countLines(block.pinned.map((entry) => entry.content))).toBe(
      DIRECTIVE_PACKET_CAP_DEFAULT,
    );
    // The last one-liner (rank 13) overflowed.
    expect(block.overflow).toHaveLength(1);
    expect(block.overflow[0]!.title).toBe("directive #13");
  });

  it("respects a caller-supplied cap override", () => {
    const directives = Array.from({ length: 10 }, (_, rank) => directive(rank));
    const block = buildDirectivePacketBlock({ directives, cap: 5 });

    expect(block.pinned).toHaveLength(5);
    expect(block.overflow).toHaveLength(5);
    expect(block.fetchHint.length).toBeGreaterThan(0);
  });

  it("sorts by precedenceRank before capping (input order does not matter)", () => {
    const shuffled = [directive(3), directive(0), directive(2), directive(1)];
    const block = buildDirectivePacketBlock({ directives: shuffled, cap: 2 });

    expect(block.pinned.map((entry) => entry.memoryId)).toEqual([uuid(1), uuid(2)]);
    expect(block.overflow.map((entry) => entry.title)).toEqual(["directive #2", "directive #3"]);
  });

  it("returns an empty block with no fetch hint for zero directives", () => {
    const block = buildDirectivePacketBlock({ directives: [] });
    expect(block.pinned).toEqual([]);
    expect(block.overflow).toEqual([]);
    expect(block.fetchHint).toBe("");
  });

  it("emits no fetch hint when everything fits under the cap", () => {
    const directives = Array.from({ length: 3 }, (_, rank) => directive(rank));
    const block = buildDirectivePacketBlock({ directives });
    expect(block.pinned).toHaveLength(3);
    expect(block.overflow).toEqual([]);
    expect(block.fetchHint).toBe("");
  });

  it("carries the override annotation through onto the pinned entry", () => {
    const annotated = directive(0, {
      overrideAnnotation: "Project Acme requires Next.js — overrides the org rule for this project",
    });
    const block = buildDirectivePacketBlock({ directives: [annotated] });
    expect(block.pinned[0]!.overrideAnnotation).toBe(annotated.overrideAnnotation);
  });
});

// ---------------------------------------------------------------------------
// buildDirectivePacketBlock — pinned content is byte-verbatim (Decision 10).
// ---------------------------------------------------------------------------

const NASTY_BASES = [
  "never deploy on Fridays",
  "  leading and trailing spaces  ",
  "tabs\tand\tnewlines\nhere",
  "multiple   internal    spaces",
  "unicode café naïve résumé",
  "emoji 🚀 in the middle 🎯",
  "quotes \"double\" and 'single'",
  "trailing punctuation...",
  "mixed\r\nCRLF line endings",
];
const NASTY_STRINGS: string[] = [
  ...NASTY_BASES,
  ...NASTY_BASES.map((base) => `From now on, ${base}`),
];

describe("buildDirectivePacketBlock — verbatim pinned content", () => {
  for (const [index, raw] of NASTY_STRINGS.entries()) {
    it(`pins nasty content #${index} byte-for-byte`, () => {
      const block = buildDirectivePacketBlock({
        directives: [directive(0, { content: raw })],
        // Large cap so multi-line nasty strings still pin (line count ≥ raw lines).
        cap: 100,
      });
      expect(block.pinned).toHaveLength(1);
      expect(block.pinned[0]!.content).toBe(raw);
    });
  }
});

// ---------------------------------------------------------------------------
// assertDirectiveRowInvariant — directive/policy ⇒ verbatim + pinned.
// ---------------------------------------------------------------------------

describe("assertDirectiveRowInvariant — verbatim/pinned invariant", () => {
  it("accepts a well-formed directive and policy row", () => {
    for (const memoryType of ["directive", "policy"] as const) {
      expect(() =>
        assertDirectiveRowInvariant({ memoryType, contentVerbatim: true, renderPolicy: "pinned" }),
      ).not.toThrow();
    }
  });

  it("accepts a well-formed non-verbatim row", () => {
    expect(() =>
      assertDirectiveRowInvariant({
        memoryType: "fact",
        contentVerbatim: false,
        renderPolicy: "retrieval",
      }),
    ).not.toThrow();
  });

  it("rejects a directive that is not verbatim", () => {
    expect(() =>
      assertDirectiveRowInvariant({
        memoryType: "directive",
        contentVerbatim: false,
        renderPolicy: "pinned",
      }),
    ).toThrow(/invariant violated/);
  });

  it("rejects a directive whose render policy is not pinned", () => {
    expect(() =>
      assertDirectiveRowInvariant({
        memoryType: "directive",
        contentVerbatim: true,
        renderPolicy: "retrieval",
      }),
    ).toThrow(/invariant violated/);
  });

  it("rejects a policy row that is not verbatim/pinned", () => {
    expect(() =>
      assertDirectiveRowInvariant({
        memoryType: "policy",
        contentVerbatim: false,
        renderPolicy: "retrieval",
      }),
    ).toThrow(/invariant violated/);
  });

  it("rejects a non-verbatim type falsely claiming verbatim/pinned", () => {
    expect(() =>
      assertDirectiveRowInvariant({
        memoryType: "fact",
        contentVerbatim: true,
        renderPolicy: "pinned",
      }),
    ).toThrow(/invariant violated/);
  });
});
