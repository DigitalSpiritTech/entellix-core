/**
 * Tests urls behavior.
 *
 * Inputs: Imported dependencies and values passed to the module's documented functions.
 * Outputs: Exported types, values, and behavior provided by the module.
 * Errors: Functions document validation, dependency, and runtime errors individually.
 *
 * @packageDocumentation
 */

import { describe, expect, it } from "vitest";

import { memoriesListUrl, memoryAppUrl } from "../src/index.ts";

const id = "6f2b9a3e-9c1d-4a5b-8e7f-1a2b3c4d5e6f";

describe("memoryAppUrl", () => {
  it("builds a full memory detail URL", () => {
    expect(memoryAppUrl("http://localhost:3000", id)).toBe(`http://localhost:3000/memories/${id}`);
  });

  it("tolerates a trailing slash on the base URL", () => {
    expect(memoryAppUrl("http://localhost:3000/", id)).toBe(`http://localhost:3000/memories/${id}`);
  });

  it("accepts a URL instance", () => {
    expect(memoryAppUrl(new URL("https://app.entellix.io"), id)).toBe(
      `https://app.entellix.io/memories/${id}`,
    );
  });
});

describe("memoriesListUrl", () => {
  it("builds the full memory list URL", () => {
    expect(memoriesListUrl("https://app.entellix.io")).toBe("https://app.entellix.io/memories");
  });

  it("tolerates a trailing slash on the base URL", () => {
    expect(memoriesListUrl("https://app.entellix.io/")).toBe("https://app.entellix.io/memories");
  });
});
