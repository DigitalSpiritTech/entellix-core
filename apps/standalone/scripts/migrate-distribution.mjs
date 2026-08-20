/* oxlint-disable no-await-in-loop */
import { execFileSync } from "node:child_process";
import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const distributionRoot = resolve(import.meta.dirname, "..");
const migrationsDirectory = join(distributionRoot, "migrations");
const runPsql = (args) =>
  execFileSync("psql", [databaseUrl, "--set", "ON_ERROR_STOP=1", ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });

runPsql([
  "--command",
  "CREATE TABLE IF NOT EXISTS standalone_schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
]);

const migrations = (await readdir(migrationsDirectory))
  .filter((name) => name.endsWith(".sql"))
  .toSorted();

for (const name of migrations) {
  if (!/^[a-zA-Z0-9._-]+\.sql$/.test(name)) throw new Error(`invalid migration name: ${name}`);
  const sqlName = `'${name}'`;
  const applied = runPsql([
    "--tuples-only",
    "--no-align",
    "--command",
    `SELECT 1 FROM standalone_schema_migrations WHERE name = ${sqlName}`,
  ]).trim();
  if (applied === "1") continue;

  runPsql([
    "--single-transaction",
    "--file",
    join(migrationsDirectory, name),
    "--command",
    `INSERT INTO standalone_schema_migrations (name) VALUES (${sqlName})`,
  ]);
  console.log(`Applied ${name}`);
}

console.log("Standalone database migrations are current.");
