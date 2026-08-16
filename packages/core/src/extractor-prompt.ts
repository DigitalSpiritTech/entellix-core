import type { ExtractorEvent } from "./extractor.ts";

/**
 * Extractor prompt — versioned CONFIG, not code (S2.1.3, ADR 0019). The prompt
 * text and the model id are the two tunable knobs of the extractor; keeping the
 * prompt here (behind {@link EXTRACTOR_PROMPT_VERSION}, re-exported from
 * `@entellix/contracts/candidates`) means a prompt change is an auditable config
 * bump, not a logic edit. `buildExtractorPrompt` inlines every batch event's raw
 * text and instructs the model to emit 0..N candidates with verbatim evidence
 * spans as strict JSON.
 */

export { EXTRACTOR_PROMPT_VERSION } from "@entellix/contracts/candidates";

/**
 * The 9-type taxonomy the extractor may tag a candidate with. Mirrors
 * `MEMORY_TYPES` in contracts; listed inline so the prompt stays a self-contained
 * config string.
 */
const PROVISIONAL_TYPES =
  "fact, preference, directive, decision, task_state, procedure, episodic_event, observation, policy";

const INSTRUCTIONS = `You split a session's raw context into discrete candidate memories for a memory engine.

Rules:
- Emit 0..N candidates. Split mixed statements into separate candidates (e.g. a client fact AND a personal preference become two candidates).
- If nothing is worth remembering (small talk, or the user says not to remember something), return an empty candidates array.
- For each candidate provide:
  - candidateText: the memory as a short standalone statement.
  - provisionalType: one of ${PROVISIONAL_TYPES}.
  - evidenceSpan: a VERBATIM excerpt of the source text below that supports this candidate. Copy it exactly, character for character.
  - reasonSummary: one short user-facing sentence on why this is worth remembering. No chain-of-thought.
- For directive-type candidates (hard rules / standing instructions), candidateText MUST be the verbatim rule text — do not paraphrase or normalize it.

Return ONLY a JSON object of the form: {"candidates": [{"candidateText": "...", "provisionalType": "...", "evidenceSpan": "...", "reasonSummary": "..."}]}
Return no prose outside the JSON.`;

/** Renders the source-text block: every batch event's raw text, in order. */
function renderSourceText(events: ExtractorEvent[]): string {
  return events.map((event, index) => `[${index + 1}] ${event.rawText ?? ""}`).join("\n");
}

/**
 * Builds the extractor prompt for a batch: the versioned instructions plus every
 * event's raw text. Deterministic — the same batch always yields the same prompt.
 */
export function buildExtractorPrompt(events: ExtractorEvent[]): string {
  return `${INSTRUCTIONS}\n\nSource text:\n${renderSourceText(events)}`;
}
