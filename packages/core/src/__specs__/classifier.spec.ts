import type { MemoryCandidate } from "@entellix/contracts/candidates";
import {
  CLASSIFIER_PROMPT_VERSION,
  type ClassifierLlmOutput,
  classificationSchema,
} from "@entellix/contracts/classification";
import { describe, expect, it, vi } from "vitest";

import {
  type ClassifierConfig,
  type ClassifierDeps,
  type ClassifierGenerateFn,
  type ListMembershipsFn,
  type ResolvedEntity,
  type ResolveEntityFn,
  createClassifier,
  isClassifierError,
} from "../classifier.ts";

/**
 * Unit surface for S2.2.1 — the classifier suite. Exercises the classifier
 * factory in isolation with FAKE dependencies (generate(), resolveEntityFn,
 * listMembershipsFn all injected) and hand-built candidate rows, so these must
 * NOT touch Postgres, Supabase, an HTTP server, or a real model (ai/testing.md).
 * RED phase: createClassifier().classifyCandidate throws 'not implemented:
 * S2.2.1' — these assertions define the developer's target.
 *
 * Pinned behaviors the developer implements to satisfy these:
 *   createClassifier({ generate, config, resolveEntityFn, listMembershipsFn })
 *     -> { classifyCandidate({ candidate, context, registryAliasHints? }) }
 *   - owner + scopeDistribution come from the model, NEVER from context.activeOrgId
 *   - audience is a code-level heuristic over wording (+ membership/entity context)
 *   - entity mentions resolve to entityLinks; unknown aliases -> entityCreationCandidates
 *   - directive is downgraded unless explicit directive markers are present
 *   - sourceAuthority is mapped from context.sourceTrustClass
 *   - LLM output validated by classifierLlmOutputSchema, retried once, else typed error
 */

const CONFIG: ClassifierConfig = {
  model: "fake-small-model",
  promptVersion: CLASSIFIER_PROMPT_VERSION,
};

const USER_ID = "00000000-0000-4000-8000-000000000001";
const ORG_ID = "00000000-0000-4000-8000-0000000000d1";
const ACME_ENTITY_ID = "00000000-0000-4000-8000-0000000000c1";

let candidateSeq = 0;

/** A minimal but complete memory_candidates row for the classifier input. */
function candidate(
  candidateText: string,
  overrides: Partial<MemoryCandidate> = {},
): MemoryCandidate {
  candidateSeq += 1;
  return {
    id: `00000000-0000-4000-8000-${(0xf0 + candidateSeq).toString(16).padStart(12, "0")}`,
    batchId: "batch-1",
    sourceEventIds: ["00000000-0000-4000-8000-0000000000e1"],
    actorUserId: USER_ID,
    activeOrgId: ORG_ID,
    candidateText,
    provisionalType: "fact",
    evidenceSpan: candidateText,
    reasonSummary: "A candidate to classify.",
    status: "pending_classification",
    extractorVersion: "extractor/2026-07-06",
    model: "fake-small-model",
    createdAt: "2026-07-06T00:00:00.000Z",
    ...overrides,
  };
}

/** A valid ClassifierLlmOutput with overridable axes (the model's raw verdict). */
function llmOutput(overrides: Partial<ClassifierLlmOutput> = {}): ClassifierLlmOutput {
  return {
    memoryType: "fact",
    owner: { value: "user", confidence: 0.92 },
    scopeDistribution: [{ owner: "user", confidence: 1 }],
    entityMentions: [],
    audienceHint: "org_members",
    sensitivity: { level: "normal", aboutAnotherPerson: false },
    operationGuess: "ADD",
    confidence: 0.92,
    ...overrides,
  };
}

/** A generate() fake that returns one serialized model verdict. */
function generateReturning(output: ClassifierLlmOutput): ClassifierGenerateFn {
  return vi.fn<ClassifierGenerateFn>(async () => JSON.stringify(output));
}

