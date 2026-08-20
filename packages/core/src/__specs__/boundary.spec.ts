/**
 * Tests boundary behavior.
 *
 * Inputs: Imported dependencies and values passed to the module's documented functions.
 * Outputs: Exported types, values, and behavior provided by the module.
 * Errors: Functions document validation, dependency, and runtime errors individually.
 *
 * @packageDocumentation
 */

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const SOURCE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGE_ROOT = join(SOURCE_ROOT, "..");
const FORBIDDEN_IMPORTS = [
  "@entellix/db",
  "@supabase/",
  "drizzle-orm",
  "apps/api",
  "apps/web",
] as const;
const ALLOWED_EXPORTED_INTERFACES = [
  "Classifier",
  "ClassifierDeps",
  "ClassifierError",
  "ComposeMemoryPacketInput",
  "ConflictDetector",
  "ConflictDetectorDeps",
  "ConflictDetectorError",
  "CorePersistencePorts",
  "EffectExtractor",
  "Extractor",
  "ExtractorDeps",
  "ExtractorError",
  "ReconcilerError",
  "ResolveDirectivesInput",
  "VerifyContextEnvelopeInput",
] as const;

/**
 * Executes source files.
 *
 * @param directory - Value supplied for `directory`.
 * @returns The result produced by `sourceFiles`.
 * @throws Errors raised by validation or dependent operations.
 */
function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === "__specs__" ? [] : sourceFiles(path);
    return entry.isFile() && entry.name.endsWith(".ts") ? [path] : [];
  });
}

describe("@entellix/core dependency direction", () => {
  it("does not import SaaS apps, database adapters, or Supabase", () => {
    for (const file of sourceFiles(SOURCE_ROOT)) {
      const source = readFileSync(file, "utf8");
      for (const forbidden of FORBIDDEN_IMPORTS) {
        expect(source, `${file} imports forbidden boundary ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it("does not declare SaaS infrastructure packages as runtime dependencies", () => {
    const manifest = JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
    };
    const dependencyNames = Object.keys(manifest.dependencies ?? {});

    expect(dependencyNames).not.toContain("@entellix/db");
    expect(dependencyNames.some((name) => name.startsWith("@supabase/"))).toBe(false);
    expect(dependencyNames).not.toContain("drizzle-orm");
  });

  it("keeps exported interfaces limited to ports, services, errors, or callback-bearing inputs", () => {
    const exportedInterfaces = sourceFiles(SOURCE_ROOT).flatMap((file) => {
      const source = readFileSync(file, "utf8");
      return [...source.matchAll(/^export interface (\w+)/gm)].map((match) => match[1]!);
    });

    expect(exportedInterfaces.toSorted()).toEqual([...ALLOWED_EXPORTED_INTERFACES].toSorted());
  });

  it("does not expose standalone object-shape aliases or classes from core", () => {
    for (const file of sourceFiles(SOURCE_ROOT)) {
      const source = readFileSync(file, "utf8");
      expect(source, `${file} exports a bare object-shape type alias`).not.toMatch(
        /^export type \w+\s*=\s*\{/m,
      );
      expect(source, `${file} declares a class`).not.toMatch(/^(?:export )?class \w+/m);
    }
  });
});
