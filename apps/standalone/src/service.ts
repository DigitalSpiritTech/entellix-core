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
  now?: () => Date;
}

export interface StandaloneService {
  logContext(input: LogContextInput): Promise<LogContextOutput>;
  saveMemory(input: SaveMemoryInput): Promise<LogContextOutput>;
  getContext(input: GetContextInput): Promise<GetContextOutput>;
  retrieveMemories(input: RetrieveMemoryInput): Promise<RetrieveMemoryOutput>;
  listMemories(input: ListMemoriesInput): Promise<ListMemoriesOutput>;
  listReviews(): ReturnType<StandaloneRepository["listReviewQueue"]>;
  decideReview(input: ReviewDecisionInput): ReturnType<StandaloneRepository["decideReview"]>;
  runRetention(): Promise<RetentionResult>;
  exportWorkspace(): Promise<StandaloneExport>;
  deleteWorkspace(): Promise<DeleteResult>;
}

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

async function queryEmbedding(
  provider: EmbeddingProvider | undefined,
  query: string,
): Promise<number[] | undefined> {
  return provider?.embedQuery(query).catch(() => undefined);
}

export function createStandaloneService(options: StandaloneServiceOptions): StandaloneService {
  const now = options.now ?? (() => new Date());
  const { repository, workspaceId, actorUserId } = options;

  const retrieve = async (query: string, limit: number) =>
    repository.searchMemories(query, limit, await queryEmbedding(options.embeddingProvider, query));

  return {
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
    async listMemories(rawInput) {
      const input = listMemoriesInputSchema.parse(rawInput);
      const rows = (await repository.listMemories(input.limit)).filter(
        (memory) => input.scope === undefined || memory.scope === input.scope,
      );
      return { memories: rows.map((memory) => toContractMemory(memory, workspaceId)) };
    },
    listReviews: () => repository.listReviewQueue(),
    decideReview: (input) => repository.decideReview(input, now()),
    runRetention() {
      const current = now();
      const cutoff = new Date(current.getTime() - options.rawRetentionDays * 24 * 60 * 60 * 1_000);
      return repository.runRetention(cutoff, current);
    },
    exportWorkspace: () => repository.exportWorkspace(workspaceId, now()),
    deleteWorkspace: () => repository.deleteWorkspace(),
  };
}
