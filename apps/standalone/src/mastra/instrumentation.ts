export interface McpExtraLike {
  authInfo?: { token?: string };
  requestInfo?: { headers?: Record<string, string | string[] | undefined> };
}

interface ToolContextLike {
  mcp?: { extra?: McpExtraLike };
  requestContext?: { get?: (key: string) => unknown };
}

export function bearerTokenFromContext(context: unknown): string | undefined {
  const value = context as ToolContextLike | undefined;
  const extra =
    value?.mcp?.extra ?? (value?.requestContext?.get?.("mcp.extra") as McpExtraLike | undefined);
  const headers = extra?.requestInfo?.headers;
  const authorization = Object.entries(headers ?? {}).find(
    ([key]) => key.toLowerCase() === "authorization",
  )?.[1];
  const header = Array.isArray(authorization) ? authorization[0] : authorization;
  return header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : extra?.authInfo?.token;
}
