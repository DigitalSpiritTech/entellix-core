/**
 * Tests compose behavior.
 *
 * Inputs: Imported dependencies and values passed to the module's documented functions.
 * Outputs: Exported types, values, and behavior provided by the module.
 * Errors: Functions document validation, dependency, and runtime errors individually.
 *
 * @packageDocumentation
 */

import type { Resolution } from "@entellix/contracts/directive-precedence";
import {
  PACKET_SECTIONS,
  contextEnvelopeSchema,
  memoryPacketSchema,
} from "@entellix/contracts/packet";
import type { EnvelopeMembership } from "@entellix/contracts/packet";
import { describe, expect, it } from "vitest";

import { renderDirectiveBlock } from "../../directive-precedence.ts";
// Verifies the Postgres-free contract for the pure memory-packet composer and
// server-side envelope verifier:
//   - `compose.ts` — composeMemoryPacket (pure), the char-based default token
//     estimator, and the packet header strings.
//   - `envelope.ts` — verifyContextEnvelope (pure),
//     which trusts the auth-derived actor + injected membership resolution and
//     NEVER the model-asserted org/entity ids.
//   - `packages/contracts/src/packet.ts` — memoryPacketSchema / contextEnvelope
//     Schema (+ the `@entellix/contracts/packet` subpath in package.json).
// Everything is a pure function over data with the estimator, `now`, and the
// membership resolver injected, so behaviour is provable without a DB.
import { PACKET_HEADERS, composeMemoryPacket, defaultEstimateTokens } from "../compose.ts";
import type {
  ComposeMemoryPacketInput,
  ProcedureInput,
  ProfileLineInput,
  RetrievedMemoryInput,
  TokenEstimator,
} from "../compose.ts";
import { verifyContextEnvelope } from "../envelope.ts";

/**
 * Pure interfaces pinned by these specs.
 *
 * compose.ts:
 *   type TokenEstimator = (text: string) => number
 *   const defaultEstimateTokens: TokenEstimator            // char-based
 *   const PACKET_HEADERS: { directives, userProfile, orgProfile,
 *                           memories, procedures, reconfirmations }
 *   interface ProfileLineInput  { memoryId; text }
 *   interface ProcedureInput    { memoryId; text }
 *   interface RetrievedMemoryInput {
 *     memoryId; memoryType: MemoryType|null; text; group?; reconfirm?: ReconfirmSignal
 *   }
 *   interface ComposeMemoryPacketInput {
 *     directives: Resolution                // resolveDirectives() output, reused
 *     userProfile: readonly ProfileLineInput[]
 *     orgProfile:  readonly ProfileLineInput[]
 *     memories:    readonly RetrievedMemoryInput[]
 *     procedures?: readonly ProcedureInput[]
 *     tokenBudget: number
 *     estimateTokens?: TokenEstimator       // default char-based
 *     now?: Date
 *   }
 *   composeMemoryPacket(input): MemoryPacket
 *
 * envelope.ts:
 *   interface VerifyContextEnvelopeInput {
 *     actorUserId: string                                  // from auth, trusted
 *     asserted: { orgId?: string|null; entityIds?: readonly string[] }  // NOT trusted
 *     resolveMembership: (userId) => readonly EnvelopeMembership[]        // injected
 *     resolveEntityIds?: (i: { orgId; candidateIds }) => readonly string[]
 *   }
 *   verifyContextEnvelope(input): VerifiedEnvelope
 *
 * Packet render order is fixed: (1) directives VERBATIM, (2) user profile,
 * (3) org profile, (4) grouped memories with ids, (5) procedures/lessons; with
 * reconfirmation prompts in their OWN trailing field. Truncation removes from the
 * BOTTOM (procedures → memories → org → user) and NEVER the directive block.
 */

// Stable uuid-shaped ids.
const DIRECTIVE_ID = "00000000-0000-4000-8000-000000000001";
const USER_A = "00000000-0000-4000-8000-0000000000a1";
const USER_B = "00000000-0000-4000-8000-0000000000a2";
const USER_C = "00000000-0000-4000-8000-0000000000a3";
const ORG_A = "00000000-0000-4000-8000-0000000000b1";
const ORG_B = "00000000-0000-4000-8000-0000000000b2";
const MEM_A = "00000000-0000-4000-8000-0000000000c1";
const MEM_B = "00000000-0000-4000-8000-0000000000c2";
const MEM_C = "00000000-0000-4000-8000-0000000000c3";
const MEM_D = "00000000-0000-4000-8000-0000000000c4";
const PROC_A = "00000000-0000-4000-8000-0000000000d1";
const PROC_B = "00000000-0000-4000-8000-0000000000d2";
const PROC_C = "00000000-0000-4000-8000-0000000000d3";
const STALE_MEM = "00000000-0000-4000-8000-0000000000e1";

