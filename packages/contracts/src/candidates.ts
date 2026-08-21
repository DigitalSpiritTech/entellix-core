/**
 * Defines validated extractor outputs and persisted memory-candidate records.
 *
 * Inputs: Imported dependencies and values passed to the module's documented functions.
 * Outputs: Exported types, values, and behavior provided by the module.
 * Errors: Functions document validation, dependency, and runtime errors individually.
 *
 * @packageDocumentation
 */

import { z } from "zod";

import { memoryTypeSchema } from "./memory-v2.ts";

/**
 * Memory-candidate contracts. The extractor turns a session batch into
 * 0..N discrete candidate memories, each with an evidence span and a short
 * user-facing reason. Candidates are the pipeline's staging shape: they are NOT
 * canonical memory and are never written by an external agent — only the
 * service-role extractor worker persists them, and they earn commitment through
 * classification and reconciliation later in the pipeline.
 *
 * Convention mirrors the rest of contracts: `const FOO = [...] as const` →
 * `fooSchema = z.enum(FOO)` → `z.infer`. Deliberately NOT re-exported from the
 * package barrel; import via the `@entellix/contracts/candidates` subpath so the
 * unbuilt index barrel does not gate this.
 */

const isoDatetimeSchema = z.iso.datetime({ offset: true });

/**
 * Candidate lifecycle. `pending_classification` is the birth state written by
 * the extractor; the classifier suite advances to `classified`; the
 * policy matrix can route it to `review` or `rejected`, and reconciliation
 * advances successful writes to `committed`; stale candidates `expire`. Routing only — never a
 * terminal discard, preserving the salience gate's no-drop rule.
 */
export const CANDIDATE_STATUSES = [
  "pending_classification",
  "classified",
  "committed",
  "rejected",
  "review",
  "expired",
] as const;
export const candidateStatusSchema = z.enum(CANDIDATE_STATUSES);
export type CandidateStatus = z.infer<typeof candidateStatusSchema>;

/** Extractor prompt id, versioned CONFIG (not code) so a prompt change is auditable. */
export const EXTRACTOR_PROMPT_VERSION = "extractor/2026-07-06";

/**
 * Cap on the user-facing rationale. `reasonSummary` is the ONLY rationale field
 * a candidate carries. No chain-of-thought is persisted; the user-facing reason
 * is short by construction.
 */
export const CANDIDATE_REASON_MAX_LENGTH = 280;

/**
 * One extracted candidate as emitted by the small extractor model (Zod-validated
 * LLM output). `evidenceSpan` is a verbatim excerpt of the source batch text;
 * for `directive` candidates the extractor additionally forces
 * `candidateText` byte-equal to the evidence span (no normalization at
 * extraction. Substring and byte-equality are runtime invariants the
 * extractor enforces; the schema only bounds shape and length.
 */
export const extractedCandidateSchema = z.object({
  candidateText: z.string().trim().min(1).max(2000),
  provisionalType: memoryTypeSchema,
  evidenceSpan: z.string().trim().min(1).max(2000),
  reasonSummary: z.string().trim().min(1).max(CANDIDATE_REASON_MAX_LENGTH),
});
export type ExtractedCandidate = z.infer<typeof extractedCandidateSchema>;

/** Whole-batch extractor output: 0..N candidates (0 = do-not-save inputs). */
export const extractionOutputSchema = z.object({
  candidates: z.array(extractedCandidateSchema),
});
export type ExtractionOutput = z.infer<typeof extractionOutputSchema>;

/** Versioned model and prompt selection supplied to the core extractor. */
export const extractorConfigSchema = z.object({
  model: z.string().trim().min(1),
  promptVersion: z.string().trim().min(1),
});
export type ExtractorConfig = z.infer<typeof extractorConfigSchema>;

/** Provider-neutral event consumed by one core extraction run. */
export const extractorEventSchema = z.object({
  id: z.uuid(),
  actorUserId: z.uuid(),
  rawText: z.string().nullable(),
});
export type ExtractorEvent = z.infer<typeof extractorEventSchema>;

/** Validated batch boundary accepted by the core extractor. */
export const extractFromBatchInputSchema = z.object({
  batchId: z.string().trim().min(1),
  events: z.array(extractorEventSchema),
});
export type ExtractFromBatchInput = z.infer<typeof extractFromBatchInputSchema>;

/** Validated extraction result emitted to a host persistence adapter. */
export const extractionResultSchema = z.object({
  candidates: z.array(extractedCandidateSchema),
  model: z.string().trim().min(1),
  promptVersion: z.string().trim().min(1),
  retried: z.boolean(),
  usageTokens: z.number().int().nonnegative().nullable(),
  latencyMs: z.number().nonnegative(),
});
export type ExtractionResult = z.infer<typeof extractionResultSchema>;

/**
 * The persisted `memory_candidates` row shape. `batchId` + `sourceEventIds`
 * link the candidate back to its session batch and the append-only events it
 * came from; `extractorVersion` + `model` stamp the versioned config that
 * produced it. `activeOrgId` is context, never ownership.
 */
export const memoryCandidateSchema = z.object({
  id: z.uuid(),
  batchId: z.string().min(1),
  sourceEventIds: z.array(z.uuid()),
  actorUserId: z.uuid(),
  activeOrgId: z.uuid().nullable(),
  candidateText: z.string().min(1),
  provisionalType: memoryTypeSchema,
  evidenceSpan: z.string().min(1),
  reasonSummary: z.string().min(1).max(CANDIDATE_REASON_MAX_LENGTH),
  status: candidateStatusSchema,
  extractorVersion: z.string().min(1),
  model: z.string().min(1),
  createdAt: isoDatetimeSchema,
});
export type MemoryCandidate = z.infer<typeof memoryCandidateSchema>;
