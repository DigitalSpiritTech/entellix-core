/* oxlint-disable no-await-in-loop */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  documentedExportSpecifiers,
  expectedExportSpecifiers,
  extractVerifiedExample,
} from "./public-documentation.mjs";

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const packages = [
  { directory: "packages/contracts", identifier: "contracts" },
  { directory: "packages/core", identifier: "core" },
  { directory: "packages/instructions", identifier: "instructions" },
];

const run = (command, args, cwd = repositoryRoot) =>
  execFileSync(command, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });

const verifyPublicDocumentation = async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "entellix-public-documentation-"));
  const archiveDirectory = join(temporaryRoot, "archives");

  try {
    await mkdir(archiveDirectory, { recursive: true });
    const examples = [];

    for (const packageDefinition of packages) {
      const packageRoot = join(repositoryRoot, packageDefinition.directory);
      const [markdown, manifestSource] = await Promise.all([
        readFile(join(packageRoot, "README.md"), "utf8"),
        readFile(join(packageRoot, "package.json"), "utf8"),
      ]);
      const manifest = JSON.parse(manifestSource);
      assert.deepEqual(
        documentedExportSpecifiers(markdown),
        expectedExportSpecifiers(manifest.name, manifest.publishConfig.exports),
        `${manifest.name} README export inventory does not match publishConfig.exports`,
      );
      examples.push({
        identifier: packageDefinition.identifier,
        source: extractVerifiedExample(markdown, packageDefinition.identifier),
      });

      run("pnpm", ["run", "build"], packageRoot);
      run("pnpm", ["pack", "--pack-destination", archiveDirectory], packageRoot);
    }

    const archives = (await readdir(archiveDirectory))
      .filter((entry) => entry.endsWith(".tgz"))
      .map((entry) => join(archiveDirectory, entry));
    assert.equal(archives.length, packages.length, "expected one archive for each public package");

    await writeFile(
      join(temporaryRoot, "package.json"),
      `${JSON.stringify({ name: "entellix-documentation-consumer", private: true, type: "module" }, null, 2)}\n`,
    );
    await writeFile(join(temporaryRoot, ".npmrc"), "audit=false\nfund=false\n");
    run("npm", ["install", "--ignore-scripts", "--no-package-lock", ...archives], temporaryRoot);

    for (const example of examples) {
      const examplePath = join(temporaryRoot, `${example.identifier}.mjs`);
      await writeFile(examplePath, example.source);
      run("node", [examplePath], temporaryRoot);
    }

    console.log("Published README examples and export inventories verified successfully.");
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
};

await verifyPublicDocumentation();
