/**
 * Tests model output behavior.
 *
 * Inputs: Imported dependencies and values passed to the module's documented functions.
 * Outputs: Exported types, values, and behavior provided by the module.
 * Errors: Functions document validation, dependency, and runtime errors individually.
 *
 * @packageDocumentation
 */

import { describe, expect, it } from "vitest";

import { extractJsonText } from "../model-output.ts";

/**
 * Pins the tolerant JSON extraction every pipeline stage parses model output
 * through. The failure it guards: live Claude output wraps the JSON in a ```json
 * fence or adds a preface sentence, and a bare JSON.parse throws — twice, since
 * the retry re-sends the same prompt — so the stage errors with output_invalid.
 */
describe("extractJsonText", () => {
  const obj = '{"candidates":[{"candidateText":"Acme uses Next.js"}]}';

  it("passes clean JSON through unchanged", () => {
    expect(extractJsonText(obj)).toBe(obj);
    expect(JSON.parse(extractJsonText(obj))).toEqual({
      candidates: [{ candidateText: "Acme uses Next.js" }],
    });
  });

  it("unwraps a ```json fenced block", () => {
    const raw = "```json\n" + obj + "\n```";
    expect(JSON.parse(extractJsonText(raw))).toEqual(JSON.parse(obj));
  });

  it("unwraps a bare ``` fence", () => {
    const raw = "```\n" + obj + "\n```";
    expect(JSON.parse(extractJsonText(raw))).toEqual(JSON.parse(obj));
  });

  it("drops a leading preface sentence", () => {
    const raw = `Here is the JSON you asked for:\n${obj}`;
    expect(JSON.parse(extractJsonText(raw))).toEqual(JSON.parse(obj));
  });

  it("drops prose surrounding a fenced block", () => {
    const raw = `Sure — here you go:\n\`\`\`json\n${obj}\n\`\`\`\nLet me know if you need more.`;
    expect(JSON.parse(extractJsonText(raw))).toEqual(JSON.parse(obj));
  });

  it("handles a top-level JSON array", () => {
    const arr = '[{"relation":"duplicates"}]';
    const raw = "```json\n" + arr + "\n```";
    expect(JSON.parse(extractJsonText(raw))).toEqual([{ relation: "duplicates" }]);
  });

  it("leaves non-JSON text as-is (parse still fails → stage retries/errors)", () => {
    expect(extractJsonText("no json here")).toBe("no json here");
  });
});
