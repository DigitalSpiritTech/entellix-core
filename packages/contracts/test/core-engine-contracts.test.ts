/**
 * Tests core engine contracts behavior.
 *
 * Inputs: Imported dependencies and values passed to the module's documented functions.
 * Outputs: Exported types, values, and behavior provided by the module.
 * Errors: Functions document validation, dependency, and runtime errors individually.
 *
 * @packageDocumentation
 */

import {
  extractFromBatchInputSchema,
  extractionResultSchema,
  extractorConfigSchema,
} from "@entellix/contracts/candidates";
import {
  classificationResultSchema,
  classifyCandidateInputSchema,
  resolveEntityResultSchema,
} from "@entellix/contracts/classification";
import {
  classifyPairsInputSchema,
  conflictDetectorConfigSchema,
  neighborQueryFiltersSchema,
} from "@entellix/contracts/conflicts";
import { persistBatchContextSchema } from "@entellix/contracts/core-ports";
import { entityContextSchema } from "@entellix/contracts/directive-precedence";
import { directivePacketDirectiveInputSchema } from "@entellix/contracts/directives";
import {
  retrievedMemoryInputSchema,
  verifyContextEnvelopeDataSchema,
} from "@entellix/contracts/packet";
import { routeDecisionInputSchema, routeDecisionSchema } from "@entellix/contracts/pipeline";
import {
  dispositionDecisionSchema,
  evaluateDispositionInputSchema,
} from "@entellix/contracts/policy-matrix";
import { derivedRowPoliciesSchema, operationSelectionSchema } from "@entellix/contracts/reconciler";
import { fusionMemorySchema, retrievalCandidateSchema } from "@entellix/contracts/retrieval";
import { describe, expect, it } from "vitest";

const EVENT_ID = "00000000-0000-4000-8000-0000000000e0";
const ACTOR_ID = "00000000-0000-4000-8000-000000000001";
const ORG_ID = "00000000-0000-4000-8000-000000000002";
const CANDIDATE_ID = "00000000-0000-4000-8000-000000000003";
const MEMORY_ID = "00000000-0000-4000-8000-000000000004";

const candidate = {
  id: CANDIDATE_ID,
  batchId: "batch-1",
  sourceEventIds: [EVENT_ID],
  actorUserId: ACTOR_ID,
  activeOrgId: ORG_ID,
  candidateText: "Acme uses Next.js.",
  provisionalType: "fact",
  evidenceSpan: "Acme uses Next.js.",
  reasonSummary: "Durable client fact.",
  status: "pending_classification",
  extractorVersion: "extractor/2026-08-16",
  model: "claude-haiku",
  createdAt: "2026-08-16T12:00:00.000Z",
} as const;

const classification = {
  memoryType: "fact",
  owner: { value: "org", confidence: 0.9 },
  scopeDistribution: [{ owner: "org", confidence: 0.9 }],
  entityLinks: [],
  entityCreationCandidates: [],
  audienceSuggestion: { kind: "org_members", basis: "Organization fact." },
  sensitivity: { level: "normal", aboutAnotherPerson: false },
  sourceAuthority: "explicit",
  operationGuess: "ADD",
  confidence: 0.9,
} as const;

