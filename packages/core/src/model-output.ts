/**
 * Recovers and validates JSON values from tolerant model text responses.
 *
 * Inputs: Imported dependencies and values passed to the module's documented functions.
 * Outputs: Exported types, values, and behavior provided by the module.
 * Errors: Functions document validation, dependency, and runtime errors individually.
 *
 * @packageDocumentation
 */

/**
 * Tolerant JSON extraction for model-backed core stages. The model
 * boundary is text-in/text-out (`generateText`), and even when the prompt demands
 * "raw JSON only", chat models routinely wrap the payload in a ```json fence or
 * add a one-line preface. A bare `JSON.parse` on that text fails — and since the
 * retry re-sends the same prompt, it fails identically and the stage throws
 * `output_invalid`. Every stage parses its output through {@link extractJsonText}
 * so a fenced or prose-wrapped response still yields the JSON value; a clean
 * response passes through unchanged.
 */

/**
 * Returns the JSON substring of a model response, tolerating markdown code fences
 * and surrounding prose. Strips a ```` ```json … ``` ```` (or bare ```` ``` ```) fence
 * if present, then slices from the first `{`/`[` to its matching last `}`/`]`. A
 * response that is already clean JSON is returned trimmed and otherwise intact.
 *
 * @param raw - Value supplied for `raw`.
 * @returns The result produced by `extractJsonText`.
 * @throws Errors raised by validation or dependent operations.
 */
export function extractJsonText(raw: string): string {
  const trimmed = raw.trim();
  // Prefer the contents of the first fenced block when the model wraps its JSON.
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const body = (fenced ? fenced[1]! : trimmed).trim();

  // Slice to the outermost JSON value so a leading/trailing sentence is dropped.
  const firstBrace = body.indexOf("{");
  const firstBracket = body.indexOf("[");
  const candidates = [firstBrace, firstBracket].filter((index) => index !== -1);
  if (candidates.length === 0) return body;
  const start = Math.min(...candidates);
  const close = body[start] === "{" ? "}" : "]";
  const end = body.lastIndexOf(close);
  return end > start ? body.slice(start, end + 1) : body;
}