const NOW = new Date("2026-07-07T00:00:00.000Z");

const RATIFIED_OVERRIDE_ANNOTATION =
  "Project Acme requires Next.js — overrides the org rule for this project";

// One resolved, render-ready directive with an override annotation — the exact
// shape resolveDirectives() emits (reused verbatim by the composer).
/**
 * Executes resolution.
 *
 * Inputs: None.
 * @returns The result produced by `resolution`.
 * @throws Errors raised by validation or dependent operations.
 */
function resolution(): Resolution {
  return {
    active: [
      {
        memoryId: DIRECTIVE_ID,
        content: "For the Acme redesign, use Next.js.",
        rank: 1,
        overrideAnnotation: RATIFIED_OVERRIDE_ANNOTATION,
      },
    ],
    conflicts: [],
    reviewLogEntries: [],
  };
}

const userProfile: ProfileLineInput[] = [
  { memoryId: USER_A, text: "Prefers the TLDR first, then details." },
  { memoryId: USER_B, text: "Works in the Pacific time zone." },
  { memoryId: USER_C, text: "Reviews PRs on Fridays." },
];

const orgProfile: ProfileLineInput[] = [
  { memoryId: ORG_A, text: "Acme ships on a two-week cadence." },
  { memoryId: ORG_B, text: "Acme standard runtime is Node 24." },
];

const memories: RetrievedMemoryInput[] = [
  { memoryId: MEM_A, memoryType: "fact", text: "The staging DB lives in us-east-1." },
  { memoryId: MEM_B, memoryType: "decision", text: "We chose pnpm over npm." },
  { memoryId: MEM_C, memoryType: "observation", text: "CI is flaky on the e2e shard." },
  { memoryId: MEM_D, memoryType: "task_state", text: "Auth refactor is in review." },
];

const procedures: ProcedureInput[] = [
  { memoryId: PROC_A, text: "Run db:setup before dev." },
  { memoryId: PROC_B, text: "Drain the ingest queue after import." },
  { memoryId: PROC_C, text: "Bump the config version on any tuning change." },
];

// Length-as-tokens estimator: makes budget arithmetic and the cost model
// (estimatedTokens === rendered length) directly observable in tests.
/**
 * Executes length tokens.
 *
 * @param text - Value supplied for `text`.
 * @returns The result produced by `lengthTokens`.
 * @throws Errors raised by validation or dependent operations.
 */
const lengthTokens: TokenEstimator = (text) => text.length;

/**
 * Executes full input.
 *
 * @param overrides - Value supplied for `overrides`.
 * @returns The result produced by `fullInput`.
 * @throws Errors raised by validation or dependent operations.
 */
function fullInput(overrides: Partial<ComposeMemoryPacketInput> = {}): ComposeMemoryPacketInput {
  return {
    directives: resolution(),
    userProfile,
    orgProfile,
    memories,
    procedures,
    tokenBudget: 100_000,
    estimateTokens: lengthTokens,
    now: NOW,
    ...overrides,
  };
}

/**
 * Executes memory count.
 *
 * @param packet - Value supplied for `packet`.
 * @returns The result produced by `memoryCount`.
 * @throws Errors raised by validation or dependent operations.
 */
function memoryCount(packet: ReturnType<typeof composeMemoryPacket>): number {
  return packet.memories.reduce((total, group) => total + group.memories.length, 0);
}

/**
 * Executes flat memory ids.
 *
 * @param packet - Value supplied for `packet`.
 * @returns The result produced by `flatMemoryIds`.
 * @throws Errors raised by validation or dependent operations.
 */
function flatMemoryIds(packet: ReturnType<typeof composeMemoryPacket>): string[] {
  return packet.memories.flatMap((group) => group.memories.map((memory) => memory.memoryId));
}

