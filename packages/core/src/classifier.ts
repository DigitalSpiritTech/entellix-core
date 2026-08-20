/**
 * Implements classifier behavior for this TypeScript module.
 *
 * Inputs: Imported dependencies and values passed to the module's documented functions.
 * Outputs: Exported types, values, and behavior provided by the module.
 * Errors: Functions document validation, dependency, and runtime errors individually.
 *
 * @packageDocumentation
 */

import type {
  AudiencePolicyKind,
  MemoryType,
  OrgMembership,
  SourceAuthority,
  SourceTrustClass,
} from "@entellix/contracts";
import type { MemoryCandidate } from "@entellix/contracts/candidates";
import {
  type AudienceSuggestion,
  type ClassifierConfig,
  type Classification,
  type ClassificationResult,
  type ClassifierLlmOutput,
  type ClassifyCandidateInput,
  type EntityCreationCandidate,
  type EntityLink,
  type ResolvedEntity,
  type ResolveEntityResult,
  classifierConfigSchema,
  classifierLlmOutputSchema,
  classificationResultSchema,
  classifyCandidateInputSchema,
} from "@entellix/contracts/classification";

import { buildClassifierPrompt } from "./classifier-prompt.ts";
import { extractJsonText } from "./model-output.ts";

export { buildClassifierPrompt } from "./classifier-prompt.ts";
export type {
  ClassifierConfig,
  ClassificationResult,
  ClassifyCandidateInput,
  ResolvedEntity,
  ResolveEntityResult,
} from "@entellix/contracts/classification";

/**
 * Classifier suite (S2.2.1). Classifies one candidate along every governance
 * axis in a single workflow: type, owner (binary, with a multi-scope
 * distribution when uncertain), entity links, audience, sensitivity, confidence,
 * and an operation guess. Scope is Entellix's decision, never the host model's —
 * `active_org_id` is a context signal only, never a default owner (Decision 4/5).
 *
 * Model + prompt are injected as versioned CONFIG (never a hardcoded model call).
 * The raw LLM output is Zod-validated against classifierLlmOutputSchema and
 * retried exactly once on invalid; a second failure throws a typed error. Entity
 * resolution, the audience suggestion, the conservative directive downgrade, and
 * the source authority are assembled deterministically AFTER the model returns —
 * the code owns them, not the LLM.
 */

/** The raw LLM call, injected so unit tests use fakes and the model stays config. */
export type ClassifierGenerateFn = (prompt: string) => Promise<string>;

export type ResolveEntityFn = (ownerOrgId: string, name: string) => Promise<ResolveEntityResult>;

/** Membership lookup boundary — the caller's org memberships, for audience context. */
export type ListMembershipsFn = (userId: string) => Promise<OrgMembership[]>;

export interface ClassifierDeps {
  generate: ClassifierGenerateFn;
  config: ClassifierConfig;
  resolveEntityFn: ResolveEntityFn;
  listMembershipsFn: ListMembershipsFn;
}

export interface Classifier {
  /**
   * Executes classify candidate.
   *
   * @param input - Value supplied for `input`.
   * @returns The result produced by `classifyCandidate`.
   * @throws Errors raised by validation or dependent operations.
   */
  classifyCandidate(input: ClassifyCandidateInput): Promise<ClassificationResult>;
}

/** Kinds of failure the classifier raises as a typed, catchable error. */
export const CLASSIFIER_ERROR_KINDS = ["output_invalid"] as const;
export type ClassifierErrorKind = (typeof CLASSIFIER_ERROR_KINDS)[number];

/**
 * Typed classifier failure. Structural (not a class subtype) so it stays within
 * the functional-TS rules: build with `new Error` then tag it. Thrown after the
 * LLM output fails Zod validation twice (initial + one retry). Mirrors the
 * extractor's `createExtractorError` pattern.
 */
export interface ClassifierError extends Error {
  readonly kind: ClassifierErrorKind;
  /** How many generate() attempts were made before giving up (always 2 here). */
  readonly attempts: number;
}

/**
 * Creates classifier error.
 *
 * @param kind - Value supplied for `kind`.
 * @param attempts - Value supplied for `attempts`.
 * @param message - Value supplied for `message`.
 * @returns The result produced by `createClassifierError`.
 * @throws Errors raised by validation or dependent operations.
 */
export function createClassifierError(
  kind: ClassifierErrorKind,
  attempts: number,
  message: string,
): ClassifierError {
  return Object.assign(new Error(message), { kind, attempts } as const);
}

/**
 * Determines whether classifier error.
 *
 * @param value - Value supplied for `value`.
 * @returns The result produced by `isClassifierError`.
 * @throws Errors raised by validation or dependent operations.
 */
export function isClassifierError(value: unknown): value is ClassifierError {
  return (
    value instanceof Error &&
    (CLASSIFIER_ERROR_KINDS as readonly string[]).includes((value as ClassifierError).kind)
  );
}

