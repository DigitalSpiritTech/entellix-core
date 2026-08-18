import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  documentedExportSpecifiers,
  expectedExportSpecifiers,
  extractVerifiedExample,
} from "./public-documentation.mjs";

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

const packageCases = [
  ["contracts", "@entellix/contracts"],
  ["core", "@entellix/core"],
  ["instructions", "@entellix/instructions"],
];

test("extracts a named JavaScript example without copying a fixture", () => {
  const markdown = [
    "<!-- verify-example:demo -->",
    "```js",
    'import assert from "node:assert/strict";',
    "assert.equal(1 + 1, 2);",
    "```",
  ].join("\n");

  assert.match(extractVerifiedExample(markdown, "demo"), /assert\.equal/);
  assert.throws(() => extractVerifiedExample(markdown, "missing"), /missing/);
});

test("derives public specifiers from an exports map", () => {
  assert.deepEqual(expectedExportSpecifiers("@entellix/example", { ".": {}, "./feature": {} }), [
    "@entellix/example",
    "@entellix/example/feature",
  ]);
});

for (const [directory, packageName] of packageCases) {
  test(`${packageName} documents every published export and one executable example`, async () => {
    const packageRoot = join(repositoryRoot, "packages", directory);
    const [markdown, manifestSource] = await Promise.all([
      readFile(join(packageRoot, "README.md"), "utf8"),
      readFile(join(packageRoot, "package.json"), "utf8"),
    ]);
    const manifest = JSON.parse(manifestSource);

    assert.ok(extractVerifiedExample(markdown, directory).trim().length > 0);
    assert.deepEqual(
      documentedExportSpecifiers(markdown),
      expectedExportSpecifiers(packageName, manifest.publishConfig.exports),
    );
  });
}
