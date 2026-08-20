/**
 * Implements server behavior for this TypeScript module.
 *
 * Inputs: Imported dependencies and values passed to the module's documented functions.
 * Outputs: Exported types, values, and behavior provided by the module.
 * Errors: Functions document validation, dependency, and runtime errors individually.
 *
 * @packageDocumentation
 */

import { ACTIVE_ENTELLIX_SERVER_INSTRUCTIONS } from "@entellix/instructions/mcp";
import { MCPServer } from "@mastra/mcp";

import { standaloneService } from "../runtime.ts";
import { STANDALONE_VERSION } from "../version.ts";
import { createStandaloneTools } from "./tools.ts";

export const STANDALONE_MCP_SERVER_ID = "entellix";
export const STANDALONE_MCP_PATH = `/api/mcp/${STANDALONE_MCP_SERVER_ID}/mcp`;

export const standaloneMcpServer = new MCPServer({
  id: STANDALONE_MCP_SERVER_ID,
  name: "Entellix Standalone",
  version: STANDALONE_VERSION,
  description: "Single-workspace Entellix Brain over MCP.",
  instructions: ACTIVE_ENTELLIX_SERVER_INSTRUCTIONS,
  tools: createStandaloneTools({ service: standaloneService }),
});
