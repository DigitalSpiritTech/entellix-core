/* oxlint-disable no-await-in-loop */
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

import postgres from "postgres";
import { z } from "zod";

const migrationOptionsSchema = z.object({
  databaseUrl: z.url(),
  migrationsDirectory: z.string().min(1).default(join(process.cwd(), "migrations")),
});

export async function migrateStandaloneDatabase(
  rawOptions: z.input<typeof migrationOptionsSchema>,
): Promise<void> {
  const options = migrationOptionsSchema.parse(rawOptions);
  const sql = postgres(options.databaseUrl, { max: 1 });
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS standalone_schema_migrations (
        name text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `;
    const names = (await readdir(options.migrationsDirectory))
      .filter((name) => name.endsWith(".sql"))
      .toSorted();
    for (const name of names) {
      const [applied] =
        await sql`SELECT name FROM standalone_schema_migrations WHERE name = ${name}`;
      if (applied) continue;
      const source = await readFile(join(options.migrationsDirectory, name), "utf8");
      await sql.begin(async (tx) => {
        await tx.unsafe(source);
        await tx`INSERT INTO standalone_schema_migrations (name) VALUES (${name})`;
      });
    }
  } finally {
    await sql.end();
  }
}
