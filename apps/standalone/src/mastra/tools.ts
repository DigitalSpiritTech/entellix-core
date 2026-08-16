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

import type { VerifiedLocalUser } from "../auth.ts";
import type { StandaloneService } from "../service.ts";
import { bearerTokenFromContext } from "./instrumentation.ts";

export interface StandaloneToolDeps {
  service: StandaloneService;
  verifyToken(token: string): Promise<VerifiedLocalUser>;
}

export function createStandaloneTools(deps: StandaloneToolDeps) {
  const authenticated =
    <Input, Output>(
      run: (input: Input) => Promise<Output>,
    ): ((input: Input, context: unknown) => Promise<Output>) =>
    async (input, context) => {
      const token = bearerTokenFromContext(context);
      if (!token)
        throw new Error("Authentication required: configure the standalone bearer token.");
      await deps.verifyToken(token);
      return run(input);
    };

  return {
    get_context: createTool({
      id: "get_context",
      description: ACTIVE_ENTELLIX_TOOL_DESCRIPTIONS.get_context,
      inputSchema: getContextInputSchema,
      execute: authenticated((input) => deps.service.getContext(input)),
    }),
    save_memory: createTool({
      id: "save_memory",
      description: ACTIVE_ENTELLIX_TOOL_DESCRIPTIONS.save_memory,
      inputSchema: saveMemoryInputSchema,
      execute: authenticated((input) => deps.service.saveMemory(input)),
    }),
    retrieve_memory: createTool({
      id: "retrieve_memory",
      description: ACTIVE_ENTELLIX_TOOL_DESCRIPTIONS.retrieve_memory,
      inputSchema: retrieveMemoryInputSchema,
      execute: authenticated((input) => deps.service.retrieveMemories(input)),
    }),
    list_memories: createTool({
      id: "list_memories",
      description: ACTIVE_ENTELLIX_TOOL_DESCRIPTIONS.list_memories,
      inputSchema: listMemoriesInputSchema,
      execute: authenticated((input) => deps.service.listMemories(input)),
    }),
    log_context: createTool({
      id: "log_context",
      description: ACTIVE_ENTELLIX_TOOL_DESCRIPTIONS.log_context,
      inputSchema: logContextInputSchema,
      execute: authenticated((input) => deps.service.logContext(input)),
    }),
    search: createTool({
      id: "search",
      description: ACTIVE_ENTELLIX_TOOL_DESCRIPTIONS.search,
      inputSchema: searchInputSchema,
      execute: authenticated((input) =>
        deps.service.retrieveMemories({
          mode: "search",
          query: input.query,
          limit: input.filters?.limit ?? 20,
        }),
      ),
    }),
  };
}
