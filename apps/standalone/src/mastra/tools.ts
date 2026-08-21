/**
 * Defines authenticated Entellix MCP tools for the standalone host.
 *
 * Inputs: Imported dependencies and values passed to the module's documented functions.
 * Outputs: Exported types, values, and behavior provided by the module.
 * Errors: Functions document validation, dependency, and runtime errors individually.
 *
 * @packageDocumentation
 */

import {
  getContextInputSchema,
  listMemoriesInputSchema,
  logContextInputSchema,
  retrieveMemoryInputSchema,
  saveMemoryInputSchema,
  searchInputSchema,
} from "@entellix/contracts";
import { ACTIVE_ENTELLIX_TOOL_DESCRIPTIONS } from "@entellix/instructions/mcp";
import { createTool } from "@mastra/core/tools";

import type { StandaloneService } from "../service.ts";

export interface StandaloneToolDeps {
  service: StandaloneService;
}

/**
 * Creates standalone tools.
 *
 * @param deps - Value supplied for `deps`.
 * @returns The result produced by `createStandaloneTools`.
 * @throws Errors raised by validation or dependent operations.
 */
export function createStandaloneTools(deps: StandaloneToolDeps) {
  return {
    get_context: createTool({
      id: "get_context",
      description: ACTIVE_ENTELLIX_TOOL_DESCRIPTIONS.get_context,
      inputSchema: getContextInputSchema,
      /**
       * Executes execute.
       *
       * @param input - Value supplied for `input`.
       * @returns The result produced by `execute`.
       * @throws Errors raised by validation or dependent operations.
       */
      execute: (input) => deps.service.getContext(input),
    }),
    save_memory: createTool({
      id: "save_memory",
      description: ACTIVE_ENTELLIX_TOOL_DESCRIPTIONS.save_memory,
      inputSchema: saveMemoryInputSchema,
      /**
       * Executes execute.
       *
       * @param input - Value supplied for `input`.
       * @returns The result produced by `execute`.
       * @throws Errors raised by validation or dependent operations.
       */
      execute: (input) => deps.service.saveMemory(input),
    }),
    retrieve_memory: createTool({
      id: "retrieve_memory",
      description: ACTIVE_ENTELLIX_TOOL_DESCRIPTIONS.retrieve_memory,
      inputSchema: retrieveMemoryInputSchema,
      /**
       * Executes execute.
       *
       * @param input - Value supplied for `input`.
       * @returns The result produced by `execute`.
       * @throws Errors raised by validation or dependent operations.
       */
      execute: (input) => deps.service.retrieveMemories(input),
    }),
    list_memories: createTool({
      id: "list_memories",
      description: ACTIVE_ENTELLIX_TOOL_DESCRIPTIONS.list_memories,
      inputSchema: listMemoriesInputSchema,
      /**
       * Executes execute.
       *
       * @param input - Value supplied for `input`.
       * @returns The result produced by `execute`.
       * @throws Errors raised by validation or dependent operations.
       */
      execute: (input) => deps.service.listMemories(input),
    }),
    log_context: createTool({
      id: "log_context",
      description: ACTIVE_ENTELLIX_TOOL_DESCRIPTIONS.log_context,
      inputSchema: logContextInputSchema,
      /**
       * Executes execute.
       *
       * @param input - Value supplied for `input`.
       * @returns The result produced by `execute`.
       * @throws Errors raised by validation or dependent operations.
       */
      execute: (input) => deps.service.logContext(input),
    }),
    search: createTool({
      id: "search",
      description: ACTIVE_ENTELLIX_TOOL_DESCRIPTIONS.search,
      inputSchema: searchInputSchema,
      /**
       * Executes execute.
       *
       * @param input - Value supplied for `input`.
       * @returns The result produced by `execute`.
       * @throws Errors raised by validation or dependent operations.
       */
      execute: (input) =>
        deps.service.retrieveMemories({
          mode: "search",
          query: input.query,
          limit: input.filters?.limit ?? 20,
        }),
    }),
  };
}
