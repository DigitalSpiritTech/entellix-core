import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const readRepositoryFile = (path) => readFile(join(repositoryRoot, path), "utf8");

test("landing page exposes public beta status and governance paths", async () => {
  const readme = await readRepositoryFile("README.md");

  for (const required of [
    "actions/workflows/checks.yml/badge.svg",
    "releases/latest",
    "License: Apache-2.0",
    "early public beta",
    "SUPPORT.md",
    "CONTRIBUTING.md",
    "SECURITY.md",
    "DigitalSpiritTech",
  ]) {
    assert.ok(readme.includes(required), `README.md is missing ${required}`);
  }
});

test("security and support policies describe the shipped 0.x line", async () => {
  const [security, support, contributing] = await Promise.all([
    readRepositoryFile("SECURITY.md"),
    readRepositoryFile("SUPPORT.md"),
    readRepositoryFile("CONTRIBUTING.md"),
  ]);

  assert.doesNotMatch(security, /until the first public release/i);
  assert.match(security, /0\.1\.0/);
  assert.match(security, /trusted publishing/i);
  assert.match(support, /latest published `0\.x` release/i);
  assert.match(support, /breaking public-api changes may ship in a minor release/i);
  assert.match(support, /Changeset/);
  assert.doesNotMatch(contributing, /after that gate is resolved/i);
});

test("focused issue templates cover bugs, documentation, proposals, and security", async () => {
  const templates = await Promise.all(
    ["bug_report.yml", "documentation.yml", "proposal.yml", "config.yml"].map((name) =>
      readRepositoryFile(`.github/ISSUE_TEMPLATE/${name}`),
    ),
  );

  assert.match(templates[0], /Minimal reproduction/);
  assert.match(templates[1], /Documentation location/);
  assert.match(templates[2], /Public-surface impact/i);
  assert.match(templates[3], /security\/advisories\/new/);
});

test("agent context records the trusted release topology", async () => {
  const [index, implementation, adrIndex, adr] = await Promise.all([
    readRepositoryFile("ai/index.md"),
    readRepositoryFile("ai/implementation/index.md"),
    readRepositoryFile("ai/adrs/index.md"),
    readRepositoryFile("ai/adrs/0002-trusted-public-release.md"),
  ]);

  assert.match(index, /current public baseline is `0\.1\.1`/i);
  assert.match(index, /confirmed long-term GitHub organization/i);
  assert.match(implementation, /`0\.1\.0` packages established npm trusted publishing/i);
  assert.match(adrIndex, /0002-trusted-public-release\.md/);
  assert.match(adr, /GitHub OIDC trusted publishing/);
});
