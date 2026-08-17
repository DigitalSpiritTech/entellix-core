import { Mastra } from "@mastra/core/mastra";

import { tokenFromAuthorization } from "../auth.ts";
import { standaloneConfig, verifyStandaloneToken } from "../runtime.ts";
import { createStandaloneMastraStorage } from "../storage.ts";
import { standaloneRoutes } from "./routes.ts";
import { STANDALONE_MCP_SERVER_ID, STANDALONE_MCP_PATH, standaloneMcpServer } from "./server.ts";

async function authenticate(authorization: string | undefined): Promise<boolean> {
  const token = tokenFromAuthorization(authorization ?? "");
  if (!token) return false;
  try {
    await verifyStandaloneToken(token);
    return true;
  } catch {
    return false;
  }
}

export const mastra = new Mastra({
  storage: createStandaloneMastraStorage(standaloneConfig),
  mcpServers: { [STANDALONE_MCP_SERVER_ID]: standaloneMcpServer },
  bundler: {
    transpilePackages: ["@entellix/contracts", "@entellix/core", "@entellix/instructions"],
  },
  server: {
    apiRoutes: standaloneRoutes,
    middleware: [
      {
        path: `/api/mcp/${STANDALONE_MCP_SERVER_ID}/*`,
        handler: async (c, next) => {
          if (!(await authenticate(c.req.header("authorization")))) {
            return c.json({ error: "invalid_token" }, 401, {
              "WWW-Authenticate": 'Bearer realm="entellix-standalone"',
            });
          }
          await next();
        },
      },
      {
        path: "/operator/v1/*",
        handler: async (c, next) => {
          if (!(await authenticate(c.req.header("authorization")))) {
            return c.json({ error: "invalid_token" }, 401, {
              "WWW-Authenticate": 'Bearer realm="entellix-standalone"',
            });
          }
          await next();
        },
      },
    ],
  },
});

export { STANDALONE_MCP_PATH };