/** event trust class → the source authority carried onto the memory (Decision 16). */
const SOURCE_AUTHORITY_BY_TRUST: Record<SourceTrustClass, SourceAuthority> = {
  first_party: "explicit",
  external_included: "inferred",
  integration: "integration",
};

/** Explicit standing-rule markers that keep a directive a directive. */
const DIRECTIVE_MARKERS = /\bfrom now on\b|\balways\b|\bnever\b|\bmust\b/i;

/** First-person preference wording that both routes audience and softens a directive. */
const FIRST_PERSON_PREFERENCE =
  /\bi prefer\b|\bi'd rather\b|\bi would rather\b|\bi like\b|\bi want\b|\bmy (preference|preferences|style)\b/i;

/** Explicit scoping to a shared project/client ("for the Acme project", "for this client"). */
const PROJECT_SCOPE_WORDING = /\bfor\b[^.]*\bproject\b|\bfor (the|this|our)\b[^.]*\bclient\b/i;

/** Organization-wide wording ("our company", "company-wide"). */
const ORG_WORDING = /\bour (company|org|organisation|organization|team)\b|\bcompany-wide\b/i;

const AUDIENCE_BASIS_MAX = 280;

/**
 * Conservative, false-positive-averse directive detection (AC). The model may
 * over-call "directive"; we only keep it when an explicit standing-rule marker is
 * present in the candidate text or its evidence span. Otherwise we downgrade —
 * first-person wording lands on `preference`, everything else on `fact`.
 *
 * @param modelType - Value supplied for `modelType`.
 * @param candidate - Value supplied for `candidate`.
 * @returns The result produced by `resolveMemoryType`.
 * @throws Errors raised by validation or dependent operations.
 */
function resolveMemoryType(modelType: MemoryType, candidate: MemoryCandidate): MemoryType {
  if (modelType !== "directive") return modelType;
  const evidence = `${candidate.candidateText}\n${candidate.evidenceSpan}`;
  if (DIRECTIVE_MARKERS.test(evidence)) return "directive";
  return FIRST_PERSON_PREFERENCE.test(candidate.candidateText) ? "preference" : "fact";
}

/** Clamps a heuristic basis string to the contract's max length.
 *
 * @param text - Value supplied for `text`.
 * @returns The result produced by `basis`.
 * @throws Errors raised by validation or dependent operations.
 */
function basis(text: string): string {
  return text.length <= AUDIENCE_BASIS_MAX ? text : text.slice(0, AUDIENCE_BASIS_MAX);
}

/**
 * Audience suggestion from wording heuristics (AC), which may OVERRIDE the
 * model's `audienceHint`: project/client scoping wins, then first-person → owner,
 * then org-wide → org_members; otherwise the model's hint stands. `projectEntityId`
 * is attached only for a project_members suggestion whose project entity resolved.
 *
 * @param candidate - Value supplied for `candidate`.
 * @param modelHint - Value supplied for `modelHint`.
 * @param projectEntityId - Value supplied for `projectEntityId`.
 * @returns The result produced by `suggestAudience`.
 * @throws Errors raised by validation or dependent operations.
 */
function suggestAudience(
  candidate: MemoryCandidate,
  modelHint: AudiencePolicyKind,
  projectEntityId: string | undefined,
): AudienceSuggestion {
  const text = candidate.candidateText;
  if (PROJECT_SCOPE_WORDING.test(text)) {
    const suggestion: AudienceSuggestion = {
      kind: "project_members",
      basis: basis("scoped to a project/client by wording (e.g. 'for the … project')"),
    };
    return projectEntityId ? { ...suggestion, projectEntityId } : suggestion;
  }
  if (FIRST_PERSON_PREFERENCE.test(text)) {
    return {
      kind: "private_to_owner",
      basis: basis("first-person preference wording (e.g. 'I prefer' / \"I'd rather\")"),
    };
  }
  if (ORG_WORDING.test(text)) {
    return {
      kind: "org_members",
      basis: basis("organization-wide wording (e.g. 'our company')"),
    };
  }
  return { kind: modelHint, basis: basis("model audience hint (no overriding wording)") };
}

interface ResolvedMentions {
  entityLinks: EntityLink[];
  entityCreationCandidates: EntityCreationCandidate[];
  /** Registry entities that resolved, kept to derive a project audience target. */
  resolvedEntities: ResolvedEntity[];
}

/**
 * Resolves each free-text entity mention against the registry. A confident lone
 * hit becomes an `entityLink` with the real id; anything unresolved (ambiguous or
 * no match, or no active org to resolve against) stays an `entityCreationCandidate`
 * — never a silent mint (Open Q7).
 *
 * @param output - Value supplied for `output`.
 * @param activeOrgId - Value supplied for `activeOrgId`.
 * @param resolveEntityFn - Value supplied for `resolveEntityFn`.
 * @returns The result produced by `resolveMentions`.
 * @throws Errors raised by validation or dependent operations.
 */
