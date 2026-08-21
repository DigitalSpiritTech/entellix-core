/**
 * Tests extractor behavior.
 *
 * Inputs: Imported dependencies and values passed to the module's documented functions.
 * Outputs: Exported types, values, and behavior provided by the module.
 * Errors: Functions document validation, dependency, and runtime errors individually.
 *
 * @packageDocumentation
 */

import {
  CANDIDATE_REASON_MAX_LENGTH,
  EXTRACTOR_PROMPT_VERSION,
  extractedCandidateSchema,
} from "@entellix/contracts/candidates";
import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";

import {
  type ExtractorConfig,
  type ExtractorEvent,
  type ExtractorGenerateFn,
  createExtractor,
  createExtractorEffect,
  isExtractorError,
} from "../extractor.ts";

/**
 * Unit surface for the multi-candidate extractor. Exercises the
 * extractor factory in isolation with a FAKE generate() (the raw LLM call is
 * injected) and hand-built event rows, so these must NOT touch Postgres,
 * an HTTP server, or a real model. These assertions pin the implemented
 * provider-neutral behavior.
 *
 * Pinned shape:
 *   createExtractor({ generate, config }) -> { extractFromBatch({ batchId, events }) }
 *   - parses generate() output with extractionOutputSchema
 *   - retries generate() exactly once on invalid output, else throws a typed error
 *   - directive candidateText is forced byte-equal to its evidence span
 *   - config.promptVersion flows onto the ExtractionResult
 */

const CONFIG: ExtractorConfig = {
  model: "fake-small-model",
  promptVersion: EXTRACTOR_PROMPT_VERSION,
};

/** A provider-neutral event for the batch input.
 *
 * @param rawText - Value supplied for `rawText`.
 * @returns The result produced by `eventRow`.
 * @throws Errors raised by validation or dependent operations.
 */
function eventRow(rawText: string): ExtractorEvent {
  return {
    id: "00000000-0000-4000-8000-0000000000e0",
    actorUserId: "00000000-0000-4000-8000-000000000001",
    rawText,
  };
}

/** Serialize a candidate list the way a well-behaved model would return it.
 *
 * @param candidates - Value supplied for `candidates`.
 * @returns The result produced by `modelOutput`.
 * @throws Errors raised by validation or dependent operations.
 */
function modelOutput(candidates: unknown[]): string {
  return JSON.stringify({ candidates });
}

describe("createExtractor — multi-candidate split with evidence spans", () => {
  it("splits a mixed message into two typed candidates with verbatim evidence spans", async () => {
    const input = "Acme switched to Next.js and I prefer PR summaries in bullets";
    const generate = vi.fn<ExtractorGenerateFn>(async () =>
      modelOutput([
        {
          candidateText: "Acme switched to Next.js",
          provisionalType: "fact",
          evidenceSpan: "Acme switched to Next.js",
          reasonSummary: "Client tech-stack change worth remembering.",
        },
        {
          candidateText: "Ted prefers PR summaries in bullets",
          provisionalType: "preference",
          evidenceSpan: "I prefer PR summaries in bullets",
          reasonSummary: "Personal formatting preference.",
        },
      ]),
    );

    const extractor = createExtractor({ generate, config: CONFIG });
    const result = await extractor.extractFromBatch({
      batchId: "batch-1",
      events: [eventRow(input)],
    });

    expect(result.candidates).toHaveLength(2);
    expect(result.candidates.map((candidate) => candidate.provisionalType)).toEqual([
      "fact",
      "preference",
    ]);
    // Evidence spans are verbatim excerpts of the source batch text.
    for (const candidate of result.candidates) {
      expect(input).toContain(candidate.evidenceSpan);
    }
    // config flows through to the result (and, downstream, to persisted rows).
    expect(result.promptVersion).toBe(EXTRACTOR_PROMPT_VERSION);
    expect(result.model).toBe(CONFIG.model);
  });
});

describe("createExtractor — directive candidates stay byte-verbatim", () => {
  it("forces directive candidateText byte-equal to its evidence span (never paraphrases)", async () => {
    const evidence = "never deploy to production on Fridays";
    const input = `Hard rule for the team: ${evidence}.`;
    const generate = vi.fn<ExtractorGenerateFn>(async () =>
      // The model paraphrased candidateText — the extractor must refuse the
      // paraphrase and normalize to the verbatim evidence span.
      modelOutput([
        {
          candidateText: "Do not deploy on Fridays",
          provisionalType: "directive",
          evidenceSpan: evidence,
          reasonSummary: "Team deploy rule.",
        },
      ]),
    );

    const extractor = createExtractor({ generate, config: CONFIG });
    const result = await extractor.extractFromBatch({
      batchId: "batch-d",
      events: [eventRow(input)],
    });

    const directive = result.candidates.find(
      (candidate) => candidate.provisionalType === "directive",
    );
    expect(directive).toBeDefined();
    // Byte-equality: candidate text IS the evidence span core for directives.
    expect(directive!.candidateText).toBe(directive!.evidenceSpan);
    expect(directive!.candidateText).toBe(evidence);
  });
});

describe("createExtractor — tolerates fenced live-model output", () => {
  it("parses a ```json-fenced first response without needing the retry", async () => {
    // The real Anthropic path (generateText) commonly wraps JSON in a code fence
    // even when told not to; the extractor must recover on the FIRST response.
    const good = modelOutput([
      {
        candidateText: "Acme switched to Next.js",
        provisionalType: "fact",
        evidenceSpan: "Acme switched to Next.js",
        reasonSummary: "Client stack change.",
      },
    ]);
    const generate = vi.fn<ExtractorGenerateFn>(async () => "```json\n" + good + "\n```");

    const extractor = createExtractor({ generate, config: CONFIG });
    const result = await extractor.extractFromBatch({
      batchId: "batch-fenced",
      events: [eventRow("Acme switched to Next.js")],
    });

    expect(result.retried).toBe(false);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.candidateText).toBe("Acme switched to Next.js");
  });
});

