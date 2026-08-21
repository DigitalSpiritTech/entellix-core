import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const releaseWorkflowPath = resolve(repositoryRoot, ".github/workflows/release.yml");
const rootManifestPath = resolve(repositoryRoot, "package.json");

test("publishes standalone artifacts in the trusted release workflow", async () => {
  const workflow = await readFile(releaseWorkflowPath, "utf8");
  const rootManifest = JSON.parse(await readFile(rootManifestPath, "utf8"));

  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /id: changesets/);
  assert.match(workflow, /steps\.changesets\.outputs\.published/);
  assert.match(rootManifest.scripts["release:publish"], /scripts\/release-publish\.mjs/);
  assert.match(workflow, /pnpm release:standalone:artifact/);
  assert.match(workflow, /uses: actions\/attest@v4/);
  assert.match(workflow, /gh release upload/);
  assert.match(workflow, /gh attestation verify/);
});

test("does not rely on separate tag or canary workflows", () => {
  assert.equal(
    existsSync(resolve(repositoryRoot, ".github/workflows/standalone-release.yml")),
    false,
  );
  assert.equal(existsSync(resolve(repositoryRoot, ".github/workflows/canary.yml")), false);
});
