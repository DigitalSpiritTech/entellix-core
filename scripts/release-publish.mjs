/**
 * @file Publishes workspace packages with Changesets 3 while preserving the
 * tag markers consumed by changesets/action v1.
 */

import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageNamePattern = /^(@[^/\s]+\/[^@\s]+|[^/@\s][^@\s]*)$/;

/**
 * Parses one Changesets structured-output event into an action-compatible tag.
 *
 * @param {string} line - One NDJSON line emitted by Changesets.
 * @param {number} lineNumber - One-based report line number used in errors.
 * @returns {string | undefined} The validated tag, or undefined for unrelated events.
 * @throws {Error} When JSON or a git-tag event is malformed.
 */
const parseChangesetsTag = (line, lineNumber) => {
  let event;
  try {
    event = JSON.parse(line);
  } catch (error) {
    throw new Error(`Changesets output line ${lineNumber} is not valid JSON`, { cause: error });
  }

  if (typeof event !== "object" || event === null || event.type !== "git-tag") {
    return undefined;
  }
  if (
    typeof event.packageName !== "string" ||
    !packageNamePattern.test(event.packageName) ||
    typeof event.tag !== "string"
  ) {
    throw new Error(`Changesets git-tag event on line ${lineNumber} is malformed`);
  }

  const tagPrefix = `${event.packageName}@`;
  const version = event.tag.startsWith(tagPrefix) ? event.tag.slice(tagPrefix.length) : "";
  if (!version || /\s/.test(version)) {
    throw new Error(`Changesets tag ${event.tag} does not match package ${event.packageName}`);
  }

  return event.tag;
};

/**
 * Converts Changesets 3 NDJSON tag events into markers recognized by the action.
 *
 * @param {string} report - Complete Changesets structured publish output.
 * @returns {string} Deduplicated legacy tag markers, separated by newlines.
 * @throws {Error} When a report line or git-tag event is invalid.
 */
export const renderChangesetsActionTagLines = (report) => {
  const tags = report
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => parseChangesetsTag(line, index + 1))
    .filter((tag) => tag !== undefined);

  return [...new Set(tags)].map((tag) => `New tag: ${tag}`).join("\n");
};

/**
 * Runs Changesets publishing and exposes its created tags to changesets/action v1.
 *
 * @param {string} cwd - Repository directory containing the Changesets configuration.
 * @returns {Promise<void>} A promise that resolves after publishing and marker emission.
 * @throws {Error} When Changesets cannot start, fails, or emits an invalid report.
 */
export const runChangesetsPublish = async (cwd = repositoryRoot) => {
  const outputDirectory = await mkdtemp(join(tmpdir(), "entellix-changesets-publish-"));
  const outputPath = join(outputDirectory, "events.ndjson");

  try {
    const changesetsBin = require.resolve("@changesets/cli/bin.js", { paths: [cwd] });
    const result = spawnSync(process.execPath, [changesetsBin, "publish"], {
      cwd,
      env: { ...process.env, CHANGESETS_OUTPUT: outputPath },
      stdio: "inherit",
    });

    if (result.error) {
      throw new Error("Unable to start Changesets publishing", { cause: result.error });
    }
    if (result.status !== 0) {
      throw new Error(`Changesets publishing failed with exit code ${result.status ?? "unknown"}`);
    }

    const actionTagLines = renderChangesetsActionTagLines(await readFile(outputPath, "utf8"));
    if (actionTagLines) {
      console.log(actionTagLines);
    }
  } finally {
    await rm(outputDirectory, { recursive: true, force: true });
  }
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await runChangesetsPublish().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
