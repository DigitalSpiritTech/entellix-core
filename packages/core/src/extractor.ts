/**
 * Implements extractor behavior for this TypeScript module.
 *
 * Inputs: Imported dependencies and values passed to the module's documented functions.
 * Outputs: Exported types, values, and behavior provided by the module.
 * Errors: Functions document validation, dependency, and runtime errors individually.
 *
 * @packageDocumentation
 */

import {
  type ExtractedCandidate,
  type ExtractFromBatchInput,
  type ExtractionResult,
  type ExtractorConfig,
  extractFromBatchInputSchema,
  extractionOutputSchema,
  extractionResultSchema,
  extractorConfigSchema,
} from "@entellix/contracts/candidates";
import { Effect, Either } from "effect";

import { buildExtractorPrompt } from "./extractor-prompt.ts";
import { extractJsonText } from "./model-output.ts";

export { buildExtractorPrompt } from "./extractor-prompt.ts";
export type {
  ExtractFromBatchInput,
  ExtractionResult,
  ExtractorConfig,
  ExtractorEvent,
} from "@entellix/contracts/candidates";

/**
 * Multi-candidate extractor (S2.1.3). Splits a session batch into 0..N candidate
 * memories with verbatim evidence spans, using a small model whose id + prompt
 * are injected as versioned CONFIG (never a hardcoded model call in logic — ADR
 * 0019). LLM output is Zod-validated and retried exactly once on invalid; a
 * second failure throws a typed error. Directive candidates are kept
 * byte-verbatim (no normalization at extraction — Decision 10). persistCandidates
 * writes the result to `memory_candidates` via the service-role db.
 */

/** The raw LLM call, injected so unit tests use fakes and the model stays config. */
export type ExtractorGenerateFn = (prompt: string) => Promise<string>;

export interface ExtractorDeps {
  generate: ExtractorGenerateFn;
  config: ExtractorConfig;
}

export interface Extractor {
  /**
   * Executes extract from batch.
   *
   * @param input - Value supplied for `input`.
   * @returns The result produced by `extractFromBatch`.
   * @throws Errors raised by validation or dependent operations.
   */
  extractFromBatch(input: ExtractFromBatchInput): Promise<ExtractionResult>;
}

/** Effect-native extractor surface used by functional orchestration. */
export interface EffectExtractor {
  /**
   * Executes extract from batch.
   *
   * @param input - Value supplied for `input`.
   * @returns The result produced by `extractFromBatch`.
   * @throws Errors raised by validation or dependent operations.
   */
  extractFromBatch(input: ExtractFromBatchInput): Effect.Effect<ExtractionResult, ExtractorError>;
}

/** Kinds of failure the extractor raises as a typed, catchable error. */
export const EXTRACTOR_ERROR_KINDS = [
  "input_invalid",
  "generation_failed",
  "output_invalid",
] as const;
export type ExtractorErrorKind = (typeof EXTRACTOR_ERROR_KINDS)[number];

/**
 * Typed extractor failure. Structural (not a class subtype) so it stays within
 * the functional-TS rules: build with `new Error` then tag it.
 */
export interface ExtractorError extends Error {
  readonly kind: ExtractorErrorKind;
  /** Generate attempts made before failure; zero means input validation failed. */
  readonly attempts: number;
}

/**
 * Creates extractor error.
 *
 * @param kind - Value supplied for `kind`.
 * @param attempts - Value supplied for `attempts`.
 * @param message - Value supplied for `message`.
 * @returns The result produced by `createExtractorError`.
 * @throws Errors raised by validation or dependent operations.
 */
export function createExtractorError(
  kind: ExtractorErrorKind,
  attempts: number,
  message: string,
): ExtractorError {
  return Object.assign(new Error(message), { kind, attempts } as const);
}

/**
 * Determines whether extractor error.
 *
 * @param value - Value supplied for `value`.
 * @returns The result produced by `isExtractorError`.
 * @throws Errors raised by validation or dependent operations.
 */
export function isExtractorError(value: unknown): value is ExtractorError {
  return (
    value instanceof Error &&
    (EXTRACTOR_ERROR_KINDS as readonly string[]).includes((value as ExtractorError).kind)
  );
}

/**
 * Parses a raw model response into validated candidates. Returns null on any
 * failure — invalid JSON or a shape that fails `extractionOutputSchema` — so the
 * caller can decide whether to retry.
 *
 * @param raw - Value supplied for `raw`.
 * @returns The result produced by `parseCandidates`.
 * @throws Errors raised by validation or dependent operations.
 */
function parseCandidates(raw: string): ExtractedCandidate[] | null {
  let json: unknown;
  try {
    json = JSON.parse(extractJsonText(raw));
  } catch {
    return null;
  }
  const parsed = extractionOutputSchema.safeParse(json);
  return parsed.success ? parsed.data.candidates : null;
}

