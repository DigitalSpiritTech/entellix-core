import { z } from "zod";

import { STANDALONE_ACTOR_ID, STANDALONE_WORKSPACE_ID } from "./contracts.ts";

const integerFromEnv = (fallback: number, minimum: number) =>
  z.coerce.number().int().min(minimum).default(fallback);

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
  ENTELLIX_EMBEDDING_URL: z.url().optional(),
  ENTELLIX_EMBEDDING_API_KEY: z.string().min(1).optional(),
  ENTELLIX_EMBEDDING_MODEL: z.string().min(1).default("voyage-4"),
});
export type StandaloneConfig = z.infer<typeof standaloneConfigSchema>;

export function loadStandaloneConfig(env: NodeJS.ProcessEnv | Record<string, string | undefined>) {
  return standaloneConfigSchema.parse(env);
}
