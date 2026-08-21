/**
 * Routes intake events by urgency using a versioned lexical salience gate.
 *
 * Inputs: Imported dependencies and values passed to the module's documented functions.
 * Outputs: Exported types, values, and behavior provided by the module.
 * Errors: Functions document validation, dependency, and runtime errors individually.
 *
 * @packageDocumentation
 */

import {
  type HotTriggerHit,
  type LexiconCategory,
  type RouteDecision,
  type RouteDecisionInput,
  SALIENCE_LEXICON_VERSION,
  routeDecisionInputSchema,
  routeDecisionSchema,
} from "@entellix/contracts/pipeline";

export type {
  HotTriggerHit,
  LexiconCategory,
  RouteDecision,
  RouteDecisionInput,
} from "@entellix/contracts/pipeline";

/**
 * Salience gate. Cheap triage that decides when and how urgently an event
 * is processed, never WHETHER it exists. Pure detection + routing here; the
 * a host adapter persists the decision without mutating the source event.
 *
 * The lexicon and type surface are the versioned interface. Extend
 * the trigger lexicon by adding phrases and bumping SALIENCE_LEXICON_VERSION.
 */

/**
 * SALIENCE_TRIGGER_LEXICON — the documented, versioned hot-trigger lexicon
 * The trigger lexicon is documented and versioned. Version is
 * SALIENCE_LEXICON_VERSION. `detectHotTriggers` matches these phrases
 * case-insensitively on word boundaries. Extend by adding phrases and bumping
 * the lexicon version.
 *
 * Note the intentional overlap: "always"/"never" are directive markers on their
 * own but preference markers when first-person-prefixed ("i always"/"i never").
 * The detector must prefer the more specific first-person match.
 */
export const SALIENCE_TRIGGER_LEXICON: LexiconCategory[] = [
  {
    category: "negation",
    phrases: ["no longer", "not anymore", "anymore", "no more", "stopped", "instead of"],
  },
  {
    category: "status_verb",
    phrases: ["switched", "blocked", "unblocked", "approved", "done"],
  },
  {
    category: "preference_marker",
    phrases: ["i prefer", "i always", "i never", "i like", "i don't"],
  },
  {
    category: "directive_marker",
    phrases: ["from now on", "always", "never", "must"],
  },
];

/** Frozen so the shared lexicon cannot be mutated by a consumer at runtime. */
export const SALIENCE_LEXICON = {
  version: SALIENCE_LEXICON_VERSION,
  categories: SALIENCE_TRIGGER_LEXICON,
} as const;

/** Escapes a lexicon phrase so it can be embedded in a RegExp source safely.
 *
 * @param phrase - Value supplied for `phrase`.
 * @returns The result produced by `escapeForRegExp`.
 * @throws Errors raised by validation or dependent operations.
 */
function escapeForRegExp(phrase: string): string {
  return phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** A phrase match with its char span, used for first-person overlap resolution. */
interface SpannedHit extends HotTriggerHit {
  start: number;
  end: number;
}

/**
 * Detect lexical hot-triggers in event text. Pure; case-insensitive; matches on
 * word boundaries so "approved" does not fire inside "unapproved-lookalike".
 * Plain chatter with no trigger phrase returns an empty array.
 *
 * First-person preference wins over the bare directive marker it contains: an
 * "always"/"never" match that sits entirely inside an "i always"/"i never"
 * preference match is dropped, so "I always run the linter" is a
 * `preference_marker`, not a `directive_marker`.
 *
 * @param text - Value supplied for `text`.
 * @returns The result produced by `detectHotTriggers`.
 * @throws Errors raised by validation or dependent operations.
 */
export function detectHotTriggers(text: string): HotTriggerHit[] {
  const haystack = text.toLowerCase();
  const matches: SpannedHit[] = [];
  for (const { category, phrases } of SALIENCE_TRIGGER_LEXICON) {
    for (const phrase of phrases) {
      const pattern = new RegExp(`\\b${escapeForRegExp(phrase)}\\b`, "g");
      for (let hit = pattern.exec(haystack); hit !== null; hit = pattern.exec(haystack)) {
        matches.push({ category, phrase, start: hit.index, end: hit.index + phrase.length });
      }
    }
  }

  const preferenceSpans = matches.filter((match) => match.category === "preference_marker");
  return matches
    .filter((match) => {
      if (match.category !== "directive_marker") return true;
      const coveredByPreference = preferenceSpans.some(
        (span) => span.start <= match.start && match.end <= span.end,
      );
      return !coveredByPreference;
    })
    .map(({ category, phrase }) => ({ category, phrase }));
}

/**
 * Novelty at or above this threshold routes trigger-free content to `batch`;
 * below it (and not a near-duplicate) the content is parked on `hold`.
 */
const NOVELTY_BATCH_THRESHOLD = 0.5;

/**
 * Decide the salience route from detected triggers + novelty signals. Pure.
 * Contract the specs pin:
 * - any trigger present → `immediate` (regardless of novelty);
 * - no trigger + near-duplicate → `session_end`;
 * - no trigger + novel content → `batch`;
 * - no trigger + low novelty, not a duplicate → `hold`.
 * The `reason` names the deciding trigger category or novelty basis.
 *
 * @param input - Trigger and novelty signals used to select a route.
 * @returns The result produced by `decideRoute`.
 * @throws Errors raised by validation or dependent operations.
 */
export function decideRoute(input: RouteDecisionInput): RouteDecision {
  const { triggers, noveltyScore, nearDuplicate } = input;
  routeDecisionInputSchema.parse({ triggers, noveltyScore, nearDuplicate });
  const [lead] = triggers;
  if (lead) {
    return routeDecisionSchema.parse({
      route: "immediate",
      reason: `hot-trigger: ${lead.category} ("${lead.phrase}")`,
    });
  }
  if (nearDuplicate) {
    return routeDecisionSchema.parse({
      route: "session_end",
      reason: "near-duplicate of recent content → session_end",
    });
  }
  if (noveltyScore !== null && noveltyScore >= NOVELTY_BATCH_THRESHOLD) {
    return routeDecisionSchema.parse({
      route: "batch",
      reason: `novel content (novelty ${noveltyScore.toFixed(2)}) → batch`,
    });
  }
  return routeDecisionSchema.parse({ route: "hold", reason: "low-signal chatter → hold" });
}
