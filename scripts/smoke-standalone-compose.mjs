import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dirname, "..");
const token = "entellix-compose-smoke-token-1234567890";
const projectName = `entellix-compose-smoke-${process.pid}`;

const run = (command, args, env, stdio = "inherit") =>
  execFileSync(command, args, {
    cwd: repositoryRoot,
    env,
    stdio,
  });

const availablePort = () =>
  new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("failed to reserve a local Compose smoke port"));
        return;
      }
      server.close((error) => (error ? reject(error) : resolvePort(address.port)));
    });
  });

const assertStatus = async (url, expected, init) => {
  const response = await fetch(url, init);
  if (response.status !== expected) {
    throw new Error(`${url} returned ${response.status}; expected ${expected}`);
  }
  return response;
};

const temporaryRoot = await mkdtemp(join(tmpdir(), "entellix-compose-smoke-"));
const environmentFile = join(temporaryRoot, "compose.env");
const port = await availablePort();
const env = {
  ...process.env,
  ENTELLIX_ENV_FILE: environmentFile,
  ENTELLIX_PORT: String(port),
};
const compose = ["compose", "--project-name", projectName];

try {
  await writeFile(
    environmentFile,
    [
      `ENTELLIX_LOCAL_TOKEN=${token}`,
      "ANTHROPIC_API_KEY=compose-smoke-do-not-call-provider",
      "ENTELLIX_GENERATION_MODEL=claude-haiku-4-5-20251001",
      "ENTELLIX_EMBEDDING_URL=",
      "ENTELLIX_EMBEDDING_API_KEY=",
      "ENTELLIX_EMBEDDING_MODEL=voyage-4",
      "",
    ].join("\n"),
    { mode: 0o600 },
  );

  run("docker", [...compose, "config", "--quiet"], env);
  run("docker", [...compose, "up", "--build", "--detach", "--wait"], env);

  const baseUrl = `http://127.0.0.1:${port}`;
  const health = await assertStatus(`${baseUrl}/healthz`, 200);
  const body = await health.json();
  if (body.ok !== true || body.distribution !== "standalone") {
    throw new Error(`unexpected standalone health response: ${JSON.stringify(body)}`);
  }

  await assertStatus(`${baseUrl}/operator/v1/reviews`, 401);
  await assertStatus(`${baseUrl}/operator/v1/reviews`, 200, {
    headers: { authorization: `Bearer ${token}` },
  });

  const migration = run(
    "docker",
    [
      ...compose,
      "exec",
      "--no-TTY",
      "postgres",
      "psql",
      "--username",
      "entellix",
      "--dbname",
      "entellix",
      "--tuples-only",
      "--no-align",
      "--command",
      "SELECT name FROM standalone_schema_migrations ORDER BY name",
    ],
    env,
    ["ignore", "pipe", "inherit"],
  )
    .toString()
    .trim();
  if (migration !== "0001_single_workspace.sql") {
    throw new Error(`unexpected standalone migration ledger: ${migration}`);
  }

  console.log("Standalone Docker Compose smoke passed.");
} finally {
  try {
    run("docker", [...compose, "down", "--volumes", "--remove-orphans"], env);
  } catch {
    console.error(`Compose cleanup failed for project ${projectName}.`);
  }
  await rm(temporaryRoot, { recursive: true, force: true });
}
