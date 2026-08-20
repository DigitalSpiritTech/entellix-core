/**
 * Implements service behavior for this TypeScript module.
 *
 * Inputs: Imported dependencies and values passed to the module's documented functions.
 * Outputs: Exported types, values, and behavior provided by the module.
 * Errors: Functions document validation, dependency, and runtime errors individually.
 *
 * @packageDocumentation
 */

import {
  LOG_CONTEXT_ACK_MESSAGE,
  type GetContextInput,
  type GetContextOutput,
  type ListMemoriesInput,
  type ListMemoriesOutput,
  type LogContextInput,
  type LogContextOutput,
  type Memory,
  type RetrieveMemoryInput,
  type RetrieveMemoryOutput,
  type SaveMemoryInput,
  getContextInputSchema,
  listMemoriesInputSchema,
  logContextInputSchema,
  retrieveMemoryInputSchema,
  saveMemoryInputSchema,
} from "@entellix/contracts";
import type { ReviewDecisionInput } from "@entellix/contracts/reviews";
import { resolveDirectives } from "@entellix/core/directive-precedence";
import { composeMemoryPacket } from "@entellix/core/packet";

import type {
  DeleteResult,
  RetentionResult,
  StandaloneExport,
  StandaloneMemory,
} from "./contracts.ts";
import type { EmbeddingProvider } from "./providers.ts";
import type { StandaloneRepository } from "./repository.ts";

const CONTEXT_TOKEN_BUDGET = 24_000;

export interface StandaloneServiceOptions {
  actorUserId: string;
  workspaceId: string;
  rawRetentionDays: number;
  repository: StandaloneRepository;
  embeddingProvider?: EmbeddingProvider;
  /**
   * Executes now.
   *
   * Inputs: None.
   * @returns The result produced by `now`.
   * @throws Errors raised by validation or dependent operations.
   */
  now?: () => Date;
}

export interface StandaloneService {
  /**
   * Executes log context.
   *
   * @param input - Value supplied for `input`.
   * @returns The result produced by `logContext`.
   * @throws Errors raised by validation or dependent operations.
   */
  logContext(input: LogContextInput): Promise<LogContextOutput>;
  /**
   * Saves memory.
   *
   * @param input - Value supplied for `input`.
   * @returns The result produced by `saveMemory`.
   * @throws Errors raised by validation or dependent operations.
   */
  saveMemory(input: SaveMemoryInput): Promise<LogContextOutput>;
  /**
   * Gets context.
   *
   * @param input - Value supplied for `input`.
   * @returns The result produced by `getContext`.
   * @throws Errors raised by validation or dependent operations.
   */
  getContext(input: GetContextInput): Promise<GetContextOutput>;
  /**
   * Executes retrieve memories.
   *
   * @param input - Value supplied for `input`.
   * @returns The result produced by `retrieveMemories`.
   * @throws Errors raised by validation or dependent operations.
   */
  retrieveMemories(input: RetrieveMemoryInput): Promise<RetrieveMemoryOutput>;
  /**
   * Lists memories.
   *
   * @param input - Value supplied for `input`.
   * @returns The result produced by `listMemories`.
   * @throws Errors raised by validation or dependent operations.
   */
  listMemories(input: ListMemoriesInput): Promise<ListMemoriesOutput>;
  /**
   * Lists reviews.
   *
   * Inputs: None.
   * @returns The result produced by `listReviews`.
   * @throws Errors raised by validation or dependent operations.
   */
  listReviews(): ReturnType<StandaloneRepository["listReviewQueue"]>;
  /**
   * Decides review.
   *
   * @param input - Value supplied for `input`.
   * @returns The result produced by `decideReview`.
   * @throws Errors raised by validation or dependent operations.
   */
  decideReview(input: ReviewDecisionInput): ReturnType<StandaloneRepository["decideReview"]>;
  /**
   * Runs retention.
   *
   * Inputs: None.
   * @returns The result produced by `runRetention`.
   * @throws Errors raised by validation or dependent operations.
   */
  runRetention(): Promise<RetentionResult>;
  /**
   * Executes export workspace.
   *
   * Inputs: None.
   * @returns The result produced by `exportWorkspace`.
   * @throws Errors raised by validation or dependent operations.
   */
  exportWorkspace(): Promise<StandaloneExport>;
  /**
   * Executes delete workspace.
   *
   * Inputs: None.
   * @returns The result produced by `deleteWorkspace`.
   * @throws Errors raised by validation or dependent operations.
   */
  deleteWorkspace(): Promise<DeleteResult>;
}

