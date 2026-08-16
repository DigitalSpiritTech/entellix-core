/* oxlint-disable no-await-in-loop */
import type { PolicyMatrixConfig } from "@entellix/contracts/policy-matrix";
import type { Classifier } from "@entellix/core/classifier";
import type { ConflictDetector } from "@entellix/core/conflicts";
import { suggestOperation } from "@entellix/core/conflicts";
import type { Extractor } from "@entellix/core/extractor";
import { evaluateDisposition } from "@entellix/core/policy-matrix";
import { Effect, Either } from "effect";
import { z } from "zod";

import type { CandidateGovernance } from "./contracts.ts";
import type { EmbeddingProvider } from "./providers.ts";
import type { StandaloneRepository } from "./repository.ts";

export const workerRunResultSchema = z.object({
  claimed: z.number().int().min(0).max(1),
  committed: z.number().int().nonnegative(),
  review: z.number().int().nonnegative(),
  rejected: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
});
export type WorkerRunResult = z.infer<typeof workerRunResultSchema>;

export interface StandaloneWorkerDeps {
  actorUserId: string;
  workspaceId: string;
  repository: StandaloneRepository;
  extractor: Pick<Extractor, "extractFromBatch">;
  classifier: Pick<Classifier, "classifyCandidate">;
  conflictDetector: Pick<ConflictDetector, "classifyPairs">;
  matrix: PolicyMatrixConfig;
  embeddingProvider?: EmbeddingProvider;
  now?: () => Date;
}

export interface StandaloneWorker {
  runOnceEffect(): Effect.Effect<WorkerRunResult, never>;
  runOnce(): Promise<WorkerRunResult>;
}

function emptyRunResult(claimed: 0 | 1): WorkerRunResult {
  return { claimed, committed: 0, review: 0, rejected: 0, failed: 0 };
}

export function createStandaloneWorker(deps: StandaloneWorkerDeps): StandaloneWorker {
  const now = deps.now ?? (() => new Date());

  const runOnceEffect = (): Effect.Effect<WorkerRunResult, never> =>
    Effect.gen(function* () {
      const event = yield* Effect.promise(() => deps.repository.claimNextEvent());
      if (!event) return emptyRunResult(0);

      const result = emptyRunResult(1);
      const outcome = yield* Effect.either(
        Effect.tryPromise({
          try: async () => {
            const extraction = await deps.extractor.extractFromBatch({
              batchId: event.id,
              events: [{ id: event.id, actorUserId: deps.actorUserId, rawText: event.rawEvent }],
            });
            const candidates = await deps.repository.persistCandidates(
              event,
              extraction,
              deps.actorUserId,
              deps.workspaceId,
            );

            for (const candidate of candidates) {
              const classified = await deps.classifier.classifyCandidate({
                candidate,
                context: {
                  actorUserId: deps.actorUserId,
                  activeOrgId: deps.workspaceId,
                  sourceTrustClass: event.sourceTrustClass,
                },
              });
              const classification = classified.classification;
              const decision = evaluateDisposition({
                classification: {
                  candidateId: candidate.id,
                  memoryType: classification.memoryType,
                  owner: { scopeType: classification.owner.value },
                  audienceSuggestion: classification.audienceSuggestion.kind,
                  sourceAuthority: classification.sourceAuthority,
                  sensitivity: classification.sensitivity,
                  confidence: classification.confidence,
                },
                sourceTrustClass: event.sourceTrustClass,
                matrix: deps.matrix,
              });
              const governance: CandidateGovernance = { classification, decision };

              if (decision.disposition === "review") {
                await deps.repository.persistCandidateDecision({
                  candidateId: candidate.id,
                  governance,
                  status: "review",
                });
                result.review += 1;
                continue;
              }
              if (decision.disposition === "reject") {
                await deps.repository.persistCandidateDecision({
                  candidateId: candidate.id,
                  governance,
                  status: "rejected",
                });
                result.rejected += 1;
                continue;
              }

              const neighbors = await deps.repository.findNeighbors(candidate, governance);
              const conflicts = await deps.conflictDetector.classifyPairs({
                candidate: { id: candidate.id, text: candidate.candidateText },
                neighbors,
              });
              const operation = suggestOperation(conflicts);
              if (operation.operation === "REVIEW") {
                await deps.repository.persistCandidateDecision({
                  candidateId: candidate.id,
                  governance: {
                    classification,
                    decision: {
                      disposition: "review",
                      matrixVersion: decision.matrixVersion,
                      reason: `conflict requires review: ${operation.relation}`,
                      hardRule: decision.hardRule,
                    },
                  },
                  status: "review",
                });
                result.review += 1;
                continue;
              }

              const embedding = deps.embeddingProvider
                ? ((await deps.embeddingProvider.embedDocuments([candidate.candidateText]))[0] ??
                  null)
                : null;
              await deps.repository.persistCandidateDecision({
                candidateId: candidate.id,
                governance,
                status: "classified",
              });
              await deps.repository.commitCandidate({
                candidate,
                governance,
                operation: operation.operation,
                targetMemoryId: operation.targetMemoryId,
                embedding,
                now: now(),
              });
              result.committed += 1;
            }

            await deps.repository.completeEvent(event.id);
          },
          catch: (error) => error,
        }),
      );

      if (Either.isLeft(outcome)) {
        yield* Effect.promise(() => deps.repository.failEvent(event.id, outcome.left));
        result.failed = 1;
      }
      return workerRunResultSchema.parse(result);
    });

  return {
    runOnceEffect,
    runOnce: () => Effect.runPromise(runOnceEffect()),
  };
}

export interface WorkerLoopOptions {
  intervalMs: number;
  batchSize: number;
  runOnce: () => Promise<WorkerRunResult>;
  runRetention: () => Promise<unknown>;
  onError?: (error: unknown) => void;
}

export interface WorkerLoop {
  stop(): void;
}

export function startWorkerLoop(options: WorkerLoopOptions): WorkerLoop {
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;

  const schedule = () => {
    if (stopped) return;
    timer = setTimeout(run, options.intervalMs);
    timer.unref();
  };

  const run = async () => {
    try {
      for (let index = 0; index < options.batchSize; index += 1) {
        const result = await options.runOnce();
        if (result.claimed === 0) break;
      }
      await options.runRetention();
    } catch (error) {
      options.onError?.(error);
    } finally {
      schedule();
    }
  };

  void run();
  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}
