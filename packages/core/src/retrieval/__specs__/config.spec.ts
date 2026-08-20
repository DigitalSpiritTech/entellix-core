/**
 * Tests config behavior.
 *
 * Inputs: Imported dependencies and values passed to the module's documented functions.
 * Outputs: Exported types, values, and behavior provided by the module.
 * Errors: Functions document validation, dependency, and runtime errors individually.
 *
 * @packageDocumentation
 */

import { describe, expect, it } from "vitest";

// RED (S3.1.2 DoD "adjustment config documented (versioned)"): the versioned
// retrieval config module does not exist yet. This pins the shape and the
// load-bearing values of `RETRIEVAL_CONFIG_V1` and its Zod validator so the
// fusion pipeline reads tunables from ONE audited, versioned place rather than
// scattered magic numbers. Import fails until
// `@entellix/core/retrieval/config` exports `RETRIEVAL_CONFIG_V1` and
// `retrievalConfigSchema`.
import { RETRIEVAL_CONFIG_V1, retrievalConfigSchema } from "../config.ts";

/**
 * Contract under test (config.ts):
 *
 *   retrievalConfigSchema: z.ZodType   // validates the object below
 *   type RetrievalConfig = z.infer<typeof retrievalConfigSchema>
 *   RETRIEVAL_CONFIG_V1: RetrievalConfig = {
 *     version: string,                 // non-empty version tag (audit trail)
 *     rrfK: 60,
 *     boosts: {
 *       scopeMatch: number>=0,
 *       entityMatch: number>=0,
 *       pin: number>=0,
 *       recency: number>=0,
 *     },
 *     recencyHalfLifeMsByType: Record<string, number|null>,
 *       // per memory-type recency half-life in ms; null == no recency decay.
 *       // task_state decays fast (small half-life), fact decays slow (large
 *       // half-life), directive has none (null).
 *     rerankEnabled: false,            // rerank hook stubbed OFF by default
 *   }
 */
describe("RETRIEVAL_CONFIG_V1", () => {
  it("validates against retrievalConfigSchema", () => {
    expect(() => retrievalConfigSchema.parse(RETRIEVAL_CONFIG_V1)).not.toThrow();
  });

  it("carries a non-empty version tag so tuning changes are auditable", () => {
    expect(typeof RETRIEVAL_CONFIG_V1.version).toBe("string");
    expect(RETRIEVAL_CONFIG_V1.version.length).toBeGreaterThan(0);
  });

  it("pins RRF k to 60", () => {
    expect(RETRIEVAL_CONFIG_V1.rrfK).toBe(60);
  });

  it("keeps the rerank hook OFF by default (enabled only if evals demand)", () => {
    expect(RETRIEVAL_CONFIG_V1.rerankEnabled).toBe(false);
  });

  it("defines positive boost weights for scope, entity and pin", () => {
    expect(RETRIEVAL_CONFIG_V1.boosts.scopeMatch).toBeGreaterThan(0);
    expect(RETRIEVAL_CONFIG_V1.boosts.entityMatch).toBeGreaterThan(0);
    expect(RETRIEVAL_CONFIG_V1.boosts.pin).toBeGreaterThan(0);
    expect(RETRIEVAL_CONFIG_V1.boosts.recency).toBeGreaterThan(0);
  });

  it("gives task_state a shorter recency half-life than fact (fast vs slow decay)", () => {
    const taskHalfLife = RETRIEVAL_CONFIG_V1.recencyHalfLifeMsByType.task_state;
    const factHalfLife = RETRIEVAL_CONFIG_V1.recencyHalfLifeMsByType.fact;
    expect(typeof taskHalfLife).toBe("number");
    expect(typeof factHalfLife).toBe("number");
    expect(taskHalfLife as number).toBeGreaterThan(0);
    expect(factHalfLife as number).toBeGreaterThan(0);
    expect(taskHalfLife as number).toBeLessThan(factHalfLife as number);
  });

  it("gives directives no recency decay (half-life null)", () => {
    expect(RETRIEVAL_CONFIG_V1.recencyHalfLifeMsByType.directive).toBeNull();
  });

  // Sprint 4.3 calibrates the semantic-distance gate against the expanded
  // Voyage-backed fixture set. A tuning change is auditable only with a bumped
  // config version and the fixture-preserving bound pinned here.
  it("bumps the version tag to retrieval-config-v4", () => {
    expect(RETRIEVAL_CONFIG_V1.version).toBe("retrieval-config-v4");
  });

  it("pins the calibrated maxCosineDistance to 0.6", () => {
    expect(RETRIEVAL_CONFIG_V1.maxCosineDistance).toBe(0.6);
  });

  it("defines a non-negative maxCosineDistance knob in a sane cosine range", () => {
    expect(RETRIEVAL_CONFIG_V1.maxCosineDistance).toBeDefined();
    expect(typeof RETRIEVAL_CONFIG_V1.maxCosineDistance).toBe("number");
    // Cosine distance lives in [0, 2]; a usable bound is strictly positive.
    expect(RETRIEVAL_CONFIG_V1.maxCosineDistance).toBeGreaterThan(0);
    expect(RETRIEVAL_CONFIG_V1.maxCosineDistance).toBeLessThanOrEqual(2);
  });

  it("accepts a maxCosineDistance of 0 but rejects a negative one", () => {
    expect(() =>
      retrievalConfigSchema.parse({ ...RETRIEVAL_CONFIG_V1, maxCosineDistance: 0 }),
    ).not.toThrow();
    expect(() =>
      retrievalConfigSchema.parse({ ...RETRIEVAL_CONFIG_V1, maxCosineDistance: -1 }),
    ).toThrow(/maxCosineDistance/);
  });

  it("disables the superseded RRF relevanceFloor (now 0)", () => {
    expect(RETRIEVAL_CONFIG_V1.relevanceFloor).toBe(0);
  });

  it("defines a non-negative relevanceFloor knob", () => {
    expect(RETRIEVAL_CONFIG_V1.relevanceFloor).toBeDefined();
    expect(typeof RETRIEVAL_CONFIG_V1.relevanceFloor).toBe("number");
    expect(RETRIEVAL_CONFIG_V1.relevanceFloor).toBeGreaterThanOrEqual(0);
  });

  it("accepts a relevanceFloor of 0 but rejects a negative one", () => {
    expect(() =>
      retrievalConfigSchema.parse({ ...RETRIEVAL_CONFIG_V1, relevanceFloor: 0 }),
    ).not.toThrow();
    expect(() =>
      retrievalConfigSchema.parse({ ...RETRIEVAL_CONFIG_V1, relevanceFloor: -1 }),
    ).toThrow(/relevanceFloor/);
  });
});
