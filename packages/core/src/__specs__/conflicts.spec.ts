/**
 * Tests conflicts behavior.
 *
 * Inputs: Imported dependencies and values passed to the module's documented functions.
 * Outputs: Exported types, values, and behavior provided by the module.
 * Errors: Functions document validation, dependency, and runtime errors individually.
 *
 * @packageDocumentation
 */

import {
  CONFLICT_PROMPT_VERSION,
  CONFLICT_RATIONALE_MAX_LENGTH,
  type ConflictAnnotation,
  type Neighbor,
  conflictAnnotationSchema,
} from "@entellix/contracts/conflicts";
import { describe, expect, it, vi } from "vitest";

import {
  type ConflictDetectorConfig,
  type ConflictGenerateFn,
  type NeighborCandidate,
  SUPERSEDE_CONFIDENCE_THRESHOLD,
  buildNeighborQueryFilters,
  createConflictDetector,
  isConflictDetectorError,
  suggestOperation,
} from "../conflicts.ts";

/**
 * Unit surface for conflict detection. Exercises the pure operation
 * suggester, the pure neighbor-scope filter builder, and the pair classifier
 * with a FAKE generate() (the raw LLM call is injected) and hand-built neighbor
 * rows, so these must NOT touch Postgres, Supabase, an HTTP server, or a real
 * model. These assertions pin the implemented provider-neutral behavior.
 *
 * Pinned shape:
 *   createConflictDetector({ generate, config }) -> { classifyPairs({ candidate, neighbors }) }
 *     - parses generate() output with conflictClassificationOutputSchema
 *     - retries generate() exactly once on invalid output, else throws a typed error
 *     - returns [] without calling generate when there are no neighbors
 *   suggestOperation(annotations) -> { operation, targetMemoryId, relation } (PURE)
 *   buildNeighborQueryFilters(candidate) -> { ownerScopeType, ownerScopeId, entityIds, status:'active', limit }
 */

const CONFIG: ConflictDetectorConfig = {
  model: "fake-small-model",
  promptVersion: CONFLICT_PROMPT_VERSION,
};

// Stable uuids so annotations/neighbors reference real-shaped ids.
const CANDIDATE_ID = "00000000-0000-4000-8000-0000000000c0";
const WEBFLOW_MEMORY_ID = "00000000-0000-4000-8000-0000000000c1";
const CONCISE_MEMORY_ID = "00000000-0000-4000-8000-0000000000c2";
const DUP_MEMORY_ID = "00000000-0000-4000-8000-0000000000c3";
const FOREIGN_MEMORY_ID = "00000000-0000-4000-8000-0000000000cf";
const OWNER_USER_ID = "00000000-0000-4000-8000-0000000000d0";
const ACME_ENTITY_ID = "00000000-0000-4000-8000-0000000000e0";

/**
 * Executes neighbor.
 *
 * @param overrides - Value supplied for `overrides`.
 * @returns The result produced by `neighbor`.
 * @throws Errors raised by validation or dependent operations.
 */
function neighbor(overrides: Partial<Neighbor> & Pick<Neighbor, "memoryId" | "content">): Neighbor {
  return {
    memoryType: "fact",
    ownerScopeType: "user",
    ownerScopeId: OWNER_USER_ID,
    entityIds: [ACME_ENTITY_ID],
    similarity: 0.9,
    ...overrides,
  };
}

/** Serialize a classifier response the way a well-behaved model would return it.
 *
 * @param annotations - Value supplied for `annotations`.
 * @returns The result produced by `modelOutput`.
 * @throws Errors raised by validation or dependent operations.
 */
function modelOutput(annotations: unknown[]): string {
  return JSON.stringify({ annotations });
}

/**
 * Executes annotation.
 *
 * @param overrides - Value supplied for `overrides`.
 * @returns The result produced by `annotation`.
 * @throws Errors raised by validation or dependent operations.
 */
function annotation(overrides: Partial<ConflictAnnotation> = {}): ConflictAnnotation {
  return {
    candidateId: CANDIDATE_ID,
    existingMemoryId: WEBFLOW_MEMORY_ID,
    relation: "supersedes",
    confidence: 0.95,
    rationale: "Same subject, new state replaces the old.",
    ...overrides,
  };
}

describe("suggestOperation — canonical supersession", () => {
  it("maps a confident supersedes to SUPERSEDE with the neighbor as target", () => {
    // "Acme uses Next.js" superseding active "Acme uses Webflow".
    const suggestion = suggestOperation([
      annotation({ relation: "supersedes", existingMemoryId: WEBFLOW_MEMORY_ID, confidence: 0.95 }),
    ]);

    expect(suggestion.operation).toBe("SUPERSEDE");
    expect(suggestion.targetMemoryId).toBe(WEBFLOW_MEMORY_ID);
    expect(suggestion.relation).toBe("supersedes");
  });
});

