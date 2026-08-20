/**
 * Implements config behavior for this TypeScript module.
 *
 * Inputs: Imported dependencies and values passed to the module's documented functions.
 * Outputs: Exported types, values, and behavior provided by the module.
 * Errors: Functions document validation, dependency, and runtime errors individually.
 *
 * @packageDocumentation
 */

import { z } from "zod";

import { STANDALONE_ACTOR_ID, STANDALONE_WORKSPACE_ID } from "./contracts.ts";

/**
 * Executes integer from env.
 *
 * @param fallback - Value supplied for `fallback`.
 * @param minimum - Value supplied for `minimum`.
 * @returns The result produced by `integerFromEnv`.
 * @throws Errors raised by validation or dependent operations.
 */
const integerFromEnv = (fallback: number, minimum: number) =>
  z.coerce.number().int().min(minimum).default(fallback);

/**
 * Executes optional from env.
 *
 * @param schema - Value supplied for `schema`.
 * @returns The result produced by `optionalFromEnv`.
 * @throws Errors raised by validation or dependent operations.
 */
const optionalFromEnv = <Schema extends z.ZodType>(schema: Schema) =>
  z.preprocess((value) => (value === "" ? undefined : value), schema.optional());

export const standaloneConfigSchema = z.object({
  DATABASE_URL: z.url(),
  ENTELLIX_LOCAL_TOKEN: z.string().min(24),
  ENTELLIX_ACTOR_ID: z.uuid().default(STANDALONE_ACTOR_ID),
  ENTELLIX_WORKSPACE_ID: z.uuid().default(STANDALONE_WORKSPACE_ID),
  ENTELLIX_API_URL: z.url().default("http://localhost:4211"),
  ENTELLIX_MASTRA_SCHEMA: z
    .string()
    .regex(/^[a-z_][a-z0-9_]*$/)
    .default("entellix_mastra"),
  ENTELLIX_WORKER_INTERVAL_MS: integerFromEnv(2_000, 250),
  ENTELLIX_RAW_RETENTION_DAYS: integerFromEnv(30, 1),
  ENTELLIX_WORKER_BATCH_SIZE: integerFromEnv(10, 1),
  ANTHROPIC_API_KEY: z.string().min(1),
  ENTELLIX_GENERATION_MODEL: z.string().min(1).default("claude-haiku-4-5-20251001"),
  ENTELLIX_EMBEDDING_URL: optionalFromEnv(z.url()),
  ENTELLIX_EMBEDDING_API_KEY: optionalFromEnv(z.string().min(1)),
  ENTELLIX_EMBEDDING_MODEL: z.string().min(1).default("voyage-4"),
});
export type StandaloneConfig = z.infer<typeof standaloneConfigSchema>;

/**
 * Loads standalone config.
 *
 * @param env - Value supplied for `env`.
 * @returns The result produced by `loadStandaloneConfig`.
 * @throws Errors raised by validation or dependent operations.
 */
export function loadStandaloneConfig(env: NodeJS.ProcessEnv | Record<string, string | undefined>) {
  return standaloneConfigSchema.parse(env);
}
