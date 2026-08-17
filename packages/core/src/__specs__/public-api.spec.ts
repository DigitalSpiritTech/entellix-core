import { describe, expect, it } from "vitest";

import { createClassifier } from "../classifier.ts";
import { createConflictDetector, suggestOperation } from "../conflicts.ts";
import { resolveDirectives } from "../directive-precedence.ts";
import { canCreateDirective } from "../directives.ts";
import { createExtractor, createExtractorEffect } from "../extractor.ts";
import { extractJsonText } from "../model-output.ts";
import { composeMemoryPacket, verifyContextEnvelope } from "../packet/index.ts";
import { evaluateDisposition } from "../policy-matrix.ts";
import { canonicalizeContent, selectOperation } from "../reconciler.ts";
import {
  RETRIEVAL_CONFIG_V1,
  evaluateExclusionCase,
  fuseAndRank,
  laneHitContributions,
} from "../retrieval/index.ts";
import { decideRoute, detectHotTriggers } from "../salience.ts";

describe("@entellix/core public boundary", () => {
  it("exports the first provider- and persistence-independent engine primitives", () => {
    expect(RETRIEVAL_CONFIG_V1.version).toBe("retrieval-config-v4");
    expect(fuseAndRank).toBeTypeOf("function");
    expect(laneHitContributions).toBeTypeOf("function");
    expect(evaluateExclusionCase).toBeTypeOf("function");
    expect(canCreateDirective).toBeTypeOf("function");
    expect(createClassifier).toBeTypeOf("function");
    expect(createExtractor).toBeTypeOf("function");
    expect(createExtractorEffect).toBeTypeOf("function");
    expect(extractJsonText).toBeTypeOf("function");
    expect(resolveDirectives).toBeTypeOf("function");
    expect(composeMemoryPacket).toBeTypeOf("function");
    expect(verifyContextEnvelope).toBeTypeOf("function");
    expect(evaluateDisposition).toBeTypeOf("function");
    expect(detectHotTriggers).toBeTypeOf("function");
    expect(decideRoute).toBeTypeOf("function");
    expect(createConflictDetector).toBeTypeOf("function");
    expect(suggestOperation).toBeTypeOf("function");
    expect(canonicalizeContent).toBeTypeOf("function");
    expect(selectOperation).toBeTypeOf("function");
  });
});
