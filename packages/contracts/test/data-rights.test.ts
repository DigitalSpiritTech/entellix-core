import { describe, expect, it, vi } from "vitest";

import { serializeDataRightsExport, type DataRightsExport } from "../src/data-rights.ts";

const DOCUMENT: DataRightsExport = {
  schemaVersion: "entellix.data-rights.export/v1",
  manifest: {
    requestId: "00000000-0000-4000-8000-000000000001",
    scope: { kind: "user", id: "00000000-0000-4000-8000-000000000002" },
    generatedAt: "2026-07-17T12:00:00.000Z",
    artifactCount: 1,
    checksum: "0".repeat(64),
  },
  artifacts: [
    {
      kind: "canonical_memory",
      id: "memory-1",
      owner: { kind: "user", id: "00000000-0000-4000-8000-000000000002" },
      data: { zulu: true, Alpha: true, alpha: true, nested: { zebra: 1, Apple: 2 } },
    },
  ],
};

describe("data-rights canonical JSON", () => {
  it("is independent of runtime locale collation", () => {
    const expected = serializeDataRightsExport(DOCUMENT);
    const localeCompare = vi.spyOn(String.prototype, "localeCompare").mockImplementation(function (
      this: string,
      other: string,
    ) {
      const left = String(this);
      return left < other ? 1 : left > other ? -1 : 0;
    });

    try {
      expect(serializeDataRightsExport(DOCUMENT)).toBe(expected);
    } finally {
      localeCompare.mockRestore();
    }
  });
});
