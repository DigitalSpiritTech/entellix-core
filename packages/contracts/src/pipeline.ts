/**
 * Defines event salience and session-batch lifecycle contracts.
 *
 * Inputs: Imported dependencies and values passed to the module's documented functions.
 * Outputs: Exported types, values, and behavior provided by the module.
 * Errors: Functions document validation, dependency, and runtime errors individually.
 *
 * @packageDocumentation
 */

import { z } from "zod";

/**
 * Pipeline contracts. The salience gate is a cheap triage layer
 * that decides WHEN and HOW URGENTLY an event is processed — never WHETHER it
 * exists. Every event stays reprocessable, so the route vocabulary has no
 * terminal-discard member; inputs remain reprocessable.
 *
 * Convention (repo-wide): `const FOO = [...] as const` → `fooSchema = z.enum(FOO)`
 * → `z.infer`. These arrays are the single source of truth consumed by the
 * salience service, the batching worker, and the DB CHECK constraints the
 * developer adds for the new pipeline tables.
 */

/**
 * The four salience routes. Ordered by urgency, from process-now to defer:
 * - `immediate`   — a lexical hot-trigger fired; extract solo, now.
 * - `batch`       — novel content; queue into its session batch for extraction.
 * - `session_end` — near-duplicate of recent content; revisit at session close.
 * - `hold`        — low-signal chatter; parked, still reprocessable later.
 *
 * There is deliberately NO `discard` route: the gate routes, it never drops.
 */
export const SALIENCE_ROUTES = ["immediate", "batch", "session_end", "hold"] as const;
export const salienceRouteSchema = z.enum(SALIENCE_ROUTES);
export type SalienceRoute = z.infer<typeof salienceRouteSchema>;

/**
 * Categories of lexical hot-trigger that force an event onto the `immediate`
 * route regardless of novelty. The host supplies its versioned phrase-level
 * lexicon.
 * - `negation`          — reversals/cancellations ("no longer", "stopped").
 * - `status_verb`       — state-change verbs ("switched", "approved", "done").
 * - `preference_marker` — first-person preference ("I prefer", "I always").
 * - `directive_marker`  — imperative/binding language ("from now on", "must").
 */
export const HOT_TRIGGER_CATEGORIES = [
  "negation",
  "status_verb",
  "preference_marker",
  "directive_marker",
] as const;
export const hotTriggerCategorySchema = z.enum(HOT_TRIGGER_CATEGORIES);
export type HotTriggerCategory = z.infer<typeof hotTriggerCategorySchema>;

/**
 * Semver of the trigger lexicon. Stamped on every persisted route decision so a
 * later lexicon change is auditable and old decisions remain reproducible.
 */
export const SALIENCE_LEXICON_VERSION = "1.0.0";

/**
 * Session-batch lifecycle states. Defined here so all pipeline
 * vocabularies live in one contract file; the batching worker and its DB CHECK
 * constraint consume this array.
 * - `open`       — accepting events.
 * - `closed`     — sealed by idle-timeout / max-size / manual close, awaiting extraction.
 * - `extracting` — an extractor run is in flight.
 * - `extracted`  — candidates emitted.
 * - `failed`     — extraction errored; reprocessable.
 */
export const BATCH_STATUSES = ["open", "closed", "extracting", "extracted", "failed"] as const;
export const batchStatusSchema = z.enum(BATCH_STATUSES);
export type BatchStatus = z.infer<typeof batchStatusSchema>;

/**
 * Why a session batch was closed. Recorded on the batch for cost and operations
 * analysis of batch boundaries.
 */
export const BATCH_CLOSE_REASONS = ["idle_timeout", "max_size", "manual"] as const;
export const batchCloseReasonSchema = z.enum(BATCH_CLOSE_REASONS);
export type BatchCloseReason = z.infer<typeof batchCloseReasonSchema>;

export const hotTriggerHitSchema = z.object({
  category: hotTriggerCategorySchema,
  phrase: z.string().min(1),
});
export type HotTriggerHit = z.infer<typeof hotTriggerHitSchema>;

export const routeDecisionSchema = z.object({
  route: salienceRouteSchema,
  reason: z.string().min(1),
});
export type RouteDecision = z.infer<typeof routeDecisionSchema>;

export const routeDecisionInputSchema = z.object({
  triggers: z.array(hotTriggerHitSchema),
  noveltyScore: z.number().min(0).max(1).nullable(),
  nearDuplicate: z.boolean(),
});
export type RouteDecisionInput = z.infer<typeof routeDecisionInputSchema>;

export const lexiconCategorySchema = z.object({
  category: hotTriggerCategorySchema,
  phrases: z.array(z.string().min(1)),
});
export type LexiconCategory = z.infer<typeof lexiconCategorySchema>;
