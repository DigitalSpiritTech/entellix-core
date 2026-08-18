export function assertDisposableDatabaseUrl(rawUrl) {
  const url = new URL(rawUrl);
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error("standalone smoke requires a PostgreSQL URL");
  }
  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!/(?:^|_)(?:smoke|test)(?:$|_)/i.test(database)) {
    throw new Error("standalone smoke must target an explicitly named smoke or test database");
  }
  return rawUrl;
}

export function parseMcpResponse(contentType, source) {
  if (contentType.includes("application/json")) return JSON.parse(source);
  if (!contentType.includes("text/event-stream")) {
    throw new Error(`unsupported MCP response content type: ${contentType}`);
  }

  const messages = source
    .split(/\r?\n\r?\n/)
    .map((event) =>
      event
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n"),
    )
    .filter((data) => data && data !== "[DONE]")
    .map((data) => JSON.parse(data));
  const message = messages.at(-1);
  if (!message) throw new Error("MCP event stream contained no JSON-RPC message");
  return message;
}