// Deterministic PRNG (mulberry32) for the truncation property test.
/**
 * Executes mulberry32.
 *
 * @param seed - Value supplied for `seed`.
 * @returns The result produced by `mulberry32`.
 * @throws Errors raised by validation or dependent operations.
 */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("packet contracts (packages/contracts/src/packet.ts)", () => {
  it("pins the ordered packet sections (with the pinned governance slice)", () => {
    expect(PACKET_SECTIONS).toEqual([
      "directives",
      "pinned",
      "user_profile",
      "org_profile",
      "memories",
      "procedures",
    ]);
  });

  it("a composed packet validates against memoryPacketSchema", () => {
    const packet = composeMemoryPacket(fullInput());
    expect(() => memoryPacketSchema.parse(packet)).not.toThrow();
  });

  it("a verified envelope validates against contextEnvelopeSchema", () => {
    const membership: EnvelopeMembership = {
      organizationId: ORG_A,
      role: "owner",
      status: "active",
    };
    const envelope = verifyContextEnvelope({
      actorUserId: USER_A,
      asserted: { orgId: ORG_A },
      /**
       * Resolves membership.
       *
       * Inputs: None.
       * @returns The result produced by `resolveMembership`.
       * @throws Errors raised by validation or dependent operations.
       */
      resolveMembership: () => [membership],
    });
    expect(() => contextEnvelopeSchema.parse(envelope)).not.toThrow();
  });
});

describe("composeMemoryPacket — fixed section order, directives verbatim first", () => {
  const packet = composeMemoryPacket(fullInput());

  it("renders the directive block VERBATIM and identical to renderDirectiveBlock", () => {
    const block = renderDirectiveBlock({ resolution: resolution(), channel: "packet" });
    expect(packet.directives.rendered).toBe(block);
    // Verbatim bytes + the separate override annotation are both preserved.
    expect(packet.directives.rendered).toContain("For the Acme redesign, use Next.js.");
    expect(packet.directives.rendered).toContain(RATIFIED_OVERRIDE_ANNOTATION);
    expect(packet.directives.lines[0]?.content).toBe("For the Acme redesign, use Next.js.");
    expect(packet.directives.lines[0]?.overrideAnnotation).toBe(RATIFIED_OVERRIDE_ANNOTATION);
  });

  it("places the sections in the exact fixed order in the rendered packet", () => {
    const order = [
      PACKET_HEADERS.directives,
      PACKET_HEADERS.userProfile,
      PACKET_HEADERS.orgProfile,
      PACKET_HEADERS.memories,
      PACKET_HEADERS.procedures,
    ].map((header) => packet.rendered.indexOf(header));

    // Every section header is present and strictly increasing (in order).
    for (const index of order) expect(index).toBeGreaterThanOrEqual(0);
    for (let i = 1; i < order.length; i += 1) expect(order[i]!).toBeGreaterThan(order[i - 1]!);

    // The directive block is the FIRST thing in the packet.
    expect(packet.rendered.startsWith(packet.directives.rendered)).toBe(true);
    // sectionOrder is a subsequence of PACKET_SECTIONS, directives first.
    expect(packet.sectionOrder[0]).toBe("directives");
    expect(packet.sectionOrder).toEqual(
      PACKET_SECTIONS.filter((section) => packet.sectionOrder.includes(section)),
    );
  });

  it("snapshots the fully-rendered packet (section-ordered)", () => {
    expect(packet.rendered).toMatchInlineSnapshot(`
      "Directives in effect:
      - For the Acme redesign, use Next.js.
        ↳ Project Acme requires Next.js — overrides the org rule for this project

      User profile:
      - Prefers the TLDR first, then details.
      - Works in the Pacific time zone.
      - Reviews PRs on Fridays.

      Organization profile:
      - Acme ships on a two-week cadence.
      - Acme standard runtime is Node 24.

      Relevant memories:
      General
      - The staging DB lives in us-east-1. [fact] (00000000-0000-4000-8000-0000000000c1)
      - We chose pnpm over npm. [decision] (00000000-0000-4000-8000-0000000000c2)
      - CI is flaky on the e2e shard. [observation] (00000000-0000-4000-8000-0000000000c3)
      - Auth refactor is in review. [task_state] (00000000-0000-4000-8000-0000000000c4)

      Procedures & lessons:
      - Run db:setup before dev.
      - Drain the ingest queue after import.
      - Bump the config version on any tuning change."
    `);
  });
});

