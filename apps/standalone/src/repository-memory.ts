/**
 * Implements an in-memory standalone repository for tests and local composition.
 *
 * Inputs: Imported dependencies and values passed to the module's documented functions.
 * Outputs: Exported types, values, and behavior provided by the module.
 * Errors: Functions document validation, dependency, and runtime errors individually.
 *
 * @packageDocumentation
 */

import { createHash, randomUUID } from "node:crypto";

import type { MemoryCandidate } from "@entellix/contracts/candidates";
import type { ReviewDecisionResult, ReviewQueueItem } from "@entellix/contracts/reviews";
import { canonicalizeContent, deriveRowPolicies } from "@entellix/core/reconciler";

import {
  type CandidateGovernance,
  type CommitCandidateInput,
  type RecordStandaloneEventInput,
  type StandaloneEvent,
  type StandaloneMemory,
  eventReceiptSchema,
  recordStandaloneEventInputSchema,
  standaloneEventSchema,
  standaloneExportSchema,
} from "./contracts.ts";
import type { StandaloneRepository } from "./repository.ts";

/**
 * Converts to error message.
 *
 * @param error - Value supplied for `error`.
 * @returns The result produced by `toErrorMessage`.
 * @throws Errors raised by validation or dependent operations.
 */
const toErrorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Executes event key.
 *
 * @param input - Value supplied for `input`.
 * @returns The result produced by `eventKey`.
 * @throws Errors raised by validation or dependent operations.
 */
function eventKey(input: RecordStandaloneEventInput): string {
  return createHash("sha256")
    .update(
      `${input.sourceType}\0${input.sessionId ?? ""}\0${input.messageId ?? ""}\0${input.rawEvent}`,
    )
    .digest("hex");
}

/**
 * Creates in memory standalone repository.
 *
 * Inputs: None.
 * @returns The result produced by `createInMemoryStandaloneRepository`.
 * @throws Errors raised by validation or dependent operations.
 */
