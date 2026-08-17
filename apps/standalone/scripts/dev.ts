import { spawn } from "node:child_process";

import { loadStandaloneConfig } from "../src/config.ts";
import { migrateStandaloneDatabase } from "../src/migrations.ts";

const config = loadStandaloneConfig(process.env);
await migrateStandaloneDatabase({ databaseUrl: config.DATABASE_URL });

const child = spawn("pnpm", ["exec", "mastra", "dev"], {
  env: { ...process.env, PORT: process.env.PORT ?? "4211" },
  stdio: "inherit",
});

const stopChild = (signal: NodeJS.Signals) => {
  if (!child.killed) child.kill(signal);
};
process.on("SIGINT", () => stopChild("SIGINT"));
process.on("SIGTERM", () => stopChild("SIGTERM"));
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
