/**
 * Runs the standalone migrate workflow.
 *
 * Inputs: Imported dependencies and values passed to the module's documented functions.
 * Outputs: Exported types, values, and behavior provided by the module.
 * Errors: Functions document validation, dependency, and runtime errors individually.
 *
 * @packageDocumentation
 */

import { loadStandaloneConfig } from "../src/config.ts";
import { migrateStandaloneDatabase } from "../src/migrations.ts";

const config = loadStandaloneConfig(process.env);
await migrateStandaloneDatabase({ databaseUrl: config.DATABASE_URL });
console.log("Standalone database migrations are current.");
