import { CONFLICT_RELATIONS } from "@entellix/contracts/conflicts";
import type { Neighbor } from "@entellix/contracts/conflicts";

import type { ConflictCandidate } from "./conflicts.ts";

/**
 * Provider-neutral conflict-detection prompt — versioned CONFIG, not code.
 * Mirrors classifier-prompt.ts: the prompt text and the model id are the two
 * tunable knobs of the pair classifier. Its version is owned by
 * `@entellix/contracts/conflicts`, making a prompt change an auditable config
 * bump rather than a logic edit.
 *
 * The model sees the candidate text and each nearest-neighbor active memory
 * (with its stable id) and classifies the (candidate, neighbor) relation into
 * one of four values. It NEVER invents neighbor ids — it echoes the ids it was
 * given — and returns strict JSON the detector Zod-validates.
 */

/** The four relations the model may assign. Mirrors `CONFLICT_RELATIONS`. */
const RELATION_LIST = CONFLICT_RELATIONS.join(", ");

const INSTRUCTIONS = `You compare one candidate memory against the caller's existing ACTIVE memories in the same owner/entity neighborhood, and classify how the candidate relates to EACH neighbor.

For every neighbor below, decide the relation from the candidate's point of view:
- supersedes: the candidate is a NEW STATE that replaces the neighbor (e.g. "Acme uses Next.js" supersedes an active "Acme uses Webflow"). A factual change over time.
- contradicts: the candidate disagrees with the neighbor but neither cleanly wins — opposing standing preferences whose durability is unclear (e.g. "Ted prefers detailed answers" vs "Ted prefers concise answers"). These are NOT auto-resolved; they go to review.
- duplicates: the candidate restates the same information the neighbor already holds (merge / no-op).
- coexists: no conflict — both remain valid.

Return ONLY a JSON object of the form:
{ "annotations": [ { "existingMemoryId": "<the neighbor id, echoed exactly>", "relation": one of ${RELATION_LIST}, "confidence": 0..1, "rationale": "<one short sentence, no chain-of-thought>" } ] }

Emit exactly one annotation per neighbor, echoing the neighbor's id verbatim. Return no prose outside the JSON.`;

/** Renders one neighbor line for the prompt: its id + content. */
function renderNeighbor(neighbor: Neighbor): string {
  return `- id ${neighbor.memoryId} (${neighbor.memoryType}): ${neighbor.content}`;
}

/**
 * Builds the conflict-classification prompt for a candidate and its neighbors:
 * the versioned instructions, the candidate text, and the enumerated neighbor
 * memories. Deterministic — the same inputs always yield the same prompt.
 */
export function buildConflictPrompt(candidate: ConflictCandidate, neighbors: Neighbor[]): string {
  return [
    INSTRUCTIONS,
    "",
    `Candidate: ${candidate.text}`,
    "",
    "Existing active neighbors:",
    ...neighbors.map(renderNeighbor),
  ].join("\n");
}
