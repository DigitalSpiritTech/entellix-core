/**
 * Creates Mastra storage backed by the configured standalone PostgreSQL schema.
 *
 * Inputs: Imported dependencies and values passed to the module's documented functions.
 * Outputs: Exported types, values, and behavior provided by the module.
 * Errors: Functions document validation, dependency, and runtime errors individually.
 *
 * @packageDocumentation
 */

import { PostgresStore } from "@mastra/pg";

import type { StandaloneConfig } from "./config.ts";

/**
 * Creates standalone mastra storage.
 *
 * @param config - Value supplied for `config`.
 * @returns The result produced by `createStandaloneMastraStorage`.
 * @throws Errors raised by validation or dependent operations.
 */
export function createStandaloneMastraStorage(
  config: Pick<StandaloneConfig, "DATABASE_URL" | "ENTELLIX_MASTRA_SCHEMA">,
) {
  return new PostgresStore({
    id: "entellix-standalone",
    connectionString: config.DATABASE_URL,
    schemaName: config.ENTELLIX_MASTRA_SCHEMA,
  });
}
