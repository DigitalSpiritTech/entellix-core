import { loadStandaloneConfig } from "../src/config.ts";
import { migrateStandaloneDatabase } from "../src/migrations.ts";

const config = loadStandaloneConfig(process.env);
await migrateStandaloneDatabase({ databaseUrl: config.DATABASE_URL });
console.log("Standalone database migrations are current.");
