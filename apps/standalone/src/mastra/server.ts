import { ACTIVE_ENTELLIX_SERVER_INSTRUCTIONS } from "@entellix/instructions/mcp";
import { MCPServer } from "@mastra/mcp";

import { standaloneService } from "../runtime.ts";
import { createStandaloneTools } from "./tools.ts";

export const STANDALONE_MCP_SERVER_ID = "entellix";
export const STANDALONE_MCP_PATH = `/api/mcp/${STANDALONE_MCP_SERVER_ID}/mcp`;

export const standaloneMcpServer = new MCPServer({
  id: STANDALONE_MCP_SERVER_ID,
  name: "Entellix Standalone",
  version: "0.1.0",
  description: "Single-workspace Entellix Brain over MCP.",
  instructions: ACTIVE_ENTELLIX_SERVER_INSTRUCTIONS,
  tools: createStandaloneTools({ service: standaloneService }),
});
