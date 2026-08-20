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

export function createStandaloneTools(deps: StandaloneToolDeps) {
  return {
    get_context: createTool({
      id: "get_context",
      description: ACTIVE_ENTELLIX_TOOL_DESCRIPTIONS.get_context,
      inputSchema: getContextInputSchema,
      execute: (input) => deps.service.getContext(input),
    }),
    save_memory: createTool({
      id: "save_memory",
      description: ACTIVE_ENTELLIX_TOOL_DESCRIPTIONS.save_memory,
      inputSchema: saveMemoryInputSchema,
      execute: (input) => deps.service.saveMemory(input),
    }),
    retrieve_memory: createTool({
      id: "retrieve_memory",
      description: ACTIVE_ENTELLIX_TOOL_DESCRIPTIONS.retrieve_memory,
      inputSchema: retrieveMemoryInputSchema,
      execute: (input) => deps.service.retrieveMemories(input),
    }),
    list_memories: createTool({
      id: "list_memories",
      description: ACTIVE_ENTELLIX_TOOL_DESCRIPTIONS.list_memories,
      inputSchema: listMemoriesInputSchema,
      execute: (input) => deps.service.listMemories(input),
    }),
    log_context: createTool({
      id: "log_context",
      description: ACTIVE_ENTELLIX_TOOL_DESCRIPTIONS.log_context,
      inputSchema: logContextInputSchema,
      execute: (input) => deps.service.logContext(input),
    }),
    search: createTool({
      id: "search",
      description: ACTIVE_ENTELLIX_TOOL_DESCRIPTIONS.search,
      inputSchema: searchInputSchema,
      execute: (input) =>
        deps.service.retrieveMemories({
          mode: "search",
          query: input.query,
          limit: input.filters?.limit ?? 20,
        }),
    }),
  };
}
