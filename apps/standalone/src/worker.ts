/**
 * Processes queued memory events through extraction and governance stages.
 *
 * Inputs: Imported dependencies and values passed to the module's documented functions.
 * Outputs: Exported types, values, and behavior provided by the module.
 * Errors: Functions document validation, dependency, and runtime errors individually.
 *
 * @packageDocumentation
 */

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
  /**
   * Executes now.
   *
   * Inputs: None.
   * @returns The result produced by `now`.
   * @throws Errors raised by validation or dependent operations.
   */
  now?: () => Date;
}

export interface StandaloneWorker {
  /**
   * Runs once effect.
   *
   * Inputs: None.
   * @returns The result produced by `runOnceEffect`.
   * @throws Errors raised by validation or dependent operations.
   */
  runOnceEffect(): Effect.Effect<WorkerRunResult, never>;
  /**
   * Runs once.
   *
   * Inputs: None.
   * @returns The result produced by `runOnce`.
   * @throws Errors raised by validation or dependent operations.
   */
  runOnce(): Promise<WorkerRunResult>;
}

/**
 * Executes empty run result.
 *
 * @param claimed - Value supplied for `claimed`.
 * @returns The result produced by `emptyRunResult`.
 * @throws Errors raised by validation or dependent operations.
 */
function emptyRunResult(claimed: 0 | 1): WorkerRunResult {
  return { claimed, committed: 0, review: 0, rejected: 0, failed: 0 };
}

/**
 * Creates standalone worker.
 *
 * @param deps - Value supplied for `deps`.
 * @returns The result produced by `createStandaloneWorker`.
 * @throws Errors raised by validation or dependent operations.
 */
export function createStandaloneWorker(deps: StandaloneWorkerDeps): StandaloneWorker {
  const now = deps.now ?? (() => new Date());

  /**
   * Runs once effect.
   *
   * Inputs: None.
   * @returns The result produced by `runOnceEffect`.
   * @throws Errors raised by validation or dependent operations.
   */
  const runOnceEffect = (): Effect.Effect<WorkerRunResult, never> =>
    Effect.gen(function* () {
      const event = yield* Effect.promise(() => deps.repository.claimNextEvent());
      if (!event) return emptyRunResult(0);

      const result = emptyRunResult(1);
      const outcome = yield* Effect.either(
        Effect.tryPromise({
          /**
           * Executes try.
           *
           * Inputs: None.
           * @returns The result produced by `try`.
           * @throws Errors raised by validation or dependent operations.
           */
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
          /**
           * Executes catch.
           *
           * @param error - Value supplied for `error`.
           * @returns The result produced by `catch`.
           * @throws Errors raised by validation or dependent operations.
           */
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
    /**
     * Runs once.
     *
     * Inputs: None.
     * @returns The result produced by `runOnce`.
     * @throws Errors raised by validation or dependent operations.
     */
    runOnce: () => Effect.runPromise(runOnceEffect()),
  };
}

export interface WorkerLoopOptions {
  intervalMs: number;
  batchSize: number;
  /**
   * Runs once.
   *
   * Inputs: None.
   * @returns The result produced by `runOnce`.
   * @throws Errors raised by validation or dependent operations.
   */
  runOnce: () => Promise<WorkerRunResult>;
  /**
   * Runs retention.
   *
   * Inputs: None.
   * @returns The result produced by `runRetention`.
   * @throws Errors raised by validation or dependent operations.
   */
  runRetention: () => Promise<unknown>;
  /**
   * Executes on error.
   *
   * @param error - Value supplied for `error`.
   * @returns Nothing.
   * @throws Errors raised by validation or dependent operations.
   */
  onError?: (error: unknown) => void;
}

export interface WorkerLoop {
  /**
   * Executes stop.
   *
   * Inputs: None.
   * @returns Nothing.
   * @throws Errors raised by validation or dependent operations.
   */
  stop(): void;
}

/**
 * Executes start worker loop.
 *
 * @param options - Value supplied for `options`.
 * @returns The result produced by `startWorkerLoop`.
 * @throws Errors raised by validation or dependent operations.
 */
export function startWorkerLoop(options: WorkerLoopOptions): WorkerLoop {
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;

  /**
   * Executes schedule.
   *
   * Inputs: None.
   * @returns The result produced by `schedule`.
   * @throws Errors raised by validation or dependent operations.
   */
  const schedule = () => {
    if (stopped) return;
    timer = setTimeout(run, options.intervalMs);
    timer.unref();
  };

  /**
   * Executes run.
   *
   * Inputs: None.
   * @returns The result produced by `run`.
   * @throws Errors raised by validation or dependent operations.
   */
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
    /**
     * Executes stop.
     *
     * Inputs: None.
     * @returns The result produced by `stop`.
     * @throws Errors raised by validation or dependent operations.
     */
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}