/** A provider-neutral entity the resolver fake can hand back on a match. */
function entityRow(id: string, type: string, _name: string): ResolvedEntity {
  return { id, type };
}

/** Resolver that never matches — every alias becomes an entity-creation candidate. */
const resolveNone: ResolveEntityFn = async () => ({ kind: "none" });

/** Resolver that confidently matches anything looking like "Acme" to a project entity. */
const resolveAcmeProject: ResolveEntityFn = async (_ownerOrgId, name) =>
  /acme/i.test(name)
    ? { kind: "match", entity: entityRow(ACME_ENTITY_ID, "project", "Acme") }
    : { kind: "none" };

const listNoMemberships: ListMembershipsFn = async () => [];

function makeDeps(overrides: Partial<ClassifierDeps> = {}): ClassifierDeps {
  return {
    generate: generateReturning(llmOutput()),
    config: CONFIG,
    resolveEntityFn: resolveNone,
    listMembershipsFn: listNoMemberships,
    ...overrides,
  };
}

const firstPartyContext = {
  actorUserId: USER_ID,
  activeOrgId: ORG_ID,
  sourceTrustClass: "first_party" as const,
};

describe("classificationSchema — contract shape", () => {
  it("requires a non-empty scopeDistribution and bounds the audience basis", () => {
    const base = {
      memoryType: "fact" as const,
      owner: { value: "user" as const, confidence: 0.9 },
      entityLinks: [],
      entityCreationCandidates: [],
      audienceSuggestion: { kind: "private_to_owner" as const, basis: "I prefer wording" },
      sensitivity: { level: "normal" as const, aboutAnotherPerson: false },
      sourceAuthority: "explicit" as const,
      operationGuess: "ADD" as const,
      confidence: 0.9,
    };
    expect(classificationSchema.safeParse({ ...base, scopeDistribution: [] }).success).toBe(false);
    expect(
      classificationSchema.safeParse({
        ...base,
        scopeDistribution: [{ owner: "user", confidence: 1 }],
      }).success,
    ).toBe(true);
  });
});

describe("classifyCandidate — owner comes from the model, never from active_org_id", () => {
  it("keeps an ambiguous candidate user-owned and emits a two-entry scope distribution", async () => {
    // Model is uncertain between user and org; the ACTIVE ORG is set in context.
    // The classifier must NOT default owner to the active org.
    const generate = generateReturning(
      llmOutput({
        owner: { value: "user", confidence: 0.55 },
        scopeDistribution: [
          { owner: "user", confidence: 0.55 },
          { owner: "org", confidence: 0.45 },
        ],
      }),
    );
    const classifier = createClassifier(makeDeps({ generate }));

    const result = await classifier.classifyCandidate({
      candidate: candidate("we should always use staging first before prod"),
      context: firstPartyContext,
    });

    // Owner value is the model's, not the context's org.
    expect(result.classification.owner.value).toBe("user");
    // Uncertainty surfaces as a distribution over BOTH scopes, not a point guess.
    const distributionOwners = result.classification.scopeDistribution.map((entry) => entry.owner);
    expect(distributionOwners.toSorted()).toEqual(["org", "user"]);
  });

  it("emits a single-entry distribution when the model is confident", async () => {
    const generate = generateReturning(
      llmOutput({
        owner: { value: "org", confidence: 0.96 },
        scopeDistribution: [{ owner: "org", confidence: 1 }],
      }),
    );
    const classifier = createClassifier(makeDeps({ generate }));

    const result = await classifier.classifyCandidate({
      candidate: candidate("the org uses two-week sprints"),
      context: firstPartyContext,
    });

    expect(result.classification.owner.value).toBe("org");
    expect(result.classification.scopeDistribution).toHaveLength(1);
    expect(result.classification.scopeDistribution[0]!.owner).toBe("org");
  });
});