describe("suggestOperation — uncertain supersedes falls back to review", () => {
  it("maps a below-threshold supersedes to REVIEW (never a silent ADD next to the old row)", () => {
    const suggestion = suggestOperation([
      annotation({
        relation: "supersedes",
        existingMemoryId: WEBFLOW_MEMORY_ID,
        confidence: SUPERSEDE_CONFIDENCE_THRESHOLD - 0.1,
      }),
    ]);

    expect(suggestion.operation).toBe("REVIEW");
    expect(suggestion.targetMemoryId).toBe(WEBFLOW_MEMORY_ID);
    expect(suggestion.relation).toBe("supersedes");
  });
});

describe("suggestOperation — preference contradiction goes to review", () => {
  it("maps a contradicts to REVIEW (contextual preferences are never auto-resolved)", () => {
    // "Ted prefers detailed answers" vs active "Ted prefers concise answers".
    const suggestion = suggestOperation([
      annotation({
        relation: "contradicts",
        existingMemoryId: CONCISE_MEMORY_ID,
        confidence: 0.9,
        rationale: "Opposing standing preferences; durability unclear.",
      }),
    ]);

    expect(suggestion.operation).toBe("REVIEW");
    expect(suggestion.relation).toBe("contradicts");
  });
});

describe("suggestOperation — duplicate suggests merge/no-op with target", () => {
  it("maps a duplicates to MERGE or NOOP carrying the target memory id", () => {
    const suggestion = suggestOperation([
      annotation({ relation: "duplicates", existingMemoryId: DUP_MEMORY_ID, confidence: 0.99 }),
    ]);

    expect(["MERGE", "NOOP"]).toContain(suggestion.operation);
    expect(suggestion.targetMemoryId).toBe(DUP_MEMORY_ID);
    expect(suggestion.relation).toBe("duplicates");
  });
});

describe("suggestOperation — no conflict yields a plain ADD", () => {
  it("maps only-coexists annotations to ADD with no target", () => {
    const suggestion = suggestOperation([annotation({ relation: "coexists", confidence: 0.8 })]);

    expect(suggestion.operation).toBe("ADD");
    expect(suggestion.targetMemoryId).toBeNull();
  });

  it("maps an empty annotation set (no neighbors) to ADD with no target", () => {
    const suggestion = suggestOperation([]);

    expect(suggestion.operation).toBe("ADD");
    expect(suggestion.targetMemoryId).toBeNull();
    expect(suggestion.relation).toBeNull();
  });
});

describe("buildNeighborQueryFilters — owner scope + entity overlap + active only", () => {
  it("constrains to the candidate owner scope, its entity links, and status active", () => {
    const candidate: NeighborCandidate = {
      text: "Acme uses Next.js",
      ownerScopeType: "user",
      ownerScopeId: OWNER_USER_ID,
      entityIds: [ACME_ENTITY_ID],
    };

    const filters = buildNeighborQueryFilters(candidate);

    expect(filters.status).toBe("active");
    expect(filters.ownerScopeType).toBe("user");
    expect(filters.ownerScopeId).toBe(OWNER_USER_ID);
    expect(filters.entityIds).toEqual([ACME_ENTITY_ID]);
  });
});