describe("composeMemoryPacket — traceability & no confidence math exposed", () => {
  const packet = composeMemoryPacket(fullInput());

  it("carries every source memory id for traceability", () => {
    expect(packet.memoryIds).toEqual(
      expect.arrayContaining([
        DIRECTIVE_ID,
        USER_A,
        USER_B,
        USER_C,
        ORG_A,
        ORG_B,
        MEM_A,
        MEM_B,
        MEM_C,
        MEM_D,
        PROC_A,
        PROC_B,
        PROC_C,
      ]),
    );
    // Grouped retrieved memories each expose their id inline in the render.
    expect(packet.rendered).toContain(MEM_A);
    expect(flatMemoryIds(packet)).toEqual([MEM_A, MEM_B, MEM_C, MEM_D]);
  });

  it("exposes NO confidence/score fields anywhere in the packet", () => {
    const serialized = JSON.stringify(packet);
    expect(serialized).not.toMatch(/confidence/i);
    expect(serialized).not.toMatch(/"score"/i);
    // Each rendered memory carries only id/type/text — never a numeric signal.
    for (const group of packet.memories) {
      for (const memory of group.memories) {
        expect(Object.keys(memory).toSorted()).toEqual(["memoryId", "memoryType", "text"]);
      }
    }
  });
});

describe("composeMemoryPacket — reconfirmation prompts (stale / contradicted)", () => {
  it("surfaces a reconfirmation prompt in its OWN field without mutating the memory", () => {
    const staleMemory: RetrievedMemoryInput = {
      memoryId: STALE_MEM,
      memoryType: "fact",
      text: "The marketing site is built on Webflow.",
      reconfirm: { kind: "superseded", subject: "Website", was: "Webflow", now: "Next.js" },
    };
    const packet = composeMemoryPacket(fullInput({ memories: [staleMemory], procedures: [] }));

    expect(packet.reconfirmations).toHaveLength(1);
    expect(packet.reconfirmations[0]).toEqual({
      memoryId: STALE_MEM,
      prompt: "Website was marked Webflow; recent notes say Next.js — update?",
    });

    // The memory itself is rendered unchanged — the reconfirm signal never
    // mutates its text and never leaks into the packet memory shape.
    const rendered = packet.memories.flatMap((group) => group.memories);
    expect(rendered[0]?.text).toBe("The marketing site is built on Webflow.");
    expect(Object.keys(rendered[0] ?? {}).toSorted()).toEqual(["memoryId", "memoryType", "text"]);
  });

  it("surfaces a contradiction reconfirmation prompt", () => {
    const contradicted: RetrievedMemoryInput = {
      memoryId: STALE_MEM,
      memoryType: "decision",
      text: "Deploy target is Fly.io.",
      reconfirm: {
        kind: "contradicted",
        subject: "Deploy target",
        note: "a newer note says AWS",
      },
    };
    const packet = composeMemoryPacket(fullInput({ memories: [contradicted], procedures: [] }));
    expect(packet.reconfirmations[0]?.prompt).toBe(
      "Deploy target: a newer note says AWS — still accurate?",
    );
  });

  it("produces no reconfirmations when nothing is stale or contradicted", () => {
    const packet = composeMemoryPacket(fullInput());
    expect(packet.reconfirmations).toEqual([]);
  });
});

