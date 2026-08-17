import { describe, expect, it } from "vitest";

import { loadStandaloneConfig } from "../config.ts";

const required = {
  DATABASE_URL: "postgres://entellix:secret@localhost:5432/entellix",
  ENTELLIX_LOCAL_TOKEN: "correct-horse-battery-staple-123456",
  ANTHROPIC_API_KEY: "anthropic-test-key",
};

describe("standalone config", () => {
  it("provides one fixed workspace and actor with bounded worker defaults", () => {
    const config = loadStandaloneConfig(required);

    expect(config.ENTELLIX_ACTOR_ID).toMatch(/[0-9a-f-]{36}/);
    expect(config.ENTELLIX_WORKSPACE_ID).toMatch(/[0-9a-f-]{36}/);
    expect(config.ENTELLIX_ACTOR_ID).not.toBe(config.ENTELLIX_WORKSPACE_ID);
    expect(config.ENTELLIX_WORKER_INTERVAL_MS).toBeGreaterThanOrEqual(250);
    expect(config.ENTELLIX_RAW_RETENTION_DAYS).toBeGreaterThan(0);
    expect(config.ENTELLIX_MASTRA_SCHEMA).toBe("entellix_mastra");
  });

  it("rejects a weak local token", () => {
    expect(() => loadStandaloneConfig({ ...required, ENTELLIX_LOCAL_TOKEN: "short" })).toThrow(
      "Too small",
    );
  });

  it("rejects an unsafe Mastra schema identifier", () => {
    expect(() =>
      loadStandaloneConfig({ ...required, ENTELLIX_MASTRA_SCHEMA: "public; drop schema public" }),
    ).toThrow("Invalid");
  });
});