describe("classifyCandidate — audience heuristics over wording", () => {
  it("routes first-person preference wording to private_to_owner", async () => {
    // Model hinted org_members; the "I prefer" heuristic must win.
    const generate = generateReturning(
      llmOutput({ memoryType: "preference", audienceHint: "org_members" }),
    );
    const classifier = createClassifier(makeDeps({ generate }));

    const result = await classifier.classifyCandidate({
      candidate: candidate("I prefer PR summaries in bullets"),
      context: firstPartyContext,
    });

    expect(result.classification.audienceSuggestion.kind).toBe("private_to_owner");
  });

  it('routes "our company" wording to org_members', async () => {
    const generate = generateReturning(llmOutput({ audienceHint: "private_to_owner" }));
    const classifier = createClassifier(makeDeps({ generate }));

    const result = await classifier.classifyCandidate({
      candidate: candidate("Our company uses Slack for all incident comms"),
      context: firstPartyContext,
    });

    expect(result.classification.audienceSuggestion.kind).toBe("org_members");
  });

  it('routes "for the Acme project" to project_members with the resolved projectEntityId', async () => {
    const generate = generateReturning(
      llmOutput({
        entityMentions: [{ alias: "Acme", suggestedType: "project", role: "subject" }],
      }),
    );
    const classifier = createClassifier(
      makeDeps({ generate, resolveEntityFn: resolveAcmeProject }),
    );

    const result = await classifier.classifyCandidate({
      candidate: candidate("For the Acme project, always use feature branches"),
      context: firstPartyContext,
    });

    expect(result.classification.audienceSuggestion.kind).toBe("project_members");
    expect(result.classification.audienceSuggestion.projectEntityId).toBe(ACME_ENTITY_ID);
  });
});

describe("classifyCandidate — entity resolution (no silent mint, Open Q7)", () => {
  it("promotes a resolved mention to an entityLink with the registry id", async () => {
    const generate = generateReturning(
      llmOutput({
        entityMentions: [{ alias: "Acme", suggestedType: "project", role: "subject" }],
      }),
    );
    const classifier = createClassifier(
      makeDeps({ generate, resolveEntityFn: resolveAcmeProject }),
    );

    const result = await classifier.classifyCandidate({
      candidate: candidate("Acme switched to Next.js"),
      context: firstPartyContext,
    });

    expect(result.classification.entityLinks).toContainEqual(
      expect.objectContaining({ entityId: ACME_ENTITY_ID, role: "subject" }),
    );
    // A resolved mention is NOT also proposed as a creation candidate.
    expect(result.classification.entityCreationCandidates).toHaveLength(0);
  });

  it("keeps an unknown alias as an entity-creation candidate with no entity link", async () => {
    const generate = generateReturning(
      llmOutput({
        entityMentions: [{ alias: "Zephyr", suggestedType: "client", role: "subject" }],
      }),
    );
    // resolveNone: nothing matches.
    const classifier = createClassifier(makeDeps({ generate, resolveEntityFn: resolveNone }));

    const result = await classifier.classifyCandidate({
      candidate: candidate("Zephyr signed the retainer today"),
      context: firstPartyContext,
    });

    expect(result.classification.entityCreationCandidates).toContainEqual({
      alias: "Zephyr",
      suggestedType: "client",
    });
    // Never silently minted into a real link.
    expect(result.classification.entityLinks).toHaveLength(0);
  });
});

describe("classifyCandidate — conservative directive detection (false-positive-averse)", () => {
  it('downgrades a boundary "we usually…" statement the model called a directive', async () => {
    // No explicit directive marker ("from now on"/"always"/"never"/"must") present.
    const generate = generateReturning(llmOutput({ memoryType: "directive" }));
    const classifier = createClassifier(makeDeps({ generate }));

    const result = await classifier.classifyCandidate({
      candidate: candidate("we usually deploy on Fridays"),
      context: firstPartyContext,
    });

    expect(result.classification.memoryType).not.toBe("directive");
  });

  it('downgrades "I\'d rather you kept answers short" (soft preference, not a directive)', async () => {
    const generate = generateReturning(llmOutput({ memoryType: "directive" }));
    const classifier = createClassifier(makeDeps({ generate }));

    const result = await classifier.classifyCandidate({
      candidate: candidate("I'd rather you kept answers short"),
      context: firstPartyContext,
    });

    expect(result.classification.memoryType).not.toBe("directive");
  });

  it("keeps a directive when an explicit marker is present", async () => {
    const generate = generateReturning(llmOutput({ memoryType: "directive" }));
    const classifier = createClassifier(makeDeps({ generate }));

    const result = await classifier.classifyCandidate({
      candidate: candidate("From now on, always deploy behind a feature flag"),
      context: firstPartyContext,
    });

    expect(result.classification.memoryType).toBe("directive");
  });
});