describe("composeMemoryPacket — token budget truncation from the BOTTOM", () => {
  it("keeps everything under a generous budget (nothing truncated)", () => {
    const packet = composeMemoryPacket(fullInput({ tokenBudget: 100_000 }));
    expect(packet.truncated).toBe(false);
    expect(packet.userProfile).toHaveLength(userProfile.length);
    expect(packet.orgProfile).toHaveLength(orgProfile.length);
    expect(memoryCount(packet)).toBe(memories.length);
    expect(packet.procedures).toHaveLength(procedures.length);
  });

  it("drops procedures FIRST (bottom section) when the budget is just too small for them", () => {
    // Budget = the exact cost of the same packet WITHOUT procedures. Including
    // procedures would overflow, so the composer must drop exactly that section.
    const withoutProcedures = composeMemoryPacket(fullInput({ procedures: [] }));
    const packet = composeMemoryPacket(
      fullInput({ tokenBudget: withoutProcedures.estimatedTokens }),
    );
    expect(packet.procedures).toEqual([]);
    expect(memoryCount(packet)).toBe(memories.length);
    expect(packet.orgProfile).toHaveLength(orgProfile.length);
    expect(packet.userProfile).toHaveLength(userProfile.length);
    expect(packet.truncated).toBe(true);
    expect(packet.rendered).toBe(withoutProcedures.rendered);
  });

  it("drops memories NEXT once procedures are gone", () => {
    const trimmed = composeMemoryPacket(fullInput({ memories: [], procedures: [] }));
    const packet = composeMemoryPacket(fullInput({ tokenBudget: trimmed.estimatedTokens }));
    expect(packet.procedures).toEqual([]);
    expect(memoryCount(packet)).toBe(0);
    expect(packet.orgProfile).toHaveLength(orgProfile.length);
    expect(packet.userProfile).toHaveLength(userProfile.length);
  });

  it("NEVER drops the directive block — even when it alone exceeds the budget", () => {
    const packet = composeMemoryPacket(fullInput({ tokenBudget: 0 }));
    // Directives always survive, verbatim.
    expect(packet.directives.lines).toHaveLength(1);
    expect(packet.directives.rendered).toContain("For the Acme redesign, use Next.js.");
    // Everything below the directive block is truncated away.
    expect(packet.userProfile).toEqual([]);
    expect(packet.orgProfile).toEqual([]);
    expect(memoryCount(packet)).toBe(0);
    expect(packet.procedures).toEqual([]);
    expect(packet.truncated).toBe(true);
    // The self-reported budget is the rendered length and may exceed a tiny
    // budget precisely because directives are never dropped.
    expect(packet.estimatedTokens).toBe(packet.rendered.length);
    expect(packet.estimatedTokens).toBeGreaterThan(0);
  });

  it("property: truncation removes strictly from the bottom, directives immovable", () => {
    const base = fullInput({ estimateTokens: lengthTokens });
    const directivesOnly = composeMemoryPacket({ ...base, tokenBudget: 0 }).estimatedTokens;
    const fullCost = composeMemoryPacket({ ...base, tokenBudget: 100_000 }).estimatedTokens;

    for (let seed = 1; seed <= 60; seed += 1) {
      const rand = mulberry32(seed);
      const budget = Math.floor(rand() * (fullCost + 20));
      const packet = composeMemoryPacket({ ...base, tokenBudget: budget });

      // Cost model is pinned: estimatedTokens is the rendered length.
      expect(packet.estimatedTokens).toBe(packet.rendered.length);
      // Directives are never dropped.
      expect(packet.directives.lines).toHaveLength(1);
      // The packet fits the budget unless the directive block alone overflows it.
      expect(packet.estimatedTokens).toBeLessThanOrEqual(Math.max(budget, directivesOnly));
      expect(packet.estimatedTokens).toBeGreaterThanOrEqual(directivesOnly);

      const counts = {
        user: packet.userProfile.length,
        org: packet.orgProfile.length,
        mem: memoryCount(packet),
        proc: packet.procedures.length,
      };
      const inputs = {
        user: userProfile.length,
        org: orgProfile.length,
        mem: memories.length,
        proc: procedures.length,
      };

      // Bottom-up truncation invariant: a lower section may carry content ONLY
      // when every section above it is fully included.
      expect(counts.proc === 0 || counts.mem === inputs.mem).toBe(true);
      expect(counts.mem === 0 || counts.org === inputs.org).toBe(true);
      expect(counts.org === 0 || counts.user === inputs.user).toBe(true);

      // Surviving items are always a prefix of their input (top-preserved order).
      for (let i = 0; i < counts.user; i += 1) {
        expect(packet.userProfile[i]?.memoryId).toBe(userProfile[i]?.memoryId);
      }
      for (let i = 0; i < counts.proc; i += 1) {
        expect(packet.procedures[i]?.memoryId).toBe(procedures[i]?.memoryId);
      }
    }
  });
});

describe("defaultEstimateTokens (char-based default)", () => {
  it("grows monotonically with text length and is used when no estimator is injected", () => {
    expect(defaultEstimateTokens("")).toBe(0);
    expect(defaultEstimateTokens("a longer piece of text")).toBeGreaterThan(
      defaultEstimateTokens("short"),
    );
    // Composing without an injected estimator must not throw (default applies).
    const packet = composeMemoryPacket({ ...fullInput(), estimateTokens: undefined });
    expect(packet.estimatedTokens).toBeGreaterThan(0);
  });
});

