/**
 * Defines validated governance classifications for extracted memory candidates.
 *
 * Inputs: Imported dependencies and values passed to the module's documented functions.
 * Outputs: Exported types, values, and behavior provided by the module.
 * Errors: Functions document validation, dependency, and runtime errors individually.
 *
 * @packageDocumentation
 */

import { z } from "zod";

import { memoryCandidateSchema } from "./candidates.ts";
import { entityTypeSchema } from "./entities.ts";
import { sourceTrustClassSchema } from "./events.ts";
import {
  audiencePolicyKindSchema,
  memoryTypeSchema,
  ownerScopeTypeSchema,
  sensitivitySchema,
  sourceAuthoritySchema,
} from "./memory-v2.ts";

/**
 * Classifier-suite contracts. Every candidate is classified along all
 * governance axes in one workflow — type, owner, entity links, audience,
 * sensitivity, confidence, and an operation guess. Scope is ENTELLIX's decision,
 * never the host model's: `active_org_id` is a context signal only, never a
 * default owner, so owner plus a multi-scope `scopeDistribution` come
 * from the classifier's own reasoning, not from the caller's active org.
 *
 * Two shapes, deliberately distinct:
 *   - `classifierLlmOutputSchema` — the RAW small-model output the classifier
 *     Zod-validates and retries once. The model proposes the axes it can judge
 *     from text (type, owner, distribution, sensitivity, operation, and entity
 *     *mentions* as free-text aliases). It never invents entity ids, an audience
 *     policy, or a source authority — those are code-derived.
 *   - `classificationSchema` — the ASSEMBLED governance verdict the classifier
 *     returns and persists. `entityLinks` carry resolved registry ids;
 *     `entityCreationCandidates` are unresolved aliases (unknown aliases must NOT
 *     silently mint entities — Open Q7); `audienceSuggestion` comes from wording
 *     heuristics + membership context; `sourceAuthority` is mapped from the
 *     event's trust class.
 *
 * Convention mirrors the rest of contracts: `const FOO = [...] as const` →
 * `fooSchema = z.enum(FOO)` → `z.infer`. Imported via the
 * `@entellix/contracts/classification` subpath (not the package barrel), like
 * `./candidates.ts`.
 */

/** Classifier prompt id, versioned CONFIG (not code) so a prompt change is auditable. */
export const CLASSIFIER_PROMPT_VERSION = "classifier/2026-08-19";

/** Cap on the short human-readable `basis` string explaining an audience choice. */
export const AUDIENCE_BASIS_MAX_LENGTH = 280;

/**
 * The reconciler operation the classifier GUESSES for a candidate. Same eight
 * verbs the reconciler executes plus REVIEW/NOOP as terminal routes;
 * the guess is advisory — conflict detection + the policy matrix refine it.
 */
export const OPERATION_GUESSES = [
  "ADD",
  "UPDATE",
  "SUPERSEDE",
  "MERGE",
  "SPLIT",
  "EXPIRE",
  "NOOP",
  "REVIEW",
] as const;
export const operationGuessSchema = z.enum(OPERATION_GUESSES);
export type OperationGuess = z.infer<typeof operationGuessSchema>;

/** A probability/confidence in [0, 1]. */
const confidenceSchema = z.number().min(0).max(1);

/** Owner call with its confidence. `value` is binary user or organization. */
export const ownerAssessmentSchema = z.object({
  value: ownerScopeTypeSchema,
  confidence: confidenceSchema,
});
export type OwnerAssessment = z.infer<typeof ownerAssessmentSchema>;

/**
 * One entry of the multi-scope owner distribution. A confident classification
 * emits a single entry (matching `owner.value`); an uncertain one emits both
 * user and org with confidences that sum to ≈1 — a distribution, never a point
 * guess, so ambiguous scope produces a distribution rather than a point guess.
 */
export const scopeDistributionEntrySchema = z.object({
  owner: ownerScopeTypeSchema,
  confidence: confidenceSchema,
});
export type ScopeDistributionEntry = z.infer<typeof scopeDistributionEntrySchema>;

/** A free-text entity mention the model surfaced, to be resolved against the registry. */
export const entityMentionSchema = z.object({
  alias: z.string().trim().min(1).max(200),
  suggestedType: entityTypeSchema,
  /** How the entity relates to the memory, e.g. `subject`, `mentions`, `owner`. */
  role: z.string().trim().min(1).max(60),
});
export type EntityMention = z.infer<typeof entityMentionSchema>;

/** A resolved registry link: a real entity id + relationship role + confidence. */
export const entityLinkSchema = z.object({
  entityId: z.uuid(),
  role: z.string().trim().min(1).max(60),
  confidence: confidenceSchema,
});
export type EntityLink = z.infer<typeof entityLinkSchema>;

/**
 * An unresolved alias the classifier could NOT map to a registry entity. Carried
 * for review/curation — never auto-minted into the registry (Open Q7). Lacks an
 * id and a role precisely because no entity exists yet.
 */
export const entityCreationCandidateSchema = z.object({
  alias: z.string().trim().min(1).max(200),
  suggestedType: entityTypeSchema,
});
export type EntityCreationCandidate = z.infer<typeof entityCreationCandidateSchema>;