describe("classifyCandidate — sourceAuthority carried from event trust class", () => {
  const cases = [
    { trust: "first_party" as const, authority: "explicit" },
    { trust: "external_included" as const, authority: "inferred" },
    { trust: "integration" as const, authority: "integration" },
  ];

  for (const { trust, authority } of cases) {
    it(`maps ${trust} -> ${authority}`, async () => {
      const classifier = createClassifier(makeDeps());

      const result = await classifier.classifyCandidate({
        candidate: candidate("Acme uses Postgres"),
        context: { ...firstPartyContext, sourceTrustClass: trust },
      });

      expect(result.classification.sourceAuthority).toBe(authority);
    });
  }
});

describe("classifyCandidate — Zod validation with a single retry", () => {
  it("retries once on malformed output and succeeds (generate called exactly twice)", async () => {
    const generate = vi
      .fn<ClassifierGenerateFn>()
      .mockResolvedValueOnce("this is not json at all")
      .mockResolvedValueOnce(JSON.stringify(llmOutput()));
    const classifier = createClassifier(makeDeps({ generate }));

    const result = await classifier.classifyCandidate({
      candidate: candidate("Acme uses Postgres"),
      context: firstPartyContext,
    });

    expect(result.retried).toBe(true);
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it("throws a typed error after two malformed responses and never calls generate a third time", async () => {
    const generate = vi
      .fn<ClassifierGenerateFn>()
      .mockResolvedValueOnce("{ not valid")
      .mockResolvedValueOnce("{ still not valid")
      .mockResolvedValue(JSON.stringify(llmOutput()));
    const classifier = createClassifier(makeDeps({ generate }));

    await expect(
      classifier.classifyCandidate({
        candidate: candidate("anything"),
        context: firstPartyContext,
      }),
    ).rejects.toSatisfy(isClassifierError);
    expect(generate).toHaveBeenCalledTimes(2);
  });
});

describe("classifyCandidate — prompt is versioned and evidence-driven", () => {
  it("includes candidate text, its evidence span, and registry alias context", async () => {
    const generate = generateReturning(llmOutput());
    const classifier = createClassifier(makeDeps({ generate }));

    const target = candidate("Acme switched to Next.js", {
      candidateText: "Acme switched to Next.js",
      evidenceSpan: "Acme switched to Next.js last quarter",
    });
    await classifier.classifyCandidate({
      candidate: target,
      context: firstPartyContext,
      registryAliasHints: ["Acme", "BNSN"],
    });

    expect(generate).toHaveBeenCalledTimes(1);
    const prompt = (generate as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
    expect(prompt).toContain(target.candidateText);
    expect(prompt).toContain(target.evidenceSpan);
    // Registry alias context is surfaced to steer entity linking.
    expect(prompt).toContain("Acme");
    // The instruction asks for classification.
    expect(prompt.toLowerCase()).toMatch(/classif|memory type|owner/);
  });

  it("flows the config model + classifierVersion onto the result", async () => {
    const classifier = createClassifier(makeDeps());

    const result = await classifier.classifyCandidate({
      candidate: candidate("Acme uses Postgres"),
      context: firstPartyContext,
    });

    expect(result.model).toBe(CONFIG.model);
    expect(result.classifierVersion).toBe(CLASSIFIER_PROMPT_VERSION);
  });
});