async function resolveMentions(
  output: ClassifierLlmOutput,
  activeOrgId: string | null,
  resolveEntityFn: ResolveEntityFn,
): Promise<ResolvedMentions> {
  const mentions = output.entityMentions;
  const resolutions: ResolveEntityResult[] = activeOrgId
    ? await Promise.all(mentions.map((mention) => resolveEntityFn(activeOrgId, mention.alias)))
    : mentions.map(() => ({ kind: "none" }) as const);

  const entityLinks: EntityLink[] = [];
  const entityCreationCandidates: EntityCreationCandidate[] = [];
  const resolvedEntities: ResolvedEntity[] = [];

  mentions.forEach((mention, index) => {
    const resolution = resolutions[index]!;
    if (resolution.kind === "match") {
      entityLinks.push({
        entityId: resolution.entity.id,
        role: mention.role,
        confidence: output.confidence,
      });
      resolvedEntities.push(resolution.entity);
    } else {
      entityCreationCandidates.push({ alias: mention.alias, suggestedType: mention.suggestedType });
    }
  });

  return { entityLinks, entityCreationCandidates, resolvedEntities };
}

/** Parses + validates a raw model response; null on invalid JSON or shape.
 *
 * @param raw - Value supplied for `raw`.
 * @returns The result produced by `parseLlmOutput`.
 * @throws Errors raised by validation or dependent operations.
 */
function parseLlmOutput(raw: string): ClassifierLlmOutput | null {
  let json: unknown;
  try {
    json = JSON.parse(extractJsonText(raw));
  } catch {
    return null;
  }
  const parsed = classifierLlmOutputSchema.safeParse(json);
  return parsed.success ? parsed.data : null;
}

/**
 * Assembles the governance verdict from the validated model output plus the
 * code-derived axes: resolved entity links / creation candidates, the audience
 * heuristic, the conservative directive downgrade, and the source authority
 * mapped from the event trust class.
 *
 * @param output - Value supplied for `output`.
 * @param input - Value supplied for `input`.
 * @param resolveEntityFn - Value supplied for `resolveEntityFn`.
 * @returns The result produced by `assembleClassification`.
 * @throws Errors raised by validation or dependent operations.
 */
async function assembleClassification(
  output: ClassifierLlmOutput,
  input: ClassifyCandidateInput,
  resolveEntityFn: ResolveEntityFn,
): Promise<Classification> {
  const { candidate, context } = input;
  const { entityLinks, entityCreationCandidates, resolvedEntities } = await resolveMentions(
    output,
    context.activeOrgId,
    resolveEntityFn,
  );
  const projectEntityId = resolvedEntities.find((entity) => entity.type === "project")?.id;

  return {
    memoryType: resolveMemoryType(output.memoryType, candidate),
    owner: output.owner,
    scopeDistribution: output.scopeDistribution,
    entityLinks,
    entityCreationCandidates,
    audienceSuggestion: suggestAudience(candidate, output.audienceHint, projectEntityId),
    sensitivity: output.sensitivity,
    sourceAuthority: SOURCE_AUTHORITY_BY_TRUST[context.sourceTrustClass],
    operationGuess: output.operationGuess,
    confidence: output.confidence,
  };
}

/**
 * Creates classifier.
 *
 * @param deps - Value supplied for `deps`.
 * @returns The result produced by `createClassifier`.
 * @throws Errors raised by validation or dependent operations.
 */
export function createClassifier(deps: ClassifierDeps): Classifier {
  const { generate, resolveEntityFn } = deps;
  const config = classifierConfigSchema.parse(deps.config);

  return {
    /**
     * Executes classify candidate.
     *
     * @param rawInput - Value supplied for `rawInput`.
     * @returns The result produced by `classifyCandidate`.
     * @throws Errors raised by validation or dependent operations.
     */
    async classifyCandidate(rawInput: ClassifyCandidateInput): Promise<ClassificationResult> {
      const input = classifyCandidateInputSchema.parse(rawInput);
      const prompt = buildClassifierPrompt(input.candidate, input.registryAliasHints ?? []);

      let output = parseLlmOutput(await generate(prompt));
      let retried = false;
      if (output === null) {
        // Zod-validate LLM output; retry exactly once on invalid, then give up
        // with a typed error (never a third attempt).
        retried = true;
        output = parseLlmOutput(await generate(prompt));
        if (output === null) {
          throw createClassifierError(
            "output_invalid",
            2,
            "classifier output failed validation twice (initial + one retry)",
          );
        }
      }

      const classification = await assembleClassification(output, input, resolveEntityFn);
      return classificationResultSchema.parse({
        candidate: input.candidate,
        classification,
        model: config.model,
        classifierVersion: config.promptVersion,
        retried,
      });
    },
  };
}
