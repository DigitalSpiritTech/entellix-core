/* oxlint-disable no-await-in-loop */
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

import {
  assertDisposableDatabaseUrl,
  buildStandaloneServerEnv,
  findReviewCandidateByEventId,
  isSuccessfulMcpToolCall,
  parseMcpToolJson,
  parseMcpResponse,
} from "./standalone-smoke-lib.mjs";

const optionValue = (name) => {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
};

const archiveArgument = optionValue("--archive");
if (!archiveArgument) throw new Error("usage: node scripts/smoke-standalone.mjs --archive <path>");
const archive = resolve(archiveArgument);
await stat(archive);

const databaseUrl = assertDisposableDatabaseUrl(process.env.ENTELLIX_SMOKE_DATABASE_URL ?? "");
const providerRoundTrip = process.argv.includes("--provider-round-trip");
if (providerRoundTrip && !process.env.ANTHROPIC_API_KEY) {
  throw new Error("--provider-round-trip requires ANTHROPIC_API_KEY");
}

const localToken = process.env.ENTELLIX_SMOKE_TOKEN ?? "entellix-smoke-token-0000000000000000";
const temporaryRoot = await mkdtemp(join(tmpdir(), "entellix-standalone-smoke-"));
let child;
let output = "";

const delay = (milliseconds) =>
  new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));

const freePort = async () => {
  const server = net.createServer();
  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  await new Promise((resolveClose, reject) =>
    server.close((error) => (error ? reject(error) : resolveClose())),
  );
  return address.port;
};

const waitForHealth = async (url) => {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
    } catch {}
    await delay(250);
  }
  throw new Error(`standalone did not become healthy\n${output.slice(-4_000)}`);
};

