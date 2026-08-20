import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";

const repositoryRoot = resolve(import.meta.dirname, "..");
const readRepositoryFile = (path) => readFile(join(repositoryRoot, path), "utf8");

test("compose isolates PostgreSQL and exposes only the standalone API", async () => {
  const compose = await readRepositoryFile("compose.yaml");
  const postgresSection = compose.split("\n  standalone:")[0];

  assert.match(compose, /image: postgres:16-bookworm/);
  assert.match(compose, /127\.0\.0\.1:\$\{ENTELLIX_PORT:-4211\}:4211/);
  assert.match(compose, /entellix-postgres-data:\/var\/lib\/postgresql\/data/);
  assert.match(
    compose,
    /DATABASE_URL: postgres:\/\/entellix:entellix-local-only@postgres:5432\/entellix/,
  );
  assert.match(compose, /ENTELLIX_ENV_FILE:-\.\/apps\/standalone\/\.env\.compose/);
  assert.doesNotMatch(postgresSection, /\n    ports:/);
});

test("standalone image runs the verified archive as a non-root user", async () => {
  const dockerfile = await readRepositoryFile("apps/standalone/Dockerfile");

  assert.match(dockerfile, /^FROM node:24-bookworm-slim AS builder/m);
  assert.match(dockerfile, /pnpm release:standalone:artifact/);
  assert.match(dockerfile, /^USER node/m);
  assert.match(dockerfile, /^EXPOSE 4211/m);
  assert.match(dockerfile, /^CMD \["node", "server\/index\.mjs"\]/m);
});

test("compose environment template contains no database target", async () => {
  const environment = await readRepositoryFile("apps/standalone/.env.compose.example");

  assert.match(environment, /^ENTELLIX_LOCAL_TOKEN=/m);
  assert.match(environment, /^ANTHROPIC_API_KEY=/m);
  assert.doesNotMatch(environment, /^DATABASE_URL=/m);
});