describe("createConflictDetector — pair classification with a single retry", () => {
  const candidate = { id: CANDIDATE_ID, text: "Acme uses Next.js" };
  const neighbors = [neighbor({ memoryId: WEBFLOW_MEMORY_ID, content: "Acme uses Webflow" })];

  it("classifies a supersession pair and stamps the candidate id onto the annotation", async () => {
    const generate = vi.fn<ConflictGenerateFn>(async () =>
      modelOutput([
        {
          existingMemoryId: WEBFLOW_MEMORY_ID,
          relation: "supersedes",
          confidence: 0.95,
          rationale: "Stack change: Next.js replaces Webflow for Acme.",
        },
      ]),
    );

    const detector = createConflictDetector({ generate, config: CONFIG });
    const annotations = await detector.classifyPairs({ candidate, neighbors });

    expect(annotations).toHaveLength(1);
    expect(annotations[0]!.candidateId).toBe(CANDIDATE_ID);
    expect(annotations[0]!.existingMemoryId).toBe(WEBFLOW_MEMORY_ID);
    expect(annotations[0]!.relation).toBe("supersedes");
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it("does not call the model when there are no neighbors", async () => {
    const generate = vi.fn<ConflictGenerateFn>(async () => modelOutput([]));
    const detector = createConflictDetector({ generate, config: CONFIG });

    const annotations = await detector.classifyPairs({ candidate, neighbors: [] });

    expect(annotations).toEqual([]);
    expect(generate).not.toHaveBeenCalled();
  });

  it("retries once on malformed output and succeeds (generate called exactly twice)", async () => {
    const good = modelOutput([
      {
        existingMemoryId: WEBFLOW_MEMORY_ID,
        relation: "supersedes",
        confidence: 0.95,
        rationale: "Next.js replaces Webflow.",
      },
    ]);
    const generate = vi
      .fn<ConflictGenerateFn>()
      .mockResolvedValueOnce("not json at all")
      .mockResolvedValueOnce(good);

    const detector = createConflictDetector({ generate, config: CONFIG });
    const annotations = await detector.classifyPairs({ candidate, neighbors });

    expect(annotations).toHaveLength(1);
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it("throws a typed error after two malformed responses and never calls generate a third time", async () => {
    const generate = vi
      .fn<ConflictGenerateFn>()
      .mockResolvedValueOnce("{ not valid")
      .mockResolvedValueOnce("{ still not valid")
      .mockResolvedValue(
        modelOutput([
          {
            existingMemoryId: WEBFLOW_MEMORY_ID,
            relation: "supersedes",
            confidence: 0.5,
            rationale: "unreachable",
          },
        ]),
      );

    const detector = createConflictDetector({ generate, config: CONFIG });

    await expect(detector.classifyPairs({ candidate, neighbors })).rejects.toSatisfy(
      isConflictDetectorError,
    );
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it("rejects an out-of-range confidence as invalid model output", async () => {
    // confidence must be within [0,1]; a well-behaved retry cannot save a
    // schema-violating value, so this should surface the typed error.
    const outOfRange = modelOutput([
      {
        existingMemoryId: WEBFLOW_MEMORY_ID,
        relation: "supersedes",
        confidence: 1.7,
        rationale: "confidence above one",
      },
    ]);
    const generate = vi.fn<ConflictGenerateFn>().mockResolvedValue(outOfRange);

    const detector = createConflictDetector({ generate, config: CONFIG });

    await expect(detector.classifyPairs({ candidate, neighbors })).rejects.toSatisfy(
      isConflictDetectorError,
    );
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it("rejects every annotation whose memory id is absent from the exact supplied neighbor set", async () => {
    const hostile = modelOutput([
      {
        existingMemoryId: FOREIGN_MEMORY_ID,
        relation: "supersedes",
        confidence: 0.99,
        rationale: "Hostile model output tries to target an unseen tenant row.",
      },
    ]);
    const generate = vi.fn<ConflictGenerateFn>().mockResolvedValue(hostile);
    const detector = createConflictDetector({ generate, config: CONFIG });

    await expect(detector.classifyPairs({ candidate, neighbors })).rejects.toSatisfy(
      isConflictDetectorError,
    );
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it("accepts annotations only when every referenced id belongs to one of the supplied neighbors", async () => {
    const secondNeighbor = neighbor({
      memoryId: CONCISE_MEMORY_ID,
      content: "Ted prefers concise answers",
    });
    const generate = vi.fn<ConflictGenerateFn>(async () =>
      modelOutput([
        {
          existingMemoryId: WEBFLOW_MEMORY_ID,
          relation: "supersedes",
          confidence: 0.95,
          rationale: "New stack replaces the old stack.",
        },
        {
          existingMemoryId: CONCISE_MEMORY_ID,
          relation: "coexists",
          confidence: 0.8,
          rationale: "Different subject.",
        },
      ]),
    );
    const detector = createConflictDetector({ generate, config: CONFIG });

    const annotations = await detector.classifyPairs({
      candidate,
      neighbors: [...neighbors, secondNeighbor],
    });

    expect(annotations.map((item) => item.existingMemoryId)).toEqual([
      WEBFLOW_MEMORY_ID,
      CONCISE_MEMORY_ID,
    ]);
  });
});

describe("conflict rationale — short by construction", () => {
  it("rejects an annotation whose rationale exceeds the contract max length", () => {
    const tooLong = "x".repeat(CONFLICT_RATIONALE_MAX_LENGTH + 1);
    const result = conflictAnnotationSchema.safeParse(annotation({ rationale: tooLong }));
    expect(result.success).toBe(false);
  });

  it("accepts a short, in-range annotation", () => {
    const result = conflictAnnotationSchema.safeParse(annotation());
    expect(result.success).toBe(true);
  });
});