/**
 * Suggested audience policy for the memory, derived from wording heuristics
 * ("I prefer" → private_to_owner; "our company" → org_members; "for this
 * client/project" → project_members) plus membership context. `projectEntityId`
 * is set only for a project_members suggestion whose project entity resolved.
 */
export const audienceSuggestionSchema = z.object({
  kind: audiencePolicyKindSchema,
  basis: z.string().trim().min(1).max(AUDIENCE_BASIS_MAX_LENGTH),
  projectEntityId: z.uuid().optional(),
});
export type AudienceSuggestion = z.infer<typeof audienceSuggestionSchema>;

/** Sensitivity level plus the about-another-person flag (a hard review trigger). */
export const sensitivityAssessmentSchema = z.object({
  level: sensitivitySchema,
  aboutAnotherPerson: z.boolean(),
});
export type SensitivityAssessment = z.infer<typeof sensitivityAssessmentSchema>;

/**
 * RAW small-model output — the axes the model judges from text, Zod-validated
 * and retried once. Entity mentions are free-text aliases (resolution is a
 * code step); `audienceHint` is the model's guess that heuristics may override.
 * The model never emits `sourceAuthority`, resolved `entityLinks`, or the final
 * `audienceSuggestion` — those are assembled deterministically.
 */
export const classifierLlmOutputSchema = z.object({
  memoryType: memoryTypeSchema,
  owner: ownerAssessmentSchema,
  scopeDistribution: z.array(scopeDistributionEntrySchema).min(1),
  entityMentions: z.array(entityMentionSchema),
  audienceHint: audiencePolicyKindSchema,
  sensitivity: sensitivityAssessmentSchema,
  operationGuess: operationGuessSchema,
  confidence: confidenceSchema,
});
export type ClassifierLlmOutput = z.infer<typeof classifierLlmOutputSchema>;

/**
 * The assembled governance verdict for one candidate: the model's axes plus the
 * code-derived entity links, audience suggestion, and source authority. This is
 * what the classifier returns and what `persistClassification` writes as the
 * `classification` jsonb column.
 */
export const classificationSchema = z.object({
  memoryType: memoryTypeSchema,
  owner: ownerAssessmentSchema,
  scopeDistribution: z.array(scopeDistributionEntrySchema).min(1),
  entityLinks: z.array(entityLinkSchema),
  entityCreationCandidates: z.array(entityCreationCandidateSchema),
  audienceSuggestion: audienceSuggestionSchema,
  sensitivity: sensitivityAssessmentSchema,
  sourceAuthority: sourceAuthoritySchema,
  operationGuess: operationGuessSchema,
  confidence: confidenceSchema,
});
export type Classification = z.infer<typeof classificationSchema>;

/**
 * A `memory_candidates` row enriched with its classification — the persisted
 * shape the classifier stamps (status advances to `classified`). `classifier`
 * version + model are the versioned CONFIG that produced the verdict, alongside
 * the extractor provenance already on the candidate.
 */
export const enrichedCandidateSchema = memoryCandidateSchema.extend({
  classification: classificationSchema,
  classifierVersion: z.string().min(1),
  model: z.string().min(1),
});
export type EnrichedCandidate = z.infer<typeof enrichedCandidateSchema>;

/** Versioned model and prompt selection supplied to the core classifier. */
export const classifierConfigSchema = z.object({
  model: z.string().trim().min(1),
  promptVersion: z.string().trim().min(1),
});
export type ClassifierConfig = z.infer<typeof classifierConfigSchema>;

/** Registry entity resolved by a host-owned entity adapter. */
export const resolvedEntitySchema = z.object({
  id: z.uuid(),
  type: z.string().trim().min(1),
});
export type ResolvedEntity = z.infer<typeof resolvedEntitySchema>;

/** Explicit entity-resolution variants; unresolved input is never guessed. */
export const resolveEntityResultSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("match"), entity: resolvedEntitySchema }),
  z.object({ kind: z.literal("ambiguous"), candidates: z.array(resolvedEntitySchema) }),
  z.object({ kind: z.literal("none") }),
]);
export type ResolveEntityResult = z.infer<typeof resolveEntityResultSchema>;

/** Validated candidate plus trusted event context accepted by the classifier. */
export const classifyCandidateInputSchema = z.object({
  candidate: memoryCandidateSchema,
  context: z.object({
    actorUserId: z.uuid(),
    activeOrgId: z.uuid().nullable(),
    sourceTrustClass: sourceTrustClassSchema,
  }),
  registryAliasHints: z.array(z.string()).optional(),
});
export type ClassifyCandidateInput = z.infer<typeof classifyCandidateInputSchema>;

/** Validated classifier result emitted to persistence and policy adapters. */
export const classificationResultSchema = z.object({
  candidate: memoryCandidateSchema,
  classification: classificationSchema,
  model: z.string().trim().min(1),
  classifierVersion: z.string().trim().min(1),
  retried: z.boolean(),
});
export type ClassificationResult = z.infer<typeof classificationResultSchema>;