export function createInMemoryStandaloneRepository(): StandaloneRepository & {
  /**
   * Executes snapshot.
   *
   * Inputs: None.
   * @returns The result produced by `snapshot`.
   * @throws Errors raised by validation or dependent operations.
   */
  snapshot(): {
    events: StandaloneEvent[];
    candidates: MemoryCandidate[];
    memories: StandaloneMemory[];
  };
} {
  const events: StandaloneEvent[] = [];
  const candidates: MemoryCandidate[] = [];
  const memories: StandaloneMemory[] = [];
  const governance = new Map<string, CandidateGovernance>();
  const keys = new Map<string, string>();
  const reviews: Array<Record<string, unknown>> = [];

  const repository: StandaloneRepository = {
    /**
     * Executes record event.
     *
     * @param rawInput - Value supplied for `rawInput`.
     * @returns The result produced by `recordEvent`.
     * @throws Errors raised by validation or dependent operations.
     */
    async recordEvent(rawInput) {
      const input = recordStandaloneEventInputSchema.parse(rawInput);
      const key = eventKey(input);
      const existingId = keys.get(key);
      if (existingId) return eventReceiptSchema.parse({ eventId: existingId, deduped: true });
      const now = new Date();
      const event = standaloneEventSchema.parse({
        id: randomUUID(),
        rawEvent: input.rawEvent,
        sourceContext: input.sourceContext ?? null,
        sourceType: input.sourceType,
        sourceTrustClass: input.sourceTrustClass ?? "first_party",
        status: "queued",
        attempts: 0,
        error: null,
        createdAt: now,
        updatedAt: now,
      });
      events.push(event);
      keys.set(key, event.id);
      return { eventId: event.id, deduped: false };
    },
    /**
     * Executes claim next event.
     *
     * Inputs: None.
     * @returns The result produced by `claimNextEvent`.
     * @throws Errors raised by validation or dependent operations.
     */
    async claimNextEvent() {
      const event = events.find((item) => item.status === "queued" || item.status === "failed");
      if (!event) return null;
      event.status = "processing";
      event.attempts += 1;
      event.updatedAt = new Date();
      return { ...event };
    },
    /**
     * Executes complete event.
     *
     * @param eventId - Value supplied for `eventId`.
     * @returns The result produced by `completeEvent`.
     * @throws Errors raised by validation or dependent operations.
     */
    async completeEvent(eventId) {
      const event = events.find((item) => item.id === eventId);
      if (!event) throw new Error(`event '${eventId}' not found`);
      event.status = "completed";
      event.error = null;
      event.updatedAt = new Date();
    },
    /**
     * Executes fail event.
     *
     * @param eventId - Value supplied for `eventId`.
     * @param error - Value supplied for `error`.
     * @returns The result produced by `failEvent`.
     * @throws Errors raised by validation or dependent operations.
     */
    async failEvent(eventId, error) {
      const event = events.find((item) => item.id === eventId);
      if (!event) throw new Error(`event '${eventId}' not found`);
      event.status = "failed";
      event.error = toErrorMessage(error);
      event.updatedAt = new Date();
    },
    /**
     * Executes persist candidates.
     *
     * @param event - Value supplied for `event`.
     * @param extraction - Value supplied for `extraction`.
     * @param actorUserId - Value supplied for `actorUserId`.
     * @param workspaceId - Value supplied for `workspaceId`.
     * @returns The result produced by `persistCandidates`.
     * @throws Errors raised by validation or dependent operations.
     */
    async persistCandidates(event, extraction, actorUserId, workspaceId) {
      const created = extraction.candidates.map((candidate): MemoryCandidate => ({
        id: randomUUID(),
        batchId: event.id,
        sourceEventIds: [event.id],
        actorUserId,
        activeOrgId: workspaceId,
        candidateText: candidate.candidateText,
        provisionalType: candidate.provisionalType,
        evidenceSpan: candidate.evidenceSpan,
        reasonSummary: candidate.reasonSummary,
        status: "pending_classification",
        extractorVersion: extraction.promptVersion,
        model: extraction.model,
        createdAt: new Date().toISOString(),
      }));
      candidates.push(...created);
      return created;
    },
    /**
     * Executes persist candidate decision.
     *
     * @param input - Value supplied for `input`.
     * @returns The result produced by `persistCandidateDecision`.
     * @throws Errors raised by validation or dependent operations.
     */
    async persistCandidateDecision(input) {
      const candidate = candidates.find((item) => item.id === input.candidateId);
      if (!candidate) throw new Error(`candidate '${input.candidateId}' not found`);
      candidate.status = input.status;
      governance.set(candidate.id, input.governance);
    },
    /**
     * Finds neighbors.
     *
     * Inputs: None.
     * @returns The result produced by `findNeighbors`.
     * @throws Errors raised by validation or dependent operations.
     */
    async findNeighbors() {
      return [];
    },
    /**
     * Executes commit candidate.
     *
     * @param rawInput - Value supplied for `rawInput`.
     * @returns The result produced by `commitCandidate`.
     * @throws Errors raised by validation or dependent operations.
     */
    async commitCandidate(rawInput) {
      const input: CommitCandidateInput = rawInput;
      const candidate = candidates.find((item) => item.id === input.candidate.id);
      if (!candidate) throw new Error(`candidate '${input.candidate.id}' not found`);
      if (input.operation === "NOOP") {
        candidate.status = "committed";
        return null;
      }
      const classification = input.governance.classification;
      const policies = deriveRowPolicies(classification.memoryType, input.now);
      const text = canonicalizeContent({
        text: candidate.candidateText,
        memoryType: classification.memoryType,
      });
      const target = input.targetMemoryId
        ? memories.find((memory) => memory.id === input.targetMemoryId)
        : undefined;
      if ((input.operation === "MERGE" || input.operation === "SUPERSEDE") && !target) {
        throw new Error(`target memory '${input.targetMemoryId}' not found`);
      }
      const now = input.now;
      const memory: StandaloneMemory = {
        id: randomUUID(),
        sourceCandidateId: candidate.id,
        text: input.operation === "MERGE" && target ? `${target.text} ${text}` : text,
        scope: classification.owner.value === "user" ? "profile" : "organization",
        status: "active",
        memoryType: classification.memoryType,
        ownerScopeType: classification.owner.value,
        renderPolicy: policies.renderPolicy,
        confidence: classification.confidence,
        sourceAuthority: classification.sourceAuthority,
        sensitivity: classification.sensitivity.level,
        embedding: input.embedding,
        validFrom: now,
        validTo: null,
        expiresAt: policies.expiresAt,
        supersededBy: null,
        createdAt: now,
        updatedAt: now,
      };
      memories.push(memory);
      if (target) {
        target.status = "superseded";
        target.validTo = now;
        target.supersededBy = memory.id;
        target.updatedAt = now;
      }
      candidate.status = "committed";
      return memory;
    },
    /**
     * Executes search memories.
     *
     * @param query - Value supplied for `query`.
     * @param limit - Value supplied for `limit`.
     * @returns The result produced by `searchMemories`.
     * @throws Errors raised by validation or dependent operations.
     */
    async searchMemories(query, limit) {
      const words = query.toLowerCase().split(/\W+/).filter(Boolean);
      return memories
        .filter((memory) => memory.status === "active")
        .map((memory) => ({
          memory,
          score: words.filter((word) => memory.text.toLowerCase().includes(word)).length,
        }))
        .filter((item) => item.score > 0)
        .toSorted((left, right) => right.score - left.score)
        .slice(0, limit)
        .map((item) => item.memory);
    },
    /**
     * Lists memories.
     *
     * @param limit - Value supplied for `limit`.
     * @returns The result produced by `listMemories`.
     * @throws Errors raised by validation or dependent operations.
     */
    async listMemories(limit) {
      return memories.filter((memory) => memory.status === "active").slice(0, limit);
    },
    /**
     * Lists review queue.
     *
     * Inputs: None.
     * @returns The result produced by `listReviewQueue`.
     * @throws Errors raised by validation or dependent operations.
     */
    async listReviewQueue() {
      return candidates
        .filter((candidate) => candidate.status === "review")
        .map((candidate): ReviewQueueItem => {
          const state = governance.get(candidate.id);
          if (!state) throw new Error(`candidate '${candidate.id}' has no governance state`);
          return {
            candidateId: candidate.id,
            candidateText: candidate.candidateText,
            evidenceSpan: candidate.evidenceSpan,
            reasonSummary: candidate.reasonSummary,
            suggestedType: state.classification.memoryType,
            suggestedOwner: state.classification.owner.value,
            suggestedAudienceKind: state.classification.audienceSuggestion.kind,
            sourceEventIds: candidate.sourceEventIds,
            conflicts: [],
            whoWouldSee:
              state.classification.audienceSuggestion.kind === "private_to_owner"
                ? "Local operator only"
                : "This standalone workspace",
            disposition: state.decision.disposition,
            dispositionReason: state.decision.reason,
            createdAt: candidate.createdAt,
          };
        });
    },
    /**
     * Decides review.
     *
     * @param input - Value supplied for `input`.
     * @param now - Value supplied for `now`.
     * @returns The result produced by `decideReview`.
     * @throws Errors raised by validation or dependent operations.
     */
    async decideReview(input, now) {
      const candidate = candidates.find((item) => item.id === input.candidateId);
      const state = governance.get(input.candidateId);
      if (!candidate || !state || candidate.status !== "review") {
        throw new Error(`review candidate '${input.candidateId}' not found`);
      }
      const reviewId = randomUUID();
      reviews.push({ id: reviewId, ...input, createdAt: now });
      if (input.action === "reject" || input.action === "mark_sensitive") {
        candidate.status = input.action === "reject" ? "rejected" : "review";
        if (input.action === "mark_sensitive") {
          governance.set(candidate.id, {
            ...state,
            classification: {
              ...state.classification,
              sensitivity: { ...state.classification.sensitivity, level: "sensitive" },
            },
          });
        }
        return {
          candidateId: candidate.id,
          action: input.action,
          reviewId,
          reconcileOutcome: null,
        };
      }
      const edited = input.edits?.content
        ? { ...candidate, candidateText: input.edits.content }
        : candidate;
      const ownerScopeType =
        input.action === "save_as_user_private"
          ? "user"
          : (input.edits?.ownerScopeType ?? state.classification.owner.value);
      const operation =
        input.action === "merge_with_existing"
          ? "MERGE"
          : input.action === "supersede_existing"
            ? "SUPERSEDE"
            : "ADD";
      const memory = await repository.commitCandidate({
        candidate: edited,
        governance: {
          ...state,
          classification: {
            ...state.classification,
            ...(input.edits?.memoryType ? { memoryType: input.edits.memoryType } : {}),
            owner: { ...state.classification.owner, value: ownerScopeType },
          },
        },
        operation,
        targetMemoryId: input.targetMemoryId ?? null,
        embedding: null,
        now,
      });
      return {
        candidateId: candidate.id,
        action: input.action,
        reviewId,
        reconcileOutcome: { operation, memoryId: memory?.id ?? null },
      } satisfies ReviewDecisionResult;
    },
    /**
     * Runs retention.
     *
     * @param cutoff - Value supplied for `cutoff`.
     * @param now - Value supplied for `now`.
     * @returns The result produced by `runRetention`.
     * @throws Errors raised by validation or dependent operations.
     */
    async runRetention(cutoff, now) {
      let eventsRedacted = 0;
      for (const event of events) {
        if (event.createdAt < cutoff && event.rawEvent !== "[retained metadata only]") {
          event.rawEvent = "[retained metadata only]";
          event.sourceContext = null;
          event.updatedAt = now;
          eventsRedacted += 1;
        }
      }
      let candidatesRedacted = 0;
      for (const candidate of candidates) {
        if (new Date(candidate.createdAt) < cutoff && candidate.status !== "review") {
          candidate.evidenceSpan = "[retained metadata only]";
          candidatesRedacted += 1;
        }
      }
      let memoriesExpired = 0;
      for (const memory of memories) {
        if (memory.status === "active" && memory.expiresAt && memory.expiresAt <= now) {
          memory.status = "expired";
          memory.validTo = now;
          memory.updatedAt = now;
          memoriesExpired += 1;
        }
      }
      return { eventsRedacted, candidatesRedacted, memoriesExpired };
    },
    /**
     * Executes export workspace.
     *
     * @param workspaceId - Value supplied for `workspaceId`.
     * @param now - Value supplied for `now`.
     * @returns The result produced by `exportWorkspace`.
     * @throws Errors raised by validation or dependent operations.
     */
    async exportWorkspace(workspaceId, now) {
      return standaloneExportSchema.parse({
        format: "entellix-standalone-export/v1",
        exportedAt: now.toISOString(),
        workspaceId,
        memories: memories.map(({ embedding: _embedding, ...memory }) => ({
          ...memory,
          validFrom: memory.validFrom.toISOString(),
          validTo: memory.validTo?.toISOString() ?? null,
          expiresAt: memory.expiresAt?.toISOString() ?? null,
          createdAt: memory.createdAt.toISOString(),
          updatedAt: memory.updatedAt.toISOString(),
        })),
        events: events.map((event) => ({
          ...event,
          createdAt: event.createdAt.toISOString(),
          updatedAt: event.updatedAt.toISOString(),
        })),
        candidates,
        reviews,
      });
    },
    /**
     * Executes delete workspace.
     *
     * Inputs: None.
     * @returns The result produced by `deleteWorkspace`.
     * @throws Errors raised by validation or dependent operations.
     */
    async deleteWorkspace() {
      const result = {
        reviews: reviews.length,
        memories: memories.length,
        candidates: candidates.length,
        events: events.length,
      };
      reviews.length = 0;
      memories.length = 0;
      candidates.length = 0;
      events.length = 0;
      governance.clear();
      keys.clear();
      return result;
    },
    /**
     * Executes ping.
     *
     * Inputs: None.
     * @returns The result produced by `ping`.
     * @throws Errors raised by validation or dependent operations.
     */
    async ping() {},
    /**
     * Executes close.
     *
     * Inputs: None.
     * @returns The result produced by `close`.
     * @throws Errors raised by validation or dependent operations.
     */
    async close() {},
  };

  return Object.assign(repository, {
    /**
     * Executes snapshot.
     *
     * Inputs: None.
     * @returns The result produced by `snapshot`.
     * @throws Errors raised by validation or dependent operations.
     */
    snapshot: () => ({
      events: structuredClone(events),
      candidates: structuredClone(candidates),
      memories: structuredClone(memories),
    }),
  });
}