describe("verifyContextEnvelope — SERVER-verified, model assertions never trusted", () => {
  const activeGoodOrg: EnvelopeMembership = {
    organizationId: ORG_A,
    role: "owner",
    status: "active",
  };

  it("honours an asserted org the caller is actually an active member of", () => {
    const envelope = verifyContextEnvelope({
      actorUserId: USER_A,
      asserted: { orgId: ORG_A },
      /**
       * Resolves membership.
       *
       * Inputs: None.
       * @returns The result produced by `resolveMembership`.
       * @throws Errors raised by validation or dependent operations.
       */
      resolveMembership: () => [activeGoodOrg],
    });
    expect(envelope.actorUserId).toBe(USER_A);
    expect(envelope.orgId).toBe(ORG_A);
    expect(envelope.verified).toBe(true);
  });

  it("spoofing: a forged org id in the request loses to membership resolution", () => {
    const envelope = verifyContextEnvelope({
      actorUserId: USER_A,
      // The model asserts an org the caller does NOT belong to.
      asserted: { orgId: ORG_B },
      /**
       * Resolves membership.
       *
       * Inputs: None.
       * @returns The result produced by `resolveMembership`.
       * @throws Errors raised by validation or dependent operations.
       */
      resolveMembership: () => [activeGoodOrg],
    });
    // Server resolution wins: the good org, never the forged one.
    expect(envelope.orgId).toBe(ORG_A);
    expect(envelope.orgId).not.toBe(ORG_B);
  });

  it("rejects/ignores an absent membership (no active org → null scope)", () => {
    const envelope = verifyContextEnvelope({
      actorUserId: USER_A,
      asserted: { orgId: ORG_B },
      /**
       * Resolves membership.
       *
       * Inputs: None.
       * @returns The result produced by `resolveMembership`.
       * @throws Errors raised by validation or dependent operations.
       */
      resolveMembership: () => [],
    });
    expect(envelope.orgId).toBeNull();
    expect(envelope.entityIds).toEqual([]);
  });

  it("ignores a revoked membership (not an active org)", () => {
    const envelope = verifyContextEnvelope({
      actorUserId: USER_A,
      asserted: { orgId: ORG_A },
      /**
       * Resolves membership.
       *
       * Inputs: None.
       * @returns The result produced by `resolveMembership`.
       * @throws Errors raised by validation or dependent operations.
       */
      resolveMembership: () => [{ organizationId: ORG_A, role: "member", status: "revoked" }],
    });
    expect(envelope.orgId).toBeNull();
  });

  it("drops forged entity ids, keeping only server-resolved ones", () => {
    const entGood = "00000000-0000-4000-8000-0000000000f1";
    const entEvil = "00000000-0000-4000-8000-0000000000f2";
    const envelope = verifyContextEnvelope({
      actorUserId: USER_A,
      asserted: { orgId: ORG_A, entityIds: [entEvil, entGood] },
      /**
       * Resolves membership.
       *
       * Inputs: None.
       * @returns The result produced by `resolveMembership`.
       * @throws Errors raised by validation or dependent operations.
       */
      resolveMembership: () => [activeGoodOrg],
      /**
       * Resolves entity ids.
       *
       * @param input - Candidate entity identifiers supplied for verification.
       * @returns The result produced by `resolveEntityIds`.
       * @throws Errors raised by validation or dependent operations.
       */
      resolveEntityIds: (input) => input.candidateIds.filter((id) => id === entGood),
    });
    expect(envelope.entityIds).toEqual([entGood]);
    expect(envelope.entityIds).not.toContain(entEvil);
  });

  it("trusts NO asserted entity ids without a server-side entity resolver", () => {
    const entEvil = "00000000-0000-4000-8000-0000000000f2";
    const envelope = verifyContextEnvelope({
      actorUserId: USER_A,
      asserted: { orgId: ORG_A, entityIds: [entEvil] },
      /**
       * Resolves membership.
       *
       * Inputs: None.
       * @returns The result produced by `resolveMembership`.
       * @throws Errors raised by validation or dependent operations.
       */
      resolveMembership: () => [activeGoodOrg],
    });
    expect(envelope.entityIds).toEqual([]);
  });
});

