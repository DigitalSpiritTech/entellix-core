import { describe, expect, it } from "vitest";

import {
  RETRIEVE_MODES,
  getContextInputSchema,
  listMemoriesInputSchema,
  retrieveMemoryInputSchema,
  saveMemoryInputSchema,
  saveMemoryOutputSchema,
  updateMemoryInputSchema,
} from "../src/index.ts";

describe("saveMemoryInputSchema", () => {
  it("accepts a raw user statement with defaults applied", () => {
    const parsed = saveMemoryInputSchema.parse({ text: "We never write copy with em dashes" });
    expect(parsed).toEqual({
      text: "We never write copy with em dashes",
      scope: "profile",
      provenance: "explicit_request",
    });
  });

  it("accepts a structured payload with explicit scope, provenance, and session note", () => {
    const parsed = saveMemoryInputSchema.parse({
      text: "Acme Consulting is the business name",
      scope: "organization",
      provenance: "tutorial",
      sessionNote: "captured by /entellix:init",
    });
    expect(parsed.scope).toBe("organization");
    expect(parsed.provenance).toBe("tutorial");
    expect(parsed.sessionNote).toBe("captured by /entellix:init");
  });

  it("rejects empty text", () => {
    expect(saveMemoryInputSchema.safeParse({ text: "" }).success).toBe(false);
  });

  it("rejects unknown scopes", () => {
    expect(saveMemoryInputSchema.safeParse({ text: "x", scope: "client" }).success).toBe(false);
  });
});

describe("saveMemoryOutputSchema", () => {
  it("returns a saved memory without review links", () => {
    const result = saveMemoryOutputSchema.safeParse({
      memory: {
        id: "6f2b9a3e-9c1d-4a5b-8e7f-1a2b3c4d5e6f",
        organizationId: "0d9c8b7a-6f5e-4d3c-8b1a-9e8f7a6b5c4d",
        text: "remember this",
        scope: "profile",
        provenance: "explicit_request",
        status: "active",
        sessionNote: null,
        createdAt: "2026-06-11T10:00:00.000Z",
        updatedAt: "2026-06-11T10:00:00.000Z",
      },
    });
    expect(result.success).toBe(true);
  });

  it("strips review links from the tool output contract", () => {
    const result = saveMemoryOutputSchema.safeParse({
      memory: {
        id: "6f2b9a3e-9c1d-4a5b-8e7f-1a2b3c4d5e6f",
        organizationId: "0d9c8b7a-6f5e-4d3c-8b1a-9e8f7a6b5c4d",
        text: "remember this",
        scope: "profile",
        provenance: "explicit_request",
        status: "active",
        sessionNote: null,
        createdAt: "2026-06-11T10:00:00.000Z",
        updatedAt: "2026-06-11T10:00:00.000Z",
      },
      appUrl: "/memories/6f2b9a3e-9c1d-4a5b-8e7f-1a2b3c4d5e6f",
    });
    expect(result.success).toBe(true);
    if (!result.success) throw new Error("expected saveMemoryOutputSchema to parse");
    expect("appUrl" in result.data).toBe(false);
  });
});

describe("getContextInputSchema", () => {
  it("requires a task context with the default limit", () => {
    const parsed = getContextInputSchema.parse({
      taskContext:
        "Draft a concise status update using the current work, active constraints, and prior decisions.",
    });
    expect(parsed.taskContext).toContain("status update");
    expect(parsed.limit).toBe(20);
  });

  it("rejects empty task context", () => {
    expect(getContextInputSchema.safeParse({ taskContext: "" }).success).toBe(false);
  });

  it("rejects oversized task context", () => {
    expect(getContextInputSchema.safeParse({ taskContext: "x".repeat(4001) }).success).toBe(false);
  });

  it("bounds the limit like retrieval", () => {
    expect(getContextInputSchema.safeParse({ taskContext: "x", limit: 0 }).success).toBe(false);
    expect(getContextInputSchema.safeParse({ taskContext: "x", limit: 51 }).success).toBe(false);
  });
});

describe("retrieveMemoryInputSchema", () => {
  it("exposes the four MVP retrieval modes", () => {
    expect(RETRIEVE_MODES).toEqual(["search", "context", "profile", "organization"]);
  });

  it("defaults to search mode with the default limit", () => {
    const parsed = retrieveMemoryInputSchema.parse({ query: "color palette" });
    expect(parsed.mode).toBe("search");
    expect(parsed.limit).toBe(20);
  });

  it("requires a query for search mode", () => {
    expect(retrieveMemoryInputSchema.safeParse({ mode: "search" }).success).toBe(false);
  });

  it("requires a query for context mode", () => {
    expect(retrieveMemoryInputSchema.safeParse({ mode: "context" }).success).toBe(false);
  });

  it("allows profile mode without a query", () => {
    expect(retrieveMemoryInputSchema.safeParse({ mode: "profile" }).success).toBe(true);
  });

  it("allows organization mode without a query", () => {
    expect(retrieveMemoryInputSchema.safeParse({ mode: "organization" }).success).toBe(true);
  });

  it("bounds the limit", () => {
    expect(retrieveMemoryInputSchema.safeParse({ mode: "profile", limit: 0 }).success).toBe(false);
    expect(retrieveMemoryInputSchema.safeParse({ mode: "profile", limit: 51 }).success).toBe(false);
  });
});

describe("listMemoriesInputSchema", () => {
  it("defaults the limit and leaves scope unfiltered", () => {
    const parsed = listMemoriesInputSchema.parse({});
    expect(parsed.limit).toBe(20);
    expect(parsed.scope).toBeUndefined();
  });

  it("accepts a scope filter", () => {
    expect(listMemoriesInputSchema.parse({ scope: "organization" }).scope).toBe("organization");
  });
});

describe("updateMemoryInputSchema", () => {
  it("rejects an empty update", () => {
    expect(updateMemoryInputSchema.safeParse({}).success).toBe(false);
  });

  it("accepts a text-only update", () => {
    expect(updateMemoryInputSchema.safeParse({ text: "corrected fact" }).success).toBe(true);
  });

  it("accepts a scope-only update", () => {
    expect(updateMemoryInputSchema.safeParse({ scope: "organization" }).success).toBe(true);
  });

  it("accepts clearing the session note with null", () => {
    expect(updateMemoryInputSchema.safeParse({ sessionNote: null }).success).toBe(true);
  });
});