const mcpClient = (endpoint) => {
  let sessionId;
  let nextId = 1;

  const post = async (message) => {
    const headers = {
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${localToken}`,
      "content-type": "application/json",
    };
    if (sessionId) {
      headers["mcp-session-id"] = sessionId;
      headers["mcp-protocol-version"] = "2025-11-25";
    }
    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(message),
    });
    if (!response.ok) {
      throw new Error(
        `MCP ${message.method} failed with ${response.status}: ${await response.text()}`,
      );
    }
    sessionId ??= response.headers.get("mcp-session-id") ?? undefined;
    const source = await response.text();
    return source
      ? parseMcpResponse(response.headers.get("content-type") ?? "", source)
      : undefined;
  };

  return {
    async initialize() {
      const response = await post({
        jsonrpc: "2.0",
        id: nextId++,
        method: "initialize",
        params: {
          protocolVersion: "2025-11-25",
          capabilities: {},
          clientInfo: { name: "entellix-clean-room-smoke", version: "1.0.0" },
        },
      });
      assert.ok(response?.result?.serverInfo, "MCP initialize did not return server information");
      assert.ok(sessionId, "MCP initialize did not establish a session");
      await post({ jsonrpc: "2.0", method: "notifications/initialized" });
      return response;
    },
    request(method, params = {}) {
      return post({ jsonrpc: "2.0", id: nextId++, method, params });
    },
  };
};

const authenticatedFetch = (url, init = {}) =>
  fetch(url, {
    ...init,
    headers: { authorization: `Bearer ${localToken}`, ...init.headers },
  });

const assertOperatorRoutes = async (baseUrl) => {
  const unauthenticated = await fetch(`${baseUrl}/operator/v1/reviews`);
  assert.equal(unauthenticated.status, 401);

  const unauthenticatedMcp = await fetch(`${baseUrl}/api/mcp/entellix/mcp`, {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "unauthenticated-smoke", version: "1.0.0" },
      },
    }),
  });
  assert.equal(unauthenticatedMcp.status, 401);

  const reviews = await authenticatedFetch(`${baseUrl}/operator/v1/reviews`);
  assert.equal(reviews.status, 200);
  assert.ok(Array.isArray(await reviews.json()));

  const retention = await authenticatedFetch(`${baseUrl}/operator/v1/retention/run`, {
    method: "POST",
  });
  assert.equal(retention.status, 200);

  const exported = await authenticatedFetch(`${baseUrl}/operator/v1/data/export`);
  assert.equal(exported.status, 200);

  const unconfirmedDelete = await authenticatedFetch(`${baseUrl}/operator/v1/data`, {
    method: "DELETE",
  });
  assert.equal(unconfirmedDelete.status, 409);
};

const runProviderRoundTrip = async (client, baseUrl) => {
  const marker = `Entellix clean-room preference ${Date.now()}: always use UTC timestamps.`;
  const queued = await client.request("tools/call", {
    name: "save_memory",
    arguments: { text: marker, provenance: "explicit_request" },
  });
  assert.ok(isSuccessfulMcpToolCall(queued), "save_memory returned an MCP tool error");
  const receipt = parseMcpToolJson(queued);
  assert.equal(receipt.status, "queued");
  assert.equal(typeof receipt.eventId, "string");

  const deadline = Date.now() + 90_000;
  let reviewCandidate;
  while (Date.now() < deadline) {
    const response = await authenticatedFetch(`${baseUrl}/operator/v1/reviews`);
    assert.equal(response.status, 200);
    const reviews = await response.json();
    assert.ok(Array.isArray(reviews));
    reviewCandidate = findReviewCandidateByEventId(reviews, receipt.eventId);
    if (reviewCandidate) break;
    await delay(2_000);
  }
  assert.ok(reviewCandidate, "provider-backed memory did not reach review within 90 seconds");

  const approved = await authenticatedFetch(`${baseUrl}/operator/v1/reviews/decision`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      candidateId: reviewCandidate.candidateId,
      action: "approve",
      note: "Approved by the provider-backed clean-room release gate.",
    }),
  });
  assert.equal(approved.status, 200);
  const approvalResult = await approved.json();
  const memoryId = approvalResult?.reconcileOutcome?.memoryId;
  assert.equal(typeof memoryId, "string");

  const retrievalDeadline = Date.now() + 30_000;
  while (Date.now() < retrievalDeadline) {
    const listed = await client.request("tools/call", {
      name: "list_memories",
      arguments: { limit: 100 },
    });
    assert.ok(isSuccessfulMcpToolCall(listed), "list_memories returned an MCP tool error");
    const inventory = parseMcpToolJson(listed);
    if (inventory.memories?.some((memory) => memory.id === memoryId)) return;
    await delay(2_000);
  }
  throw new Error("approved provider-backed memory did not become retrievable within 30 seconds");
};

try {
  execFileSync("tar", ["-xzf", archive, "-C", temporaryRoot], { stdio: "inherit" });
  const entries = await readdir(temporaryRoot, { withFileTypes: true });
  const distributionEntry = entries.find(
    (entry) => entry.isDirectory() && entry.name.startsWith("entellix-standalone-"),
  );
  assert.ok(distributionEntry, `${basename(archive)} has no standalone distribution directory`);
  const distributionRoot = join(temporaryRoot, distributionEntry.name);

  const readme = await readFile(join(distributionRoot, "README.md"), "utf8");
  for (const documentedSurface of [
    "npm start",
    "psql",
    "/healthz",
    "/api/mcp/entellix/mcp",
    "x-entellix-confirm-delete",
  ]) {
    assert.ok(
      readme.includes(documentedSurface),
      `packaged README is missing ${documentedSurface}`,
    );
  }

  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const envLines = [
    `DATABASE_URL=${databaseUrl}`,
    `ENTELLIX_LOCAL_TOKEN=${localToken}`,
    `ANTHROPIC_API_KEY=${process.env.ANTHROPIC_API_KEY ?? "not-used-by-credential-free-smoke"}`,
    `ENTELLIX_GENERATION_MODEL=${process.env.ENTELLIX_GENERATION_MODEL ?? "claude-haiku-4-5-20251001"}`,
    `ENTELLIX_API_URL=${baseUrl}`,
    "ENTELLIX_WORKER_INTERVAL_MS=250",
    "ENTELLIX_WORKER_BATCH_SIZE=10",
    "ENTELLIX_RAW_RETENTION_DAYS=30",
  ];
  for (const key of [
    "ENTELLIX_EMBEDDING_URL",
    "ENTELLIX_EMBEDDING_API_KEY",
    "ENTELLIX_EMBEDDING_MODEL",
  ]) {
    if (process.env[key]) envLines.push(`${key}=${process.env[key]}`);
  }
  if (envLines.some((line) => /[\r\n]/.test(line)))
    throw new Error("smoke environment contains a newline");
  await writeFile(join(distributionRoot, ".env"), `${envLines.join("\n")}\n`, { mode: 0o600 });

  execFileSync("npm", ["run", "migrate"], { cwd: distributionRoot, stdio: "inherit" });
  execFileSync("npm", ["run", "migrate"], { cwd: distributionRoot, stdio: "inherit" });

  child = spawn("node", ["--env-file=.env", "server/index.mjs"], {
    cwd: distributionRoot,
    env: buildStandaloneServerEnv(process.env, localToken, port),
    stdio: ["ignore", "pipe", "pipe"],
  });
  const collect = (chunk) => {
    output = `${output}${chunk}`.slice(-20_000);
  };
  child.stdout.on("data", collect);
  child.stderr.on("data", collect);

  const health = await waitForHealth(`${baseUrl}/healthz`);
  assert.deepEqual(health, { ok: true, distribution: "standalone", workspace: "single" });
  await assertOperatorRoutes(baseUrl);

  const client = mcpClient(`${baseUrl}/api/mcp/entellix/mcp`);
  await client.initialize();
  const tools = await client.request("tools/list");
  const toolNames = tools?.result?.tools?.map((tool) => tool.name).toSorted();
  assert.deepEqual(toolNames, [
    "get_context",
    "list_memories",
    "log_context",
    "retrieve_memory",
    "save_memory",
    "search",
  ]);
  const context = await client.request("tools/call", {
    name: "get_context",
    arguments: { taskContext: "Credential-free authenticated MCP smoke test." },
  });
  assert.ok(isSuccessfulMcpToolCall(context), "get_context returned an MCP tool error");

  if (providerRoundTrip) await runProviderRoundTrip(client, baseUrl);

  const confirmedDelete = await authenticatedFetch(`${baseUrl}/operator/v1/data`, {
    method: "DELETE",
    headers: { "x-entellix-confirm-delete": "delete-workspace" },
  });
  assert.equal(confirmedDelete.status, 200);

  console.log(
    providerRoundTrip
      ? "Standalone provider-backed clean-room smoke passed."
      : "Standalone credential-free clean-room smoke passed.",
  );
} finally {
  if (child && child.exitCode === null) {
    child.kill("SIGTERM");
    await Promise.race([
      new Promise((resolveExit) => child.once("exit", resolveExit)),
      delay(5_000).then(() => child.kill("SIGKILL")),
    ]);
  }
  await rm(temporaryRoot, { recursive: true, force: true });
}
