/**
 * Implements classifier prompt behavior for this TypeScript module.
 *
 * Inputs: Imported dependencies and values passed to the module's documented functions.
 * Outputs: Exported types, values, and behavior provided by the module.
 * Errors: Functions document validation, dependency, and runtime errors individually.
 *
 * @packageDocumentation
 */

import type { MemoryCandidate } from "@entellix/contracts/candidates";
import { ENTITY_TYPES } from "@entellix/contracts";

/**
 * Provider-neutral classifier prompt — versioned CONFIG, not code.
 * text and the model id are the two tunable knobs of the classifier; keeping the
 * prompt here (behind {@link CLASSIFIER_PROMPT_VERSION}, re-exported from
 * `@entellix/contracts/classification`) means a prompt change is an auditable
 * config bump, not a logic edit. `buildClassifierPrompt` inlines the candidate
 * text, its verbatim evidence span, and any registry alias hints, and asks for a
 * strict-JSON classification the classifier Zod-validates.
 *
 * The model judges only the axes it can read from text (type, owner, scope
 * distribution, entity *mentions* as free-text aliases, sensitivity, operation
 * guess). It NEVER emits resolved entity ids, an audience policy, or a source
 * authority — those are assembled deterministically in code after it returns.
 */

export { CLASSIFIER_PROMPT_VERSION } from "@entellix/contracts/classification";

/** The 9-type taxonomy the classifier may assign. Mirrors `MEMORY_TYPES`. */
const MEMORY_TYPE_LIST =
  "fact, preference, directive, decision, task_state, procedure, episodic_event, observation, policy";

/** The audience kinds the model may hint. Mirrors `AUDIENCE_POLICY_KINDS`. */
const AUDIENCE_KIND_LIST =
  "private_to_owner, org_members, org_admins, project_members, explicit_users, system_only";

/** The reconciler operation verbs the model may guess. Mirrors `OPERATION_GUESSES`. */
const OPERATION_LIST = "ADD, UPDATE, SUPERSEDE, MERGE, SPLIT, EXPIRE, NOOP, REVIEW";

/** The entity registry types the model may suggest. Mirrors `ENTITY_TYPES`. */
const ENTITY_TYPE_LIST = ENTITY_TYPES.join(", ");

const INSTRUCTIONS = `You classify one candidate memory along every governance axis for a memory engine.

Scope is the engine's decision, never the host model's: the active org is context only — NEVER default the owner to it.

For the candidate below, return a classification with:
- memoryType: one of ${MEMORY_TYPE_LIST}. Be conservative about "directive": only call something a directive when it is an explicit standing rule (markers like "from now on", "always", "never", "must").
- owner: { value: "user" or "org", confidence: 0..1 } — binary owner with your confidence.
- scopeDistribution: array of { owner, confidence }. Emit a single entry when confident; when the owner is ambiguous, emit BOTH "user" and "org" with confidences that roughly sum to 1 (a distribution, not a point guess).
- entityMentions: array of { alias, suggestedType, role } for every entity the memory is about or mentions. Use the raw alias text; do NOT invent ids. suggestedType must be one of ${ENTITY_TYPE_LIST}; do not use types outside this list. role is e.g. "subject", "mentions", "owner".
- audienceHint: one of ${AUDIENCE_KIND_LIST} — your best guess at who should see this.
- sensitivity: { level: "normal" | "sensitive" | "secret", aboutAnotherPerson: boolean }.
- operationGuess: one of ${OPERATION_LIST} — advisory; conflict detection and the policy matrix refine it.
- confidence: 0..1 overall.

Return ONLY a JSON object with exactly those keys. Return no prose outside the JSON.`;

/** Renders the registry alias hints block, or a neutral note when there are none.
 *
 * @param aliasHints - Value supplied for `aliasHints`.
 * @returns The result produced by `renderAliasHints`.
 * @throws Errors raised by validation or dependent operations.
 */
function renderAliasHints(aliasHints: string[]): string {
  if (aliasHints.length === 0) return "Known registry aliases: (none supplied)";
  return `Known registry aliases (prefer these when they fit): ${aliasHints.join(", ")}`;
}

/**
 * Builds the classifier prompt for a candidate: the versioned instructions, the
 * registry alias context, and the candidate's text + verbatim evidence span.
 * Deterministic — the same inputs always yield the same prompt.
 *
 * @param candidate - Value supplied for `candidate`.
 * @param aliasHints - Value supplied for `aliasHints`.
 * @returns The result produced by `buildClassifierPrompt`.
 * @throws Errors raised by validation or dependent operations.
 */
export function buildClassifierPrompt(
  candidate: MemoryCandidate,
  aliasHints: string[] = [],
): string {
  return [
    INSTRUCTIONS,
    "",
    renderAliasHints(aliasHints),
    "",
    `Candidate: ${candidate.candidateText}`,
    `Evidence span (verbatim source): ${candidate.evidenceSpan}`,
    `Provisional type from extraction: ${candidate.provisionalType}`,
  ].join("\n");
}