describe("core engine contracts", () => {
  it("validates extractor configuration and batch inputs at the package boundary", () => {
    expect(
      extractorConfigSchema.parse({
        model: "claude-haiku",
        promptVersion: "extractor/2026-08-16",
      }),
    ).toEqual({
      model: "claude-haiku",
      promptVersion: "extractor/2026-08-16",
    });

    expect(
      extractFromBatchInputSchema.parse({
        batchId: "batch-1",
        events: [{ id: EVENT_ID, actorUserId: ACTOR_ID, rawText: "Remember this." }],
      }),
    ).toEqual({
      batchId: "batch-1",
      events: [{ id: EVENT_ID, actorUserId: ACTOR_ID, rawText: "Remember this." }],
    });

    expect(
      extractFromBatchInputSchema.safeParse({
        batchId: "",
        events: [{ id: "not-a-uuid", actorUserId: ACTOR_ID, rawText: "Remember this." }],
      }).success,
    ).toBe(false);
  });

  it("validates the extractor result emitted to persistence adapters", () => {
    const result = extractionResultSchema.safeParse({
      candidates: [
        {
          candidateText: "Remember this.",
          provisionalType: "fact",
          evidenceSpan: "Remember this.",
          reasonSummary: "Explicit durable context.",
        },
      ],
      model: "claude-haiku",
      promptVersion: "extractor/2026-08-16",
      retried: false,
      usageTokens: null,
      latencyMs: 12,
    });

    expect(result.success).toBe(true);
  });

  it("validates classifier inputs, outputs, and entity-resolution variants", () => {
    expect(
      classifyCandidateInputSchema.safeParse({
        candidate,
        context: {
          actorUserId: ACTOR_ID,
          activeOrgId: ORG_ID,
          sourceTrustClass: "first_party",
        },
      }).success,
    ).toBe(true);
    expect(
      classificationResultSchema.safeParse({
        candidate,
        classification,
        model: "claude-haiku",
        classifierVersion: "classifier/2026-08-16",
        retried: false,
      }).success,
    ).toBe(true);
    expect(resolveEntityResultSchema.safeParse({ kind: "none" }).success).toBe(true);
    expect(
      resolveEntityResultSchema.safeParse({ kind: "match", entity: { id: "bad", type: "" } })
        .success,
    ).toBe(false);
  });

  it("validates conflict-detector and policy-matrix engine boundaries", () => {
    expect(
      conflictDetectorConfigSchema.safeParse({
        model: "claude-haiku",
        promptVersion: "conflict/2026-08-16",
      }).success,
    ).toBe(true);
    expect(
      neighborQueryFiltersSchema.safeParse({
        ownerScopeType: "org",
        ownerScopeId: ORG_ID,
        entityIds: [MEMORY_ID],
        status: "active",
        limit: 10,
      }).success,
    ).toBe(true);
    expect(
      classifyPairsInputSchema.safeParse({
        candidate: { id: CANDIDATE_ID, text: "Acme uses Next.js." },
        neighbors: [
          {
            memoryId: MEMORY_ID,
            content: "Acme uses React.",
            memoryType: "fact",
            ownerScopeType: "org",
            ownerScopeId: ORG_ID,
            entityIds: [MEMORY_ID],
            similarity: 0.8,
          },
        ],
      }).success,
    ).toBe(true);

    const evaluatedClassification = {
      candidateId: CANDIDATE_ID,
      memoryType: "fact",
      owner: { scopeType: "org" },
      audienceSuggestion: "org_members",
      sourceAuthority: "explicit",
      sensitivity: { level: "normal", aboutAnotherPerson: false },
      confidence: 0.9,
    } as const;
    const matrix = {
      version: "matrix-1",
      cells: [],
      defaults: { disposition: "review", minConfidence: 0.5 },
    } as const;
    expect(
      evaluateDispositionInputSchema.safeParse({
        classification: evaluatedClassification,
        sourceTrustClass: "first_party",
        matrix,
      }).success,
    ).toBe(true);
    expect(
      dispositionDecisionSchema.safeParse({
        disposition: "review",
        matrixVersion: "matrix-1",
        reason: "Default review.",
        hardRule: null,
      }).success,
    ).toBe(true);
  });

  it("validates pure engine value boundaries while leaving callbacks out of DTO schemas", () => {
    expect(
      routeDecisionInputSchema.safeParse({
        triggers: [{ category: "status_verb", phrase: "switched" }],
        noveltyScore: 0.8,
        nearDuplicate: false,
      }).success,
    ).toBe(true);
    expect(
      routeDecisionSchema.safeParse({ route: "immediate", reason: "hot trigger" }).success,
    ).toBe(true);
    expect(
      retrievedMemoryInputSchema.safeParse({
        memoryId: MEMORY_ID,
        memoryType: "fact",
        text: "Acme uses Next.js.",
        group: "Acme",
      }).success,
    ).toBe(true);
    expect(
      verifyContextEnvelopeDataSchema.safeParse({
        actorUserId: ACTOR_ID,
        asserted: { orgId: ORG_ID, entityIds: [MEMORY_ID] },
      }).success,
    ).toBe(true);
    expect(
      directivePacketDirectiveInputSchema.safeParse({
        memoryId: MEMORY_ID,
        content: "Always run tests.",
        precedenceRank: 1,
        title: "Testing",
      }).success,
    ).toBe(true);
    expect(
      entityContextSchema.safeParse({
        activeIds: [MEMORY_ID],
        ancestorsById: { [MEMORY_ID]: [ORG_ID] },
      }).success,
    ).toBe(true);
    expect(
      derivedRowPoliciesSchema.safeParse({
        renderPolicy: "retrieval",
        contentVerbatim: false,
        expiresAt: null,
      }).success,
    ).toBe(true);
    expect(
      operationSelectionSchema.safeParse({ operation: "SUPERSEDE", targetMemoryId: MEMORY_ID })
        .success,
    ).toBe(true);
  });

  it("validates retrieval and host-persistence boundary values", () => {
    expect(
      retrievalCandidateSchema.safeParse({ id: MEMORY_ID, rank: 1, distance: 0.12 }).success,
    ).toBe(true);
    expect(
      fusionMemorySchema.safeParse({
        id: MEMORY_ID,
        status: "active",
        memoryType: "fact",
        renderPolicy: "retrieval",
        ownerScopeType: "org",
        ownerScopeId: ORG_ID,
        subjectEntityId: null,
        validFrom: null,
        validTo: null,
        updatedAt: new Date("2026-08-16T12:00:00.000Z"),
      }).success,
    ).toBe(true);
    expect(
      persistBatchContextSchema.safeParse({
        batchId: "batch-1",
        sourceEventIds: [EVENT_ID],
        actorUserId: ACTOR_ID,
        activeOrgId: ORG_ID,
      }).success,
    ).toBe(true);
  });
});