// The composer includes an always-on `pinned` governance slice. `get_context`
// must always surface pinned non-directive governance memories on
// the first call regardless of query similarity, WITHOUT crowding out query
// recall. The slice behaves like the directive block (never truncated away) but
// carries its OWN sub-budget so a large pinned list can't starve `memories`.
// These specs pin the observable behaviour without hardcoding the sub-budget
// fraction; the developer chooses the fraction/const internally.
const PIN_A = "00000000-0000-4000-8000-0000000000e2";
const PIN_B = "00000000-0000-4000-8000-0000000000e3";

const pinnedGovernance: RetrievedMemoryInput[] = [
  { memoryId: PIN_A, memoryType: "fact", text: "All client data must stay in the EU region." },
  { memoryId: PIN_B, memoryType: "preference", text: "Never share source evidence externally." },
];

describe("composeMemoryPacket — always-on pinned governance slice", () => {
  it("always renders the pinned slice — even at a zero budget that drops every other section", () => {
    const packet = composeMemoryPacket({
      ...fullInput({ tokenBudget: 0 }),
      pinned: pinnedGovernance,
    });
    // Directives still survive verbatim.
    expect(packet.directives.lines).toHaveLength(1);
    // Every truncatable section below the top is dropped at a zero budget...
    expect(packet.userProfile).toEqual([]);
    expect(packet.orgProfile).toEqual([]);
    expect(memoryCount(packet)).toBe(0);
    expect(packet.procedures).toEqual([]);
    // ...but the guaranteed pinned slice is STILL present in the render, the ids,
    // and the section order — like the directive block, it is never truncated.
    expect(packet.rendered).toContain("All client data must stay in the EU region.");
    expect(packet.rendered).toContain("Never share source evidence externally.");
    expect(packet.memoryIds).toEqual(expect.arrayContaining([PIN_A, PIN_B]));
    expect(packet.sectionOrder).toContain("pinned");
    expect(packet.sectionOrder[0]).toBe("directives");
  });

  it("does not let a modest pinned slice crowd out query recall under a generous budget", () => {
    const withoutPinned = composeMemoryPacket(fullInput({ tokenBudget: 100_000 }));
    const withPinned = composeMemoryPacket({
      ...fullInput({ tokenBudget: 100_000 }),
      pinned: pinnedGovernance,
    });
    // The pinned governance slice renders alongside the query memories...
    expect(withPinned.rendered).toContain("All client data must stay in the EU region.");
    expect(withPinned.memoryIds).toEqual(expect.arrayContaining([PIN_A, PIN_B]));
    expect(withPinned.sectionOrder).toContain("pinned");
    // ...drawing on its OWN sub-budget: the query memories are untouched, so
    // recall is byte-for-byte identical to the no-pinned baseline.
    expect(memoryCount(withPinned)).toBe(memoryCount(withoutPinned));
    expect(flatMemoryIds(withPinned)).toEqual(flatMemoryIds(withoutPinned));
  });

  it("dedups pinned ids out of the normal memories groups (id surfaced once, via pinned)", () => {
    const packet = composeMemoryPacket({
      ...fullInput({ tokenBudget: 100_000 }),
      // MEM_A is ALSO a query memory; as a pinned id it must not double-render.
      pinned: [{ memoryId: MEM_A, memoryType: "fact", text: "The staging DB lives in us-east-1." }],
    });
    // The shared id is removed from the query memories groups...
    expect(flatMemoryIds(packet)).not.toContain(MEM_A);
    expect(flatMemoryIds(packet)).toEqual([MEM_B, MEM_C, MEM_D]);
    // ...but is still surfaced via the pinned slice.
    expect(packet.memoryIds).toContain(MEM_A);
    expect(packet.rendered).toContain("The staging DB lives in us-east-1.");
  });

  it("adds no pinned section and preserves today’s output when pinned is empty or undefined", () => {
    const baseline = composeMemoryPacket(fullInput());
    const undefinedPinned = composeMemoryPacket({ ...fullInput(), pinned: undefined });
    const emptyPinned = composeMemoryPacket({ ...fullInput(), pinned: [] });
    // No pinned section is introduced when there is nothing to pin.
    expect(undefinedPinned.sectionOrder).not.toContain("pinned");
    expect(emptyPinned.sectionOrder).not.toContain("pinned");
    // Backward compatible: an empty/undefined pinned slice is byte-identical to today.
    expect(emptyPinned.rendered).toBe(baseline.rendered);
    expect(emptyPinned.memoryIds).toEqual(baseline.memoryIds);
    expect(undefinedPinned.rendered).toBe(baseline.rendered);
  });
});
