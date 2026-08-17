import { describe, expect, it } from "vitest";

import { createLocalTokenVerifier, tokenFromAuthorization } from "../auth.ts";

describe("standalone local authentication", () => {
  it("accepts only the configured bearer token", async () => {
    const verify = createLocalTokenVerifier({
      token: "correct-horse-battery-staple-123456",
      actorUserId: "00000000-0000-4000-8000-000000000011",
    });

    await expect(verify("correct-horse-battery-staple-123456")).resolves.toEqual({
      userId: "00000000-0000-4000-8000-000000000011",
    });
    await expect(verify("correct-horse-battery-staple-123457")).rejects.toThrow("invalid token");
  });

  it("parses a strict bearer authorization header", () => {
    expect(tokenFromAuthorization("Bearer local-token")).toBe("local-token");
    expect(tokenFromAuthorization("bearer local-token")).toBeUndefined();
    expect(tokenFromAuthorization("Basic local-token")).toBeUndefined();
  });
});
