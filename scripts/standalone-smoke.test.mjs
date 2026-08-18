import assert from "node:assert/strict";
import test from "node:test";

import { assertDisposableDatabaseUrl, parseMcpResponse } from "./standalone-smoke-lib.mjs";

test("accepts only an explicitly disposable smoke database", () => {
  assert.equal(
    assertDisposableDatabaseUrl("postgres://entellix:secret@127.0.0.1:5432/entellix_smoke"),
    "postgres://entellix:secret@127.0.0.1:5432/entellix_smoke",
  );
  assert.throws(
    () => assertDisposableDatabaseUrl("postgres://entellix:secret@127.0.0.1:5432/entellix"),
    /smoke or test database/,
  );
});

test("parses JSON and streamable HTTP event responses", () => {
  const message = { jsonrpc: "2.0", id: 1, result: { tools: [] } };
  assert.deepEqual(parseMcpResponse("application/json", JSON.stringify(message)), message);
  assert.deepEqual(
    parseMcpResponse("text/event-stream", `event: message\ndata: ${JSON.stringify(message)}\n\n`),
    message,
  );
});
