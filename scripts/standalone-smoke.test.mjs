import assert from "node:assert/strict";
import test from "node:test";

import {
  buildStandaloneWorkspace,
  findMissingStandaloneArchiveRequirement,
} from "./package-standalone.mjs";
import {
  assertDisposableDatabaseUrl,
  buildStandaloneServerEnv,
  findReviewCandidateByEventId,
  isSuccessfulMcpToolCall,
  parseMcpToolJson,
  parseMcpResponse,
} from "./standalone-smoke-lib.mjs";

test("builds standalone artifacts through the workspace dependency graph", () => {
  const invocations = [];

  buildStandaloneWorkspace((...args) => invocations.push(args), "/repository");

  assert.deepEqual(invocations, [["pnpm", ["run", "build"], "/repository"]]);
});

test("requires compiled Entellix package subpaths in the standalone archive", () => {
  const distributionName = "entellix-standalone-0.1.1";
  const completeArchive = [
    `${distributionName}/server/index.mjs`,
    `${distributionName}/migrations/0001_single_workspace.sql`,
    `${distributionName}/scripts/migrate.mjs`,
    `${distributionName}/THIRD_PARTY_LICENSES.json`,
    `${distributionName}/server/node_modules/.pnpm/contracts/node_modules/@entellix/contracts/dist/reconciler.js`,
    `${distributionName}/server/node_modules/.pnpm/core/node_modules/@entellix/core/dist/reconciler.js`,
    `${distributionName}/server/node_modules/.pnpm/instructions/node_modules/@entellix/instructions/dist/mcp.js`,
  ];

  assert.equal(findMissingStandaloneArchiveRequirement(completeArchive, distributionName), null);
  assert.match(
    findMissingStandaloneArchiveRequirement(
      completeArchive.filter((entry) => !entry.endsWith("/contracts/dist/reconciler.js")),
      distributionName,
    ),
    /contracts\/dist\/reconciler\.js/,
  );
});

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

test("pins the spawned standalone server to the smoke token", () => {
  assert.deepEqual(
    buildStandaloneServerEnv(
      { ENTELLIX_LOCAL_TOKEN: "inherited-token", NODE_ENV: "test" },
      "smoke-token",
      4211,
    ),
    {
      ENTELLIX_LOCAL_TOKEN: "smoke-token",
      NODE_ENV: "test",
      PORT: "4211",
    },
  );
});

test("accepts explicit and implicit MCP tool success markers", () => {
  assert.equal(isSuccessfulMcpToolCall({ result: {} }), true);
  assert.equal(isSuccessfulMcpToolCall({ result: { isError: false } }), true);
  assert.equal(isSuccessfulMcpToolCall({ result: { isError: true } }), false);
});

test("links a queued MCP receipt to its review candidate", () => {
  const eventId = "00000000-0000-4000-8000-0000000000e1";
  const response = {
    result: {
      content: [{ type: "text", text: JSON.stringify({ status: "queued", eventId }) }],
    },
  };
  const receipt = parseMcpToolJson(response);
  const expected = { candidateId: "candidate-1", sourceEventIds: [eventId] };

  assert.equal(receipt.eventId, eventId);
  assert.equal(
    findReviewCandidateByEventId(
      [{ candidateId: "candidate-2", sourceEventIds: [] }, expected],
      eventId,
    ),
    expected,
  );
});
