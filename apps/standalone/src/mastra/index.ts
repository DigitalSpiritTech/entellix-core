/**
 * Defines the public exports for this TypeScript module.
 *
 * Inputs: Imported dependencies and values passed to the module's documented functions.
 * Outputs: Exported types, values, and behavior provided by the module.
 * Errors: Functions document validation, dependency, and runtime errors individually.
 *
 * @packageDocumentation
 */

import { Mastra } from "@mastra/core/mastra";

import { tokenFromAuthorization } from "../auth.ts";
import { standaloneConfig, verifyStandaloneToken } from "../runtime.ts";
import { createStandaloneMastraStorage } from "../storage.ts";
import { standaloneRoutes } from "./routes.ts";
import { STANDALONE_MCP_SERVER_ID, STANDALONE_MCP_PATH, standaloneMcpServer } from "./server.ts";

/**
 * Executes authenticate.
 *
 * @param authorization - Value supplied for `authorization`.
 * @returns The result produced by `authenticate`.
 * @throws Errors raised by validation or dependent operations.
 */
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
        // This route is the standalone MCP authentication boundary. Mastra's
        // MCP 2.0 tool context does not retain the raw HTTP authorization
        // header, so individual tools must rely on this verified gateway.
        path: `/api/mcp/${STANDALONE_MCP_SERVER_ID}/*`,
        /**
         * Executes handler.
         *
         * @param c - Value supplied for `c`.
         * @param next - Value supplied for `next`.
         * @returns The result produced by `handler`.
         * @throws Errors raised by validation or dependent operations.
         */
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
        /**
         * Executes handler.
         *
         * @param c - Value supplied for `c`.
         * @param next - Value supplied for `next`.
         * @returns The result produced by `handler`.
         * @throws Errors raised by validation or dependent operations.
         */
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
