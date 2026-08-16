import { PostgresStore } from "@mastra/pg";

import type { StandaloneConfig } from "./config.ts";

export function createStandaloneMastraStorage(
  config: Pick<StandaloneConfig, "DATABASE_URL" | "ENTELLIX_MASTRA_SCHEMA">,
) {
  return new PostgresStore({
    id: "entellix-standalone",
    connectionString: config.DATABASE_URL,
    schemaName: config.ENTELLIX_MASTRA_SCHEMA,
  });
}
