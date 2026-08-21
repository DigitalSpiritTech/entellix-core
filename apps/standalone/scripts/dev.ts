/**
 * Runs the standalone dev workflow.
 *
 * Inputs: Imported dependencies and values passed to the module's documented functions.
 * Outputs: Exported types, values, and behavior provided by the module.
 * Errors: Functions document validation, dependency, and runtime errors individually.
 *
 * @packageDocumentation
 */

import { spawn } from "node:child_process";

import { loadStandaloneConfig } from "../src/config.ts";
import { migrateStandaloneDatabase } from "../src/migrations.ts";

const config = loadStandaloneConfig(process.env);
await migrateStandaloneDatabase({ databaseUrl: config.DATABASE_URL });

const child = spawn("pnpm", ["exec", "mastra", "dev"], {
  env: { ...process.env, PORT: process.env.PORT ?? "4211" },
  stdio: "inherit",
});

/**
 * Executes stop child.
 *
 * @param signal - Value supplied for `signal`.
 * @returns The result produced by `stopChild`.
 * @throws Errors raised by validation or dependent operations.
 */
const stopChild = (signal: NodeJS.Signals) => {
  if (!child.killed) child.kill(signal);
};
process.on("SIGINT", () => stopChild("SIGINT"));
process.on("SIGTERM", () => stopChild("SIGTERM"));
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