/**
 * Converts to contract memory.
 *
 * @param memory - Value supplied for `memory`.
 * @param workspaceId - Value supplied for `workspaceId`.
 * @returns The result produced by `toContractMemory`.
 * @throws Errors raised by validation or dependent operations.
 */
function toContractMemory(memory: StandaloneMemory, workspaceId: string): Memory {
  return {
    id: memory.id,
    organizationId: workspaceId,
    text: memory.text,
    scope: memory.scope,
    provenance: "explicit_request",
    status: memory.status,
    sessionNote: null,
    createdAt: memory.createdAt.toISOString(),
    updatedAt: memory.updatedAt.toISOString(),
  };
}

/**
 * Queries embedding.
 *
 * @param provider - Value supplied for `provider`.
 * @param query - Value supplied for `query`.
 * @returns The result produced by `queryEmbedding`.
 * @throws Errors raised by validation or dependent operations.
 */
async function queryEmbedding(
  provider: EmbeddingProvider | undefined,
  query: string,
): Promise<number[] | undefined> {
  return provider?.embedQuery(query).catch(() => undefined);
}

/**
 * Creates standalone service.
 *
 * @param options - Value supplied for `options`.
 * @returns The result produced by `createStandaloneService`.
 * @throws Errors raised by validation or dependent operations.
 */
