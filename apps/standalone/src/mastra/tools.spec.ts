/**
 * Tests tools behavior.
 *
 * Inputs: Imported dependencies and values passed to the module's documented functions.
 * Outputs: Exported types, values, and behavior provided by the module.
 * Errors: Functions document validation, dependency, and runtime errors individually.
 *
 * @packageDocumentation
 */

import { describe, expect, it, vi } from "vitest";

import type { StandaloneService } from "../service.ts";
import { createStandaloneTools } from "./tools.ts";

describe("standalone MCP tools", () => {
  it("delegates authorization to the protected MCP route", async () => {
    const listMemories = vi.fn<StandaloneService["listMemories"]>(async () => ({ memories: [] }));
    const service = { listMemories } as unknown as StandaloneService;
    const tools = createStandaloneTools({ service });

    const execute = tools.list_memories.execute as (input: { limit?: number }) => Promise<unknown>;
    await expect(execute({ limit: 10 })).resolves.toEqual({ memories: [] });
    expect(listMemories).toHaveBeenCalledWith({ limit: 10 });
  });
});
