import { describe, expect, it } from "vitest";

import {
  ACTIVE_ENTELLIX_SERVER_INSTRUCTIONS,
  ACTIVE_ENTELLIX_TOOL_DESCRIPTIONS,
  ENTELLIX_MCP_TOOL_IDS,
  entellixServerInstructionsSchema,
  entellixToolDescriptionsSchema,
} from "../mcp.ts";

describe("shared MCP guidance", () => {
  it("owns the complete six-tool surface as validated data", () => {
    expect(entellixToolDescriptionsSchema.parse(ACTIVE_ENTELLIX_TOOL_DESCRIPTIONS)).toEqual(
      ACTIVE_ENTELLIX_TOOL_DESCRIPTIONS,
    );
    expect(Object.keys(ACTIVE_ENTELLIX_TOOL_DESCRIPTIONS)).toEqual(ENTELLIX_MCP_TOOL_IDS);
  });

  it("validates the active server instructions", () => {
    expect(entellixServerInstructionsSchema.parse(ACTIVE_ENTELLIX_SERVER_INSTRUCTIONS)).toBe(
      ACTIVE_ENTELLIX_SERVER_INSTRUCTIONS,
    );
  });
});