export function createStandaloneService(options: StandaloneServiceOptions): StandaloneService {
  const now = options.now ?? (() => new Date());
  const { repository, workspaceId, actorUserId } = options;

  /**
   * Executes retrieve.
   *
   * @param query - Value supplied for `query`.
   * @param limit - Value supplied for `limit`.
   * @returns The result produced by `retrieve`.
   * @throws Errors raised by validation or dependent operations.
   */
  const retrieve = async (query: string, limit: number) =>
    repository.searchMemories(query, limit, await queryEmbedding(options.embeddingProvider, query));

  return {
    /**
     * Executes log context.
     *
     * @param rawInput - Value supplied for `rawInput`.
     * @returns The result produced by `logContext`.
     * @throws Errors raised by validation or dependent operations.
     */
    async logContext(rawInput) {
      const input = logContextInputSchema.parse(rawInput);
      const receipt = await repository.recordEvent({
        rawEvent: input.rawEvent,
        sourceContext: input.sourceContext,
        sourceType: "mcp",
        sourceTrustClass: "first_party",
        sessionId: input.sessionId,
        messageId: input.messageId,
      });
      return {
        status: "queued",
        eventId: receipt.eventId,
        deduped: receipt.deduped,
        message: LOG_CONTEXT_ACK_MESSAGE,
      };
    },
    /**
     * Saves memory.
     *
     * @param rawInput - Value supplied for `rawInput`.
     * @returns The result produced by `saveMemory`.
     * @throws Errors raised by validation or dependent operations.
     */
    async saveMemory(rawInput) {
      const input = saveMemoryInputSchema.parse(rawInput);
      const receipt = await repository.recordEvent({
        rawEvent: input.text,
        sourceContext: input.sessionNote,
        sourceType: "mcp",
        sourceTrustClass: "first_party",
      });
      return {
        status: "queued",
        eventId: receipt.eventId,
        deduped: receipt.deduped,
        message: LOG_CONTEXT_ACK_MESSAGE,
      };
    },
    /**
     * Gets context.
     *
     * @param rawInput - Value supplied for `rawInput`.
     * @returns The result produced by `getContext`.
     * @throws Errors raised by validation or dependent operations.
     */
    async getContext(rawInput) {
      const input = getContextInputSchema.parse(rawInput);
      const [relevant, current] = await Promise.all([
        retrieve(input.taskContext, input.limit),
        repository.listMemories(100),
      ]);
      const byId = new Map(relevant.map((memory) => [memory.id, memory]));
      for (const memory of current) {
        if (memory.renderPolicy === "pinned" || memory.memoryType === "directive") {
          byId.set(memory.id, memory);
        }
      }
      const rows = [...byId.values()];
      const directives = rows.filter((memory) => memory.memoryType === "directive");
      const resolution = resolveDirectives({
        directives: directives.map((memory) => ({
          memoryId: memory.id,
          content: memory.text,
          title: memory.text,
          subjectEntityId: null,
          subjectEntityType: null,
          ownerScopeType: memory.ownerScopeType,
          sourceAuthority: memory.sourceAuthority,
          validFrom: memory.validFrom.toISOString(),
          audienceAllowed: true,
        })),
        context: {
          actorUserId,
          activeOrgId: workspaceId,
          activeEntityIds: [],
          channel: "packet",
        },
        /**
         * Executes conflict check.
         *
         * Inputs: None.
         * @returns The result produced by `conflictCheck`.
         * @throws Errors raised by validation or dependent operations.
         */
        conflictCheck: () => false,
      });
      const directiveIds = new Set(directives.map((memory) => memory.id));
      const pinned = rows.filter(
        (memory) => memory.renderPolicy === "pinned" && !directiveIds.has(memory.id),
      );
      const procedures = rows.filter((memory) => memory.memoryType === "procedure");
      const userProfile = rows.filter(
        (memory) =>
          memory.ownerScopeType === "user" &&
          (memory.memoryType === "preference" || memory.scope === "profile") &&
          !directiveIds.has(memory.id),
      );
      const orgProfile = rows.filter(
        (memory) => memory.ownerScopeType === "org" && memory.memoryType === "policy",
      );
      const covered = new Set([
        ...directiveIds,
        ...pinned.map((memory) => memory.id),
        ...procedures.map((memory) => memory.id),
        ...userProfile.map((memory) => memory.id),
        ...orgProfile.map((memory) => memory.id),
      ]);
      const packet = composeMemoryPacket({
        directives: resolution,
        pinned: pinned.map((memory) => ({
          memoryId: memory.id,
          memoryType: memory.memoryType,
          text: memory.text,
        })),
        userProfile: userProfile.map((memory) => ({ memoryId: memory.id, text: memory.text })),
        orgProfile: orgProfile.map((memory) => ({ memoryId: memory.id, text: memory.text })),
        memories: rows
          .filter((memory) => !covered.has(memory.id))
          .map((memory) => ({
            memoryId: memory.id,
            memoryType: memory.memoryType,
            text: memory.text,
          })),
        procedures: procedures.map((memory) => ({ memoryId: memory.id, text: memory.text })),
        tokenBudget: CONTEXT_TOKEN_BUDGET,
      });
      return {
        packet,
        envelope: { actorUserId, orgId: workspaceId, entityIds: [], verified: true },
      };
    },
    /**
     * Executes retrieve memories.
     *
     * @param rawInput - Value supplied for `rawInput`.
     * @returns The result produced by `retrieveMemories`.
     * @throws Errors raised by validation or dependent operations.
     */
    async retrieveMemories(rawInput) {
      const input = retrieveMemoryInputSchema.parse(rawInput);
      const rows =
        input.mode === "search" || input.mode === "context"
          ? await retrieve(input.query!, input.limit)
          : (await repository.listMemories(input.limit)).filter((memory) =>
              input.mode === "profile"
                ? memory.scope === "profile"
                : memory.scope === "organization",
            );
      return { memories: rows.map((memory) => toContractMemory(memory, workspaceId)) };
    },
    /**
     * Lists memories.
     *
     * @param rawInput - Value supplied for `rawInput`.
     * @returns The result produced by `listMemories`.
     * @throws Errors raised by validation or dependent operations.
     */
    async listMemories(rawInput) {
      const input = listMemoriesInputSchema.parse(rawInput);
      const rows = (await repository.listMemories(input.limit)).filter(
        (memory) => input.scope === undefined || memory.scope === input.scope,
      );
      return { memories: rows.map((memory) => toContractMemory(memory, workspaceId)) };
    },
    /**
     * Lists reviews.
     *
     * Inputs: None.
     * @returns The result produced by `listReviews`.
     * @throws Errors raised by validation or dependent operations.
     */
    listReviews: () => repository.listReviewQueue(),
    /**
     * Decides review.
     *
     * @param input - Value supplied for `input`.
     * @returns The result produced by `decideReview`.
     * @throws Errors raised by validation or dependent operations.
     */
    decideReview: (input) => repository.decideReview(input, now()),
    /**
     * Runs retention.
     *
     * Inputs: None.
     * @returns The result produced by `runRetention`.
     * @throws Errors raised by validation or dependent operations.
     */
    runRetention() {
      const current = now();
      const cutoff = new Date(current.getTime() - options.rawRetentionDays * 24 * 60 * 60 * 1_000);
      return repository.runRetention(cutoff, current);
    },
    /**
     * Executes export workspace.
     *
     * Inputs: None.
     * @returns The result produced by `exportWorkspace`.
     * @throws Errors raised by validation or dependent operations.
     */
    exportWorkspace: () => repository.exportWorkspace(workspaceId, now()),
    /**
     * Executes delete workspace.
     *
     * Inputs: None.
     * @returns The result produced by `deleteWorkspace`.
     * @throws Errors raised by validation or dependent operations.
     */
    deleteWorkspace: () => repository.deleteWorkspace(),
  };
}