/**
 * Directive candidates are stored verbatim (Decision 10): the extractor refuses
 * any paraphrase in `candidateText` and normalizes it to the (verbatim) evidence
 * span. Non-directive candidates pass through unchanged.
 *
 * @param candidate - Value supplied for `candidate`.
 * @returns The result produced by `enforceDirectiveVerbatim`.
 * @throws Errors raised by validation or dependent operations.
 */
function enforceDirectiveVerbatim(candidate: ExtractedCandidate): ExtractedCandidate {
  if (candidate.provisionalType !== "directive") return candidate;
  return { ...candidate, candidateText: candidate.evidenceSpan };
}

/**
 * Executes extraction attempt.
 *
 * @param generate - Value supplied for `generate`.
 * @param prompt - Value supplied for `prompt`.
 * @param attempt - Value supplied for `attempt`.
 * @returns The result produced by `extractionAttempt`.
 * @throws Errors raised by validation or dependent operations.
 */
function extractionAttempt(
  generate: ExtractorGenerateFn,
  prompt: string,
  attempt: number,
): Effect.Effect<ExtractedCandidate[], ExtractorError> {
  return Effect.tryPromise({
    /**
     * Executes try.
     *
     * Inputs: None.
     * @returns The result produced by `try`.
     * @throws Errors raised by validation or dependent operations.
     */
    try: () => generate(prompt),
    /**
     * Executes catch.
     *
     * @param cause - Value supplied for `cause`.
     * @returns The result produced by `catch`.
     * @throws Errors raised by validation or dependent operations.
     */
    catch: (cause) =>
      createExtractorError(
        "generation_failed",
        attempt,
        `extractor model generation failed: ${cause instanceof Error ? cause.message : String(cause)}`,
      ),
  }).pipe(
    Effect.flatMap((raw) => {
      const candidates = parseCandidates(raw);
      return candidates === null
        ? Effect.fail(
            createExtractorError(
              "output_invalid",
              attempt,
              `extractor output failed validation on attempt ${attempt}`,
            ),
          )
        : Effect.succeed(candidates);
    }),
  );
}

/**
 * Effect-native extractor composition. Zod owns input/output contracts; Effect
 * owns asynchronous generation and the typed failure channel.
 *
 * @param deps - Value supplied for `deps`.
 * @returns The result produced by `createExtractorEffect`.
 * @throws Errors raised by validation or dependent operations.
 */
export function createExtractorEffect(deps: ExtractorDeps): EffectExtractor {
  const { generate } = deps;
  const config = extractorConfigSchema.parse(deps.config);

  return {
    /**
     * Executes extract from batch.
     *
     * @param input - Value supplied for `input`.
     * @returns The result produced by `extractFromBatch`.
     * @throws Errors raised by validation or dependent operations.
     */
    extractFromBatch(
      input: ExtractFromBatchInput,
    ): Effect.Effect<ExtractionResult, ExtractorError> {
      return Effect.gen(function* () {
        const parsedInput = extractFromBatchInputSchema.safeParse(input);
        if (!parsedInput.success) {
          return yield* Effect.fail(
            createExtractorError("input_invalid", 0, parsedInput.error.message),
          );
        }

        const prompt = buildExtractorPrompt(parsedInput.data.events);
        const startedAt = Date.now();
        const first = yield* Effect.either(extractionAttempt(generate, prompt, 1));

        let candidates: ExtractedCandidate[];
        let retried = false;
        if (Either.isRight(first)) {
          candidates = first.right;
        } else if (first.left.kind === "generation_failed") {
          return yield* Effect.fail(first.left);
        } else {
          retried = true;
          candidates = yield* extractionAttempt(generate, prompt, 2);
        }

        return extractionResultSchema.parse({
          candidates: candidates.map(enforceDirectiveVerbatim),
          model: config.model,
          promptVersion: config.promptVersion,
          retried,
          usageTokens: null,
          latencyMs: Date.now() - startedAt,
        });
      });
    },
  };
}

/** Promise adapter retained for the existing SaaS composition root.
 *
 * @param deps - Value supplied for `deps`.
 * @returns The result produced by `createExtractor`.
 * @throws Errors raised by validation or dependent operations.
 */
export function createExtractor(deps: ExtractorDeps): Extractor {
  const extractor = createExtractorEffect(deps);
  return {
    /**
     * Executes extract from batch.
     *
     * @param input - Value supplied for `input`.
     * @returns The result produced by `extractFromBatch`.
     * @throws Errors raised by validation or dependent operations.
     */
    async extractFromBatch(input: ExtractFromBatchInput): Promise<ExtractionResult> {
      const outcome = await Effect.runPromise(Effect.either(extractor.extractFromBatch(input)));
      if (Either.isLeft(outcome)) throw outcome.left;
      return outcome.right;
    },
  };
}
