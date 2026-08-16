import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const sourceRoot = join(import.meta.dirname, "..");

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
