import type { ExtractionResult } from "@entellix/contracts/candidates";
import type { MemoryCandidate } from "@entellix/contracts/candidates";
import type { Neighbor } from "@entellix/contracts/conflicts";
import type {
  ReviewDecisionInput,
  ReviewDecisionResult,
  ReviewQueueItem,
} from "@entellix/contracts/reviews";

import type {
  CandidateGovernance,
  CommitCandidateInput,
  DeleteResult,
  EventReceipt,
  PersistCandidateDecision,
  RecordStandaloneEventInput,
  RetentionResult,
  StandaloneEvent,
  StandaloneExport,
  StandaloneMemory,
} from "./contracts.ts";

export interface StandaloneRepository {
  recordEvent(input: RecordStandaloneEventInput): Promise<EventReceipt>;
  claimNextEvent(): Promise<StandaloneEvent | null>;
  completeEvent(eventId: string): Promise<void>;
  failEvent(eventId: string, error: unknown): Promise<void>;
  persistCandidates(
    event: StandaloneEvent,
    extraction: ExtractionResult,
    actorUserId: string,
    workspaceId: string,
  ): Promise<MemoryCandidate[]>;
  persistCandidateDecision(input: PersistCandidateDecision): Promise<void>;
  findNeighbors(candidate: MemoryCandidate, governance: CandidateGovernance): Promise<Neighbor[]>;
  commitCandidate(input: CommitCandidateInput): Promise<StandaloneMemory | null>;
  searchMemories(
    query: string,
    limit: number,
    queryEmbedding?: number[],
  ): Promise<StandaloneMemory[]>;
  listMemories(limit: number): Promise<StandaloneMemory[]>;
  listReviewQueue(): Promise<ReviewQueueItem[]>;
  decideReview(input: ReviewDecisionInput, now: Date): Promise<ReviewDecisionResult>;
  runRetention(cutoff: Date, now: Date): Promise<RetentionResult>;
  exportWorkspace(workspaceId: string, now: Date): Promise<StandaloneExport>;
  deleteWorkspace(): Promise<DeleteResult>;
  ping(): Promise<void>;
  close(): Promise<void>;
}
