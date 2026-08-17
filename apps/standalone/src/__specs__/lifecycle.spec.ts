import { describe, expect, it } from "vitest";

import { STANDALONE_POLICY_MATRIX } from "../policy.ts";
import { createInMemoryStandaloneRepository } from "../repository-memory.ts";

const actorUserId = "00000000-0000-4000-8000-000000000011";
const workspaceId = "00000000-0000-4000-8000-000000000022";

describe("standalone review and data lifecycle", () => {
  it("ships review-first until an auto-commit policy is explicitly approved", () => {
    expect(STANDALONE_POLICY_MATRIX).toMatchObject({
      version: "standalone/1.0-review-first",
      cells: [],
      defaults: { disposition: "review" },
    });
  });

  it("reviews, exports, retains, and deletes the single-workspace inventory", async () => {
    const repository = createInMemoryStandaloneRepository();
    const receipt = await repository.recordEvent({
      rawEvent: "I prefer concise status updates.",
      sourceType: "mcp",
    });
    const event = await repository.claimNextEvent();
    expect(event?.id).toBe(receipt.eventId);
    const [candidate] = await repository.persistCandidates(
      event!,
      {
        candidates: [
          {
            candidateText: "I prefer concise status updates.",
            provisionalType: "preference",
            evidenceSpan: "I prefer concise status updates.",
            reasonSummary: "A durable communication preference.",
          },
        ],
        model: "test",
        promptVersion: "extractor/test",
        retried: false,
        usageTokens: null,
        latencyMs: 1,
      },
      actorUserId,
      workspaceId,
    );
    const governance = {
      classification: {
        memoryType: "preference" as const,
        owner: { value: "user" as const, confidence: 0.99 },
        scopeDistribution: [{ owner: "user" as const, confidence: 0.99 }],
        entityLinks: [],
        entityCreationCandidates: [],
        audienceSuggestion: {
          kind: "private_to_owner" as const,
          basis: "first-person preference",
        },
        sensitivity: { level: "normal" as const, aboutAnotherPerson: false },
        sourceAuthority: "explicit" as const,
        operationGuess: "ADD" as const,
        confidence: 0.99,
      },
      decision: {
        disposition: "review" as const,
        matrixVersion: STANDALONE_POLICY_MATRIX.version,
        reason: "review-first distribution default",
        hardRule: null,
      },
    };
    await repository.persistCandidateDecision({
      candidateId: candidate!.id,
      governance,
      status: "review",
    });

    expect(await repository.listReviewQueue()).toHaveLength(1);
    const decision = await repository.decideReview(
      { candidateId: candidate!.id, action: "approve" },
      new Date("2026-08-16T12:00:00.000Z"),
    );
    expect(decision.reconcileOutcome?.memoryId).toBeTruthy();

    const exported = await repository.exportWorkspace(
      workspaceId,
      new Date("2026-08-16T12:01:00.000Z"),
    );
    const [exportedEvent] = exported.events;
    expect(exportedEvent?.rawEvent).toBe("I prefer concise status updates.");
    expect(exported.memories).toHaveLength(1);

    const retentionTime = new Date(new Date(exportedEvent!.createdAt).getTime() + 1);
    const retained = await repository.runRetention(retentionTime, retentionTime);
    expect(retained.eventsRedacted).toBe(1);

    await expect(repository.deleteWorkspace()).resolves.toMatchObject({
      reviews: 1,
      memories: 1,
      candidates: 1,
      events: 1,
    });
    expect(repository.snapshot()).toEqual({ events: [], candidates: [], memories: [] });
  });
});
