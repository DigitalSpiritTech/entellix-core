import { describe, expect, it } from "vitest";

import { createStandaloneWorker } from "../worker.ts";
import { createFakeStandaloneRepository } from "./fake-repository.ts";

const actorUserId = "00000000-0000-4000-8000-000000000011";
const workspaceId = "00000000-0000-4000-8000-000000000022";

describe("standalone automatic worker", () => {
  it("runs one queued event through core governance and commits an allowed candidate", async () => {
    const repository = createFakeStandaloneRepository();
    const event = await repository.recordEvent({
      rawEvent: "I prefer concise status updates.",
      sourceType: "mcp",
    });
    const worker = createStandaloneWorker({
      actorUserId,
      workspaceId,
      repository,
      extractor: {
        extractFromBatch: async () => ({
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
        }),
      },
      classifier: {
        classifyCandidate: async ({ candidate }) => ({
          candidate,
          classification: {
            memoryType: "preference",
            owner: { value: "user", confidence: 0.99 },
            scopeDistribution: [{ owner: "user", confidence: 0.99 }],
            entityLinks: [],
            entityCreationCandidates: [],
            audienceSuggestion: { kind: "private_to_owner", basis: "first-person preference" },
            sensitivity: { level: "normal", aboutAnotherPerson: false },
            sourceAuthority: "explicit",
            operationGuess: "ADD",
            confidence: 0.99,
          },
          model: "test",
          classifierVersion: "classifier/test",
          retried: false,
        }),
      },
      conflictDetector: { classifyPairs: async () => [] },
      matrix: {
        version: "standalone-test-active",
        cells: [
          {
            memoryType: "preference",
            audienceKind: "private_to_owner",
            sourceAuthority: "explicit",
            sensitivityLevel: "normal",
            disposition: "auto_commit",
            minConfidence: 0.6,
          },
        ],
        defaults: { disposition: "review", minConfidence: 0.5 },
      },
      now: () => new Date("2026-08-16T12:00:00.000Z"),
    });

    const result = await worker.runOnce();

    expect(result).toEqual({ claimed: 1, committed: 1, review: 0, rejected: 0, failed: 0 });
    expect(repository.snapshot().events.find((row) => row.id === event.eventId)?.status).toBe(
      "completed",
    );
    expect(repository.snapshot().memories).toHaveLength(1);
  });
});
