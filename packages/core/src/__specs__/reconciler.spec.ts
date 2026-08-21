/**
 * Tests reconciler behavior.
 *
 * Inputs: Imported dependencies and values passed to the module's documented functions.
 * Outputs: Exported types, values, and behavior provided by the module.
 * Errors: Functions document validation, dependency, and runtime errors individually.
 *
 * @packageDocumentation
 */

import { TYPE_DERIVED_POLICIES } from "@entellix/contracts/reconciler";
import type { MemoryType } from "@entellix/contracts/reconciler";
import { describe, expect, it } from "vitest";

import {
  MAX_CANONICAL_CONTENT_LENGTH,
  assertDirectiveByteEquality,
  canonicalizeContent,
  deriveRowPolicies,
  isReconcilerError,
  selectOperation,
} from "../reconciler.ts";

/**
 * Unit surface for the reconciler's pure parts (no PostgreSQL, HTTP, or model).
 * Exercises canonicalization, type-to-policy derivation, operation
 * selection from conflict annotations, and the verbatim byte-equality carve-out.
 * The assertions pin the implemented pure rules and typed guard failures.
 */

const A_UUID = "00000000-0000-4000-8000-0000000000f1";
const B_UUID = "00000000-0000-4000-8000-0000000000f2";

// ---------------------------------------------------------------------------
// TYPE_DERIVED_POLICIES — executable type-derived policy contract.
// ---------------------------------------------------------------------------

describe("TYPE_DERIVED_POLICIES — type-derived render/verbatim/ttl", () => {
  const ALL_TYPES: MemoryType[] = [
    "fact",
    "preference",
    "directive",
    "decision",
    "task_state",
    "procedure",
    "episodic_event",
    "observation",
    "policy",
  ];

  it("covers all nine memory types", () => {
    expect(Object.keys(TYPE_DERIVED_POLICIES).toSorted()).toEqual(ALL_TYPES.toSorted());
  });

  it("makes directive and policy verbatim and pinned", () => {
    for (const type of ["directive", "policy"] as const) {
      expect(TYPE_DERIVED_POLICIES[type].contentVerbatim).toBe(true);
      expect(TYPE_DERIVED_POLICIES[type].renderPolicy).toBe("pinned");
      expect(TYPE_DERIVED_POLICIES[type].defaultTtlDays).toBeNull();
    }
  });

  it("keeps non-verbatim types out of the verbatim/pinned carve-out", () => {
    for (const type of [
      "fact",
      "preference",
      "decision",
      "task_state",
      "procedure",
      "episodic_event",
      "observation",
    ] as const) {
      expect(TYPE_DERIVED_POLICIES[type].contentVerbatim).toBe(false);
    }
  });

  it("gives task_state a 14-day default ttl and everything else no ttl", () => {
    expect(TYPE_DERIVED_POLICIES.task_state.defaultTtlDays).toBe(14);
    for (const type of ALL_TYPES.filter((candidate) => candidate !== "task_state")) {
      expect(TYPE_DERIVED_POLICIES[type].defaultTtlDays).toBeNull();
    }
  });

  it("encodes observation as render_policy never (documented choice)", () => {
    expect(TYPE_DERIVED_POLICIES.observation.renderPolicy).toBe("never");
  });
});

// ---------------------------------------------------------------------------
// canonicalizeContent — non-verbatim normalization.
// ---------------------------------------------------------------------------

