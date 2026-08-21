import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";
import test from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const generatedDirectoryNames = new Set([
  ".git",
  ".mastra",
  ".turbo",
  "artifacts",
  "dist",
  "node_modules",
]);

const readRepositoryFile = (path) => readFile(join(repositoryRoot, path), "utf8");

const listRepositoryFiles = async (directory) => {
  const entries = await readdir(join(repositoryRoot, directory), { withFileTypes: true });
  const paths = await Promise.all(
    entries
      .filter((entry) => !generatedDirectoryNames.has(entry.name))
      .map((entry) => {
        const path = join(directory, entry.name);
        return entry.isDirectory() ? listRepositoryFiles(path) : [path];
      }),
  );

  return paths.flat();
};

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

test("agent context records the completed public beta release", async () => {
  const [index, implementation, closeout, adrIndex, adr] = await Promise.all([
    readRepositoryFile("ai/index.md"),
    readRepositoryFile("ai/implementation/index.md"),
    readRepositoryFile("ai/implementation/public-beta-0.1.2.md"),
    readRepositoryFile("ai/adrs/index.md"),
    readRepositoryFile("ai/adrs/0002-trusted-public-release.md"),
  ]);

  assert.match(index, /current public baseline is `0\.1\.2`/i);
  assert.match(index, /confirmed long-term GitHub organization/i);
  assert.match(implementation, /`0\.1\.0` packages established npm trusted publishing/i);
  assert.match(implementation, /public-beta-0\.1\.2\.md/);
  assert.match(closeout, /Status: Complete/);
  assert.match(closeout, /0284d114f490f25c315b362034d02b18c08b3a5f/);
  assert.match(closeout, /35 documented compiled entry points/);
  assert.match(closeout, /2d7e2cc8c4373f102e41a5eceeb07ee9975ac94e1177dbcefe4f8c7b1f8f9327/);
  assert.match(adrIndex, /0002-trusted-public-release\.md/);
  assert.match(adr, /GitHub OIDC trusted publishing/);

  await assert.rejects(readRepositoryFile("plan/public-beta-readiness.md"), {
    code: "ENOENT",
  });
});

test("operational documentation follows current repository versions", async () => {
  const [readme, standaloneReadme, rootManifestText, standaloneManifestText, bugTemplate] =
    await Promise.all([
      readRepositoryFile("README.md"),
      readRepositoryFile("apps/standalone/README.md"),
      readRepositoryFile("package.json"),
      readRepositoryFile("apps/standalone/package.json"),
      readRepositoryFile(".github/ISSUE_TEMPLATE/bug_report.yml"),
    ]);
  const rootManifest = JSON.parse(rootManifestText);
  const standaloneManifest = JSON.parse(standaloneManifestText);
  const pnpmVersion = rootManifest.packageManager.replace("pnpm@", "");

  assert.match(readme, new RegExp(`pnpm ${pnpmVersion.replaceAll(".", "\\.")}`));
  assert.ok(standaloneReadme.includes(pnpmVersion), "standalone README has a stale pnpm version");
  assert.match(bugTemplate, new RegExp(standaloneManifest.version.replaceAll(".", "\\.")));
});

test("source documentation contains no completed implementation placeholders", async () => {
  const paths = (await Promise.all([listRepositoryFiles("packages"), listRepositoryFiles("apps")]))
    .flat()
    .filter((path) => /(?:\.ts|\.md)$/.test(path) && !path.endsWith("CHANGELOG.md"));
  const sources = await Promise.all(paths.map(readRepositoryFile));

  for (const [index, source] of sources.entries()) {
    assert.doesNotMatch(
      source,
      /Implements .* behavior for this TypeScript module|\bRED\b|does not exist yet|not implemented:|TODO-SWAP|TODO\(S\d|\bS\d+\.\d+(?:\.\d+)?\b|Sprint\s+\d|PRD\s*§|\bDecisions?\s+\d|\bADR\s+\d+|\bAC:|Core invariant|ClickUp|future .* CLI|still awaits|pnpm eval:retrieval|pipeline\/__specs__\/directive-pipeline-property\.spec\.ts|test\/pipeline-directives\.test\.ts|ai\/testing\.md|ai\/platforms\/index\.md|docs\/runbooks\//,
      paths[index],
    );
  }
});

test("Markdown documentation has valid local link targets", async () => {
  const paths = (await listRepositoryFiles(".")).filter((path) => path.endsWith(".md"));

  await Promise.all(
    paths.map(async (path) => {
      const source = await readRepositoryFile(path);
      const links = [...source.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)];

      await Promise.all(
        links.map(async (match) => {
          const target = match[1].split("#", 1)[0];
          if (!target || /^(?:https?:|mailto:)/.test(target) || target.includes("<")) {
            return;
          }

          await assert.doesNotReject(
            stat(join(repositoryRoot, dirname(path), decodeURIComponent(target))),
            `${path} links to missing local target ${match[1]}`,
          );
        }),
      );
    }),
  );
});
