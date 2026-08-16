import { PostgresStore } from "@mastra/pg";
import { describe, expect, it } from "vitest";

import { createStandaloneMastraStorage } from "../storage.ts";

describe("standalone Mastra storage", () => {
  it("uses the standalone PostgreSQL database instead of process memory", async () => {
    const storage = createStandaloneMastraStorage({
      DATABASE_URL: "postgres://entellix:secret@localhost:5432/entellix",
      ENTELLIX_MASTRA_SCHEMA: "entellix_mastra",
    });

    expect(storage).toBeInstanceOf(PostgresStore);
    await storage.close();
  });
});
