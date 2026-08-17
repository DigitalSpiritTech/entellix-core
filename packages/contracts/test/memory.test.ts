import { describe, expect, it } from "vitest";

import {
  MEMORY_PROVENANCES,
  MEMORY_SCOPES,
  MEMORY_STATUSES,
  memoryProvenanceSchema,
  memorySchema,
  memoryScopeSchema,
  memoryStatusSchema,
} from "../src/index.ts";

const validMemory = {
  id: "6f2b9a3e-9c1d-4a5b-8e7f-1a2b3c4d5e6f",
  organizationId: "0d9c8b7a-6f5e-4d3c-8b1a-9e8f7a6b5c4d",
  text: "Jon prefers Slack communication",
  scope: "profile",
  provenance: "explicit_request",
  status: "active",
  sessionNote: null,
  createdAt: "2026-06-11T10:00:00.000Z",
  updatedAt: "2026-06-11T10:00:00.000Z",
};

describe("memory enums", () => {
  it("defines exactly the MVP scopes", () => {
    expect(MEMORY_SCOPES).toEqual(["profile", "organization"]);
  });

  it("defines exactly the MVP provenances", () => {
    expect(MEMORY_PROVENANCES).toEqual([
      "tutorial",
      "explicit_request",
      "session_end",
      "pre_compaction",
    ]);
  });

  it("keeps the v1 statuses in their original positions", () => {
    expect(MEMORY_STATUSES[0]).toBe("active");
    expect(MEMORY_STATUSES[1]).toBe("removed");
  });

  it("rejects values outside the enums", () => {
    expect(memoryScopeSchema.safeParse("client").success).toBe(false);
    expect(memoryProvenanceSchema.safeParse("import").success).toBe(false);
    expect(memoryStatusSchema.safeParse("archived").success).toBe(false);
  });
});

describe("memorySchema", () => {
  it("accepts a complete valid memory", () => {
    const parsed = memorySchema.parse(validMemory);
    expect(parsed).toEqual(validMemory);
  });

  it("accepts an optional session note string", () => {
    const parsed = memorySchema.parse({ ...validMemory, sessionNote: "captured during planning" });
    expect(parsed.sessionNote).toBe("captured during planning");
  });

  it("rejects a non-uuid id", () => {
    expect(memorySchema.safeParse({ ...validMemory, id: "not-a-uuid" }).success).toBe(false);
  });

  it("rejects empty memory text", () => {
    expect(memorySchema.safeParse({ ...validMemory, text: "" }).success).toBe(false);
    expect(memorySchema.safeParse({ ...validMemory, text: "   " }).success).toBe(false);
  });

  it("trims surrounding whitespace from text", () => {
    const parsed = memorySchema.parse({ ...validMemory, text: "  keep the core fact  " });
    expect(parsed.text).toBe("keep the core fact");
  });

  it("rejects text above 4000 characters", () => {
    expect(memorySchema.safeParse({ ...validMemory, text: "x".repeat(4001) }).success).toBe(false);
  });

  it("rejects timestamps that are not ISO datetimes", () => {
    expect(memorySchema.safeParse({ ...validMemory, createdAt: "June 11, 2026" }).success).toBe(
      false,
    );
  });

  it("accepts ISO datetimes with timezone offsets", () => {
    const parsed = memorySchema.parse({ ...validMemory, updatedAt: "2026-06-11T05:00:00-05:00" });
    expect(parsed.updatedAt).toBe("2026-06-11T05:00:00-05:00");
  });
});