describe("createExtractor — Zod validation with a single retry", () => {
  it("retries once on malformed output and succeeds (generate called exactly twice)", async () => {
    const good = modelOutput([
      {
        candidateText: "Acme switched to Next.js",
        provisionalType: "fact",
        evidenceSpan: "Acme switched to Next.js",
        reasonSummary: "Client stack change.",
      },
    ]);
    const generate = vi
      .fn<ExtractorGenerateFn>()
      .mockResolvedValueOnce("this is not json at all")
      .mockResolvedValueOnce(good);

    const extractor = createExtractor({ generate, config: CONFIG });
    const result = await extractor.extractFromBatch({
      batchId: "batch-retry",
      events: [eventRow("Acme switched to Next.js")],
    });

    expect(result.retried).toBe(true);
    expect(result.candidates).toHaveLength(1);
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it("throws a typed error after two malformed responses and never calls generate a third time", async () => {
    const generate = vi
      .fn<ExtractorGenerateFn>()
      .mockResolvedValueOnce("{ not valid")
      .mockResolvedValueOnce("{ still not valid")
      .mockResolvedValue(
        modelOutput([
          {
            candidateText: "should never be reached",
            provisionalType: "fact",
            evidenceSpan: "should never be reached",
            reasonSummary: "unreachable",
          },
        ]),
      );

    const extractor = createExtractor({ generate, config: CONFIG });

    await expect(
      extractor.extractFromBatch({ batchId: "batch-bad", events: [eventRow("anything")] }),
    ).rejects.toSatisfy(isExtractorError);
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it("exposes the same workflow as an Effect with a typed failure channel", async () => {
    const generate = vi.fn<ExtractorGenerateFn>().mockResolvedValue("{ invalid");
    const extractor = createExtractorEffect({ generate, config: CONFIG });

    const outcome = await Effect.runPromise(
      Effect.either(
        extractor.extractFromBatch({
          batchId: "batch-effect",
          events: [eventRow("anything")],
        }),
      ),
    );

    expect(outcome).toMatchObject({
      _tag: "Left",
      left: { kind: "output_invalid", attempts: 2 },
    });
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it("turns a rejected model call into a typed generation failure without retrying it", async () => {
    const generate = vi.fn<ExtractorGenerateFn>().mockRejectedValue(new Error("provider down"));
    const extractor = createExtractor({ generate, config: CONFIG });

    await expect(
      extractor.extractFromBatch({
        batchId: "batch-provider-failure",
        events: [eventRow("anything")],
      }),
    ).rejects.toMatchObject({ kind: "generation_failed", attempts: 1 });
    expect(generate).toHaveBeenCalledTimes(1);
  });
});

describe("createExtractor — prompt content is versioned and evidence-driven", () => {
  it("includes the batch events raw text and instructs multi-candidate + evidence extraction", async () => {
    const rawA = "Acme switched to Next.js";
    const rawB = "I prefer PR summaries in bullets";
    const generate = vi.fn<ExtractorGenerateFn>(async () => modelOutput([]));
    const extractor = createExtractor({ generate, config: CONFIG });

    await extractor.extractFromBatch({
      batchId: "batch-prompt",
      events: [eventRow(rawA), eventRow(rawB)],
    });

    expect(generate).toHaveBeenCalledTimes(1);
    const prompt = generate.mock.calls[0]![0];
    // Raw text of every batch event is present in the prompt.
    expect(prompt).toContain(rawA);
    expect(prompt).toContain(rawB);
    // The instruction asks for multiple candidates and evidence spans.
    expect(prompt.toLowerCase()).toMatch(/candidate/);
    expect(prompt.toLowerCase()).toMatch(/evidence/);
  });
});

describe("reasonSummary — the only rationale field, and short (no chain-of-thought)", () => {
  it("caps reasonSummary at the contract max length", () => {
    const tooLong = "x".repeat(CANDIDATE_REASON_MAX_LENGTH + 1);
    const result = extractedCandidateSchema.safeParse({
      candidateText: "Acme switched to Next.js",
      provisionalType: "fact",
      evidenceSpan: "Acme switched to Next.js",
      reasonSummary: tooLong,
    });
    expect(result.success).toBe(false);
  });

  it("surfaces a short reasonSummary as the sole rationale on each extracted candidate", async () => {
    const generate = vi.fn<ExtractorGenerateFn>(async () =>
      modelOutput([
        {
          candidateText: "Acme switched to Next.js",
          provisionalType: "fact",
          evidenceSpan: "Acme switched to Next.js",
          reasonSummary: "Client stack change.",
        },
      ]),
    );
    const extractor = createExtractor({ generate, config: CONFIG });
    const result = await extractor.extractFromBatch({
      batchId: "batch-reason",
      events: [eventRow("Acme switched to Next.js")],
    });

    for (const candidate of result.candidates) {
      expect(candidate.reasonSummary.length).toBeLessThanOrEqual(CANDIDATE_REASON_MAX_LENGTH);
      expect(candidate.reasonSummary.length).toBeGreaterThan(0);
      // The candidate carries no free-text rationale field other than reasonSummary.
      expect(Object.keys(candidate).toSorted()).toEqual(
        ["candidateText", "evidenceSpan", "provisionalType", "reasonSummary"].toSorted(),
      );
    }
  });
});
