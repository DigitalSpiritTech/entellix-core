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

/**
 * Builds the child-process environment for the extracted standalone server.
 *
 * @param {NodeJS.ProcessEnv} parentEnv - Environment inherited by the smoke runner.
 * @param {string} localToken - Bearer token used by both the runner and server.
 * @param {number} port - Ephemeral local port assigned to the server.
 * @returns {NodeJS.ProcessEnv} Environment with smoke-owned authentication and port values pinned.
 * @throws This function does not throw.
 */
export function buildStandaloneServerEnv(parentEnv, localToken, port) {
  return {
    ...parentEnv,
    ENTELLIX_LOCAL_TOKEN: localToken,
    PORT: String(port),
  };
}

/**
 * Determines whether an MCP tool-call response represents success.
 *
 * @param {unknown} response - Parsed JSON-RPC response returned by the MCP endpoint.
 * @returns {boolean} True unless the tool result explicitly reports an error.
 * @throws This function does not throw.
 */
export function isSuccessfulMcpToolCall(response) {
  return response?.result?.isError !== true;
}

/**
 * Parses the JSON payload carried by an MCP text tool result.
 *
 * @param {unknown} response - Parsed JSON-RPC tool-call response.
 * @returns {Record<string, unknown>} Parsed JSON object from the first text content block.
 * @throws {Error} When the response has no text block or the text is not valid JSON.
 */
export function parseMcpToolJson(response) {
  const text = response?.result?.content?.find((item) => item?.type === "text")?.text;
  if (typeof text !== "string") throw new Error("MCP tool result contained no text payload");
  return JSON.parse(text);
}

/**
 * Finds the review candidate produced from a specific source event.
 *
 * @param {unknown[]} reviews - Review queue items returned by the operator API.
 * @param {string} eventId - Source event identifier from the save-memory receipt.
 * @returns {unknown | undefined} Matching review candidate, when processing has reached review.
 * @throws This function does not throw.
 */
export function findReviewCandidateByEventId(reviews, eventId) {
  return reviews.find(
    (review) => Array.isArray(review?.sourceEventIds) && review.sourceEventIds.includes(eventId),
  );
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
