/**
 * Defines the persistence port consumed by standalone services and workers.
 *
 * Inputs: Imported dependencies and values passed to the module's documented functions.
 * Outputs: Exported types, values, and behavior provided by the module.
 * Errors: Functions document validation, dependency, and runtime errors individually.
 *
 * @packageDocumentation
 */

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
  /**
   * Executes record event.
   *
   * @param input - Value supplied for `input`.
   * @returns The result produced by `recordEvent`.
   * @throws Errors raised by validation or dependent operations.
   */
  recordEvent(input: RecordStandaloneEventInput): Promise<EventReceipt>;
  /**
   * Executes claim next event.
   *
   * Inputs: None.
   * @returns The result produced by `claimNextEvent`.
   * @throws Errors raised by validation or dependent operations.
   */
  claimNextEvent(): Promise<StandaloneEvent | null>;
  /**
   * Executes complete event.
   *
   * @param eventId - Value supplied for `eventId`.
   * @returns The result produced by `completeEvent`.
   * @throws Errors raised by validation or dependent operations.
   */
  completeEvent(eventId: string): Promise<void>;
  /**
   * Executes fail event.
   *
   * @param eventId - Value supplied for `eventId`.
   * @param error - Value supplied for `error`.
   * @returns The result produced by `failEvent`.
   * @throws Errors raised by validation or dependent operations.
   */
  failEvent(eventId: string, error: unknown): Promise<void>;
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
  persistCandidates(
    event: StandaloneEvent,
    extraction: ExtractionResult,
    actorUserId: string,
    workspaceId: string,
  ): Promise<MemoryCandidate[]>;
  /**
   * Executes persist candidate decision.
   *
   * @param input - Value supplied for `input`.
   * @returns The result produced by `persistCandidateDecision`.
   * @throws Errors raised by validation or dependent operations.
   */
  persistCandidateDecision(input: PersistCandidateDecision): Promise<void>;
  /**
   * Finds neighbors.
   *
   * @param candidate - Value supplied for `candidate`.
   * @param governance - Value supplied for `governance`.
   * @returns The result produced by `findNeighbors`.
   * @throws Errors raised by validation or dependent operations.
   */
  findNeighbors(candidate: MemoryCandidate, governance: CandidateGovernance): Promise<Neighbor[]>;
  /**
   * Executes commit candidate.
   *
   * @param input - Value supplied for `input`.
   * @returns The result produced by `commitCandidate`.
   * @throws Errors raised by validation or dependent operations.
   */
  commitCandidate(input: CommitCandidateInput): Promise<StandaloneMemory | null>;
  /**
   * Executes search memories.
   *
   * @param query - Value supplied for `query`.
   * @param limit - Value supplied for `limit`.
   * @param queryEmbedding - Value supplied for `queryEmbedding`.
   * @returns The result produced by `searchMemories`.
   * @throws Errors raised by validation or dependent operations.
   */
  searchMemories(
    query: string,
    limit: number,
    queryEmbedding?: number[],
  ): Promise<StandaloneMemory[]>;
  /**
   * Lists memories.
   *
   * @param limit - Value supplied for `limit`.
   * @returns The result produced by `listMemories`.
   * @throws Errors raised by validation or dependent operations.
   */
  listMemories(limit: number): Promise<StandaloneMemory[]>;
  /**
   * Lists review queue.
   *
   * Inputs: None.
   * @returns The result produced by `listReviewQueue`.
   * @throws Errors raised by validation or dependent operations.
   */
  listReviewQueue(): Promise<ReviewQueueItem[]>;
  /**
   * Decides review.
   *
   * @param input - Value supplied for `input`.
   * @param now - Value supplied for `now`.
   * @returns The result produced by `decideReview`.
   * @throws Errors raised by validation or dependent operations.
   */
  decideReview(input: ReviewDecisionInput, now: Date): Promise<ReviewDecisionResult>;
  /**
   * Runs retention.
   *
   * @param cutoff - Value supplied for `cutoff`.
   * @param now - Value supplied for `now`.
   * @returns The result produced by `runRetention`.
   * @throws Errors raised by validation or dependent operations.
   */
  runRetention(cutoff: Date, now: Date): Promise<RetentionResult>;
  /**
   * Executes export workspace.
   *
   * @param workspaceId - Value supplied for `workspaceId`.
   * @param now - Value supplied for `now`.
   * @returns The result produced by `exportWorkspace`.
   * @throws Errors raised by validation or dependent operations.
   */
  exportWorkspace(workspaceId: string, now: Date): Promise<StandaloneExport>;
  /**
   * Executes delete workspace.
   *
   * Inputs: None.
   * @returns The result produced by `deleteWorkspace`.
   * @throws Errors raised by validation or dependent operations.
   */
  deleteWorkspace(): Promise<DeleteResult>;
  /**
   * Executes ping.
   *
   * Inputs: None.
   * @returns The result produced by `ping`.
   * @throws Errors raised by validation or dependent operations.
   */
  ping(): Promise<void>;
  /**
   * Executes close.
   *
   * Inputs: None.
   * @returns The result produced by `close`.
   * @throws Errors raised by validation or dependent operations.
   */
  close(): Promise<void>;
}
