/**
 * Tests boundary behavior.
 *
 * Inputs: Imported dependencies and values passed to the module's documented functions.
 * Outputs: Exported types, values, and behavior provided by the module.
 * Errors: Functions document validation, dependency, and runtime errors individually.
 *
 * @packageDocumentation
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const sourceRoot = join(import.meta.dirname, "..");

/**
 * Executes type script files.
 *
 * @param root - Value supplied for `root`.
 * @returns The result produced by `TypeScriptFiles`.
 * @throws Errors raised by validation or dependent operations.
 */
function TypeScriptFiles(root: string): string[] {
  return readdirSync(root).flatMap((entry) => {
    const path = join(root, entry);
    return statSync(path).isDirectory()
      ? TypeScriptFiles(path)
      : path.endsWith(".ts")
        ? [path]
        : [];
  });
}

describe("standalone distribution boundary", () => {
  it("does not import the SaaS app, hosted database package, or Supabase", () => {
    const source = TypeScriptFiles(sourceRoot)
      .filter((path) => !path.includes("/__specs__/"))
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");

    expect(source).not.toMatch(/@entellix\/api|@entellix\/db|apps\/api|supabase/i);
  });
});
