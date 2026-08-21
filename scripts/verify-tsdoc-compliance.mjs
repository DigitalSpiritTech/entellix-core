import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { inspectTsdocCompliance } from "./tsdoc-compliance.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const excludedDirectories = new Set([
  ".git",
  ".mastra",
  ".turbo",
  "artifacts",
  "coverage",
  "dist",
  "node_modules",
]);

/**
 * Finds TypeScript source files below a repository directory.
 *
 * @param directory - Absolute directory to traverse.
 * @returns Absolute paths for TypeScript source files that are not generated output.
 * @throws A file-system error when a directory cannot be read.
 */
async function findTypeScriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      if (entry.isDirectory()) {
        return excludedDirectories.has(entry.name)
          ? []
          : findTypeScriptFiles(path.join(directory, entry.name));
      }
      return entry.isFile() && /\.(?:cts|mts|tsx?|d\.ts)$/u.test(entry.name)
        ? [path.join(directory, entry.name)]
        : [];
    }),
  );
  return nested.flat();
}

const sourcePaths = (await findTypeScriptFiles(repositoryRoot)).toSorted();
const violations = (
  await Promise.all(
    sourcePaths.map(async (absolutePath) => {
      const filePath = path.relative(repositoryRoot, absolutePath);
      const sourceText = await readFile(absolutePath, "utf8");
      return inspectTsdocCompliance(filePath, sourceText);
    }),
  )
).flat();

if (violations.length > 0) {
  for (const violation of violations) {
    console.error(
      `${violation.filePath}:${violation.line} [${violation.rule}] ${violation.message}`,
    );
  }
  console.error(`TSDoc compliance failed with ${violations.length} violation(s).`);
  process.exitCode = 1;
} else {
  console.log(`TSDoc compliance passed for ${sourcePaths.length} TypeScript file(s).`);
}
