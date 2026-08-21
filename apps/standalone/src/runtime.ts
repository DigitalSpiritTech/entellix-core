/**
 * Composes validated configuration, providers, storage, services, and workers.
 *
 * Inputs: Imported dependencies and values passed to the module's documented functions.
 * Outputs: Exported types, values, and behavior provided by the module.
 * Errors: Functions document validation, dependency, and runtime errors individually.
 *
 * @packageDocumentation
 */

import { EXTRACTOR_PROMPT_VERSION } from "@entellix/contracts/candidates";
import { CLASSIFIER_PROMPT_VERSION } from "@entellix/contracts/classification";
import { CONFLICT_PROMPT_VERSION } from "@entellix/contracts/conflicts";
import { createClassifier } from "@entellix/core/classifier";
import { createConflictDetector } from "@entellix/core/conflicts";
import { createExtractor } from "@entellix/core/extractor";

import { createLocalTokenVerifier } from "./auth.ts";
import { loadStandaloneConfig } from "./config.ts";
import { migrateStandaloneDatabase } from "./migrations.ts";
import { STANDALONE_POLICY_MATRIX } from "./policy.ts";
import { createAnthropicGenerationProvider, createHttpEmbeddingProvider } from "./providers.ts";
import { createPostgresStandaloneRepository } from "./repository-postgres.ts";
import { createStandaloneService } from "./service.ts";
import { createStandaloneWorker, startWorkerLoop } from "./worker.ts";

export const standaloneConfig = loadStandaloneConfig(process.env);
await migrateStandaloneDatabase({ databaseUrl: standaloneConfig.DATABASE_URL });
export const standaloneRepository = createPostgresStandaloneRepository({
  databaseUrl: standaloneConfig.DATABASE_URL,
  actorUserId: standaloneConfig.ENTELLIX_ACTOR_ID,
  workspaceId: standaloneConfig.ENTELLIX_WORKSPACE_ID,
});
const generationProvider = createAnthropicGenerationProvider({
  apiKey: standaloneConfig.ANTHROPIC_API_KEY,
  model: standaloneConfig.ENTELLIX_GENERATION_MODEL,
});
export const standaloneEmbeddingProvider = standaloneConfig.ENTELLIX_EMBEDDING_API_KEY
  ? createHttpEmbeddingProvider({
      apiKey: standaloneConfig.ENTELLIX_EMBEDDING_API_KEY,
      model: standaloneConfig.ENTELLIX_EMBEDDING_MODEL,
      url: standaloneConfig.ENTELLIX_EMBEDDING_URL,
    })
  : undefined;

export const verifyStandaloneToken = createLocalTokenVerifier({
  token: standaloneConfig.ENTELLIX_LOCAL_TOKEN,
  actorUserId: standaloneConfig.ENTELLIX_ACTOR_ID,
});

const extractor = createExtractor({
  generate: generationProvider.generate,
  config: {
    model: standaloneConfig.ENTELLIX_GENERATION_MODEL,
    promptVersion: EXTRACTOR_PROMPT_VERSION,
  },
});
const classifier = createClassifier({
  generate: generationProvider.generate,
  config: {
    model: standaloneConfig.ENTELLIX_GENERATION_MODEL,
    promptVersion: CLASSIFIER_PROMPT_VERSION,
  },
  /**
   * Resolves entity fn.
   *
   * Inputs: None.
   * @returns The result produced by `resolveEntityFn`.
   * @throws Errors raised by validation or dependent operations.
   */
  resolveEntityFn: async () => ({ kind: "none" }),
  /**
   * Lists memberships fn.
   *
   * Inputs: None.
   * @returns The result produced by `listMembershipsFn`.
   * @throws Errors raised by validation or dependent operations.
   */
  listMembershipsFn: async () => [],
});
const conflictDetector = createConflictDetector({
  generate: generationProvider.generate,
  config: {
    model: standaloneConfig.ENTELLIX_GENERATION_MODEL,
    promptVersion: CONFLICT_PROMPT_VERSION,
  },
});

export const standaloneWorker = createStandaloneWorker({
  actorUserId: standaloneConfig.ENTELLIX_ACTOR_ID,
  workspaceId: standaloneConfig.ENTELLIX_WORKSPACE_ID,
  repository: standaloneRepository,
  extractor,
  classifier,
  conflictDetector,
  matrix: STANDALONE_POLICY_MATRIX,
  embeddingProvider: standaloneEmbeddingProvider,
});
export const standaloneService = createStandaloneService({
  actorUserId: standaloneConfig.ENTELLIX_ACTOR_ID,
  workspaceId: standaloneConfig.ENTELLIX_WORKSPACE_ID,
  rawRetentionDays: standaloneConfig.ENTELLIX_RAW_RETENTION_DAYS,
  repository: standaloneRepository,
  embeddingProvider: standaloneEmbeddingProvider,
});

export const standaloneWorkerLoop = startWorkerLoop({
  intervalMs: standaloneConfig.ENTELLIX_WORKER_INTERVAL_MS,
  batchSize: standaloneConfig.ENTELLIX_WORKER_BATCH_SIZE,
  runOnce: standaloneWorker.runOnce,
  runRetention: standaloneService.runRetention,
  /**
   * Executes on error.
   *
   * @param error - Value supplied for `error`.
   * @returns The result produced by `onError`.
   * @throws Errors raised by validation or dependent operations.
   */
  onError: (error) => console.error("[standalone-worker] pass failed", error),
});

/**
 * Executes stop.
 *
 * Inputs: None.
 * @returns The result produced by `stop`.
 * @throws Errors raised by validation or dependent operations.
 */
const stop = () => {
  standaloneWorkerLoop.stop();
  void standaloneRepository.close();
};
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