describe("canonicalizeContent — non-verbatim normalization", () => {
  it("trims and collapses internal whitespace runs for a fact", () => {
    expect(canonicalizeContent({ text: "  Acme   uses\n\nNext.js  ", memoryType: "fact" })).toBe(
      "Acme uses Next.js",
    );
  });

  it("collapses tabs and newlines to single spaces for a preference", () => {
    expect(canonicalizeContent({ text: "line one\n\tline two", memoryType: "preference" })).toBe(
      "line one line two",
    );
  });

  it("truncates over-cap content at a sentence boundary, never mid-word", () => {
    const sentence = "This is a deliberately padded sentence that adds length to the input.";
    const text = Array.from({ length: 20 }, () => sentence).join(" ");
    const result = canonicalizeContent({ text, memoryType: "fact" });

    expect(result.length).toBeLessThanOrEqual(MAX_CANONICAL_CONTENT_LENGTH);
    // Ends cleanly at sentence punctuation, no trailing partial word.
    expect(result).toMatch(/[.!?]$/);
    // No collapsed-away double spaces survive.
    expect(result).not.toMatch(/\s{2,}/);
    expect(result).toBe(result.trim());
    // The kept text is a leading portion of the normalized input.
    const normalized = text.replace(/\s+/gu, " ").trim();
    expect(normalized.startsWith(result)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Directive and policy verbatim byte-equality.
// ---------------------------------------------------------------------------

/**
 * ~20 deterministic "nasty" strings: leading/trailing/multiple spaces, tabs,
 * newlines, unicode, emoji, quotes. Built from a fixed base list plus fixed
 * transforms — no Math.random, so the property is reproducible run-to-run.
 */
const NASTY_BASES = [
  "never deploy on Fridays",
  "  leading and trailing spaces  ",
  "tabs\tand\tnewlines\nhere",
  "multiple   internal    spaces",
  "unicode café naïve résumé",
  "emoji 🚀 in the middle 🎯",
  "quotes \"double\" and 'single'",
  "trailing punctuation...",
  "CamelCase and snake_case tokens",
  "mixed\r\nCRLF line endings",
];
const NASTY_STRINGS: string[] = [
  ...NASTY_BASES,
  ...NASTY_BASES.map((base) => `From now on, ${base}`),
];

describe("canonicalizeContent — directive/policy verbatim passthrough", () => {
  for (const verbatimType of ["directive", "policy"] as const) {
    for (const [index, raw] of NASTY_STRINGS.entries()) {
      it(`returns ${verbatimType} input #${index} byte-for-byte`, () => {
        const stored = canonicalizeContent({ text: raw, memoryType: verbatimType });
        expect(stored).toBe(raw);
        // The stored bytes satisfy the verbatim guard.
        expect(() => assertDirectiveByteEquality(raw, stored)).not.toThrow();
      });
    }
  }
});

describe("assertDirectiveByteEquality — the verbatim carve-out guard (LIVE)", () => {
  it("does not throw when stored content is byte-identical", () => {
    for (const raw of NASTY_STRINGS) {
      expect(() => assertDirectiveByteEquality(raw, raw)).not.toThrow();
    }
  });

  it("throws a typed error on any single-character mutation", () => {
    const original = "never deploy to production on Fridays";
    // Mutate each position once; every mutation must be rejected.
    for (let position = 0; position < original.length; position += 1) {
      const mutated =
        original.slice(0, position) +
        (original[position] === "x" ? "y" : "x") +
        original.slice(position + 1);
      let thrown: unknown;
      try {
        assertDirectiveByteEquality(original, mutated);
      } catch (error) {
        thrown = error;
      }
      expect(isReconcilerError(thrown)).toBe(true);
      expect((thrown as { kind: string }).kind).toBe("directive_mutated");
    }
  });
});

// ---------------------------------------------------------------------------
// deriveRowPolicies — type to policy plus expires_at from TTL.
// ---------------------------------------------------------------------------

describe("deriveRowPolicies — render/verbatim/expires_at from type", () => {
  const NOW = new Date("2026-07-06T00:00:00.000Z");

  it("derives pinned + verbatim + no expiry for directive and policy", () => {
    for (const type of ["directive", "policy"] as const) {
      const derived = deriveRowPolicies(type, NOW);
      expect(derived.renderPolicy).toBe("pinned");
      expect(derived.contentVerbatim).toBe(true);
      expect(derived.expiresAt).toBeNull();
    }
  });

  it("derives retrieval + non-verbatim + no expiry for a fact", () => {
    const derived = deriveRowPolicies("fact", NOW);
    expect(derived.renderPolicy).toBe("retrieval");
    expect(derived.contentVerbatim).toBe(false);
    expect(derived.expiresAt).toBeNull();
  });

  it("sets task_state expires_at to now + 14 days via the injected clock", () => {
    const derived = deriveRowPolicies("task_state", NOW);
    expect(derived.expiresAt).not.toBeNull();
    expect(derived.expiresAt!.getTime()).toBe(NOW.getTime() + 14 * 24 * 60 * 60 * 1000);
  });

  it("encodes observation as render_policy never", () => {
    expect(deriveRowPolicies("observation", NOW).renderPolicy).toBe("never");
  });
});

// ---------------------------------------------------------------------------
// selectOperation — operation from conflict annotations.
// ---------------------------------------------------------------------------

describe("selectOperation — operation from conflict annotations", () => {
  it("ADDs when there is neither an annotation nor a guess", () => {
    expect(selectOperation({ conflictAnnotations: [] })).toEqual({ operation: "ADD" });
  });

  it("honors an upstream operation guess when unconflicted", () => {
    expect(
      selectOperation({ dispositionOperationGuess: "EXPIRE", conflictAnnotations: [] }),
    ).toEqual({ operation: "EXPIRE" });
  });

  it("SUPERSEDEs the target on a confident supersedes annotation", () => {
    expect(
      selectOperation({
        conflictAnnotations: [{ relation: "supersedes", memoryId: A_UUID, confidence: 0.9 }],
      }),
    ).toEqual({ operation: "SUPERSEDE", targetMemoryId: A_UUID });
  });

  it("MERGEs a materially-different duplicate into its target", () => {
    expect(
      selectOperation({
        conflictAnnotations: [
          { relation: "duplicates", memoryId: B_UUID, confidence: 0.8, materiallyDifferent: true },
        ],
      }),
    ).toEqual({ operation: "MERGE", targetMemoryId: B_UUID });
  });

  it("NOOPs an exact duplicate (no material difference)", () => {
    expect(
      selectOperation({
        conflictAnnotations: [
          { relation: "duplicates", memoryId: B_UUID, confidence: 0.8, materiallyDifferent: false },
        ],
      }),
    ).toEqual({ operation: "NOOP", targetMemoryId: B_UUID });
  });

  it("throws a typed error when a contradiction reaches the reconciler", () => {
    let thrown: unknown;
    try {
      selectOperation({
        conflictAnnotations: [{ relation: "contradicts", memoryId: A_UUID, confidence: 0.9 }],
      });
    } catch (error) {
      thrown = error;
    }
    expect(isReconcilerError(thrown)).toBe(true);
    expect((thrown as { kind: string }).kind).toBe("contradiction_not_auto_committable");
  });
});
