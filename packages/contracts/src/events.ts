/**
 * Defines append-only intake events and session-batch association contracts.
 *
 * Inputs: Imported dependencies and values passed to the module's documented functions.
 * Outputs: Exported types, values, and behavior provided by the module.
 * Errors: Functions document validation, dependency, and runtime errors individually.
 *
 * @packageDocumentation
 */

import { z } from "zod";

/**
 * Event intake contracts. The `log_context` path is recall-adjacent
 * capture: a client hands the Brain a raw slice of the current work; extraction
 * runs server-side and asynchronously. NOTHING here writes a memory — the ack
 * copy (`LOG_CONTEXT_ACK_MESSAGE`) is deliberately neutral so clients never
 * report a save that has not happened.
 */

export const SOURCE_TRUST_CLASSES = ["first_party", "external_included", "integration"] as const;
export const sourceTrustClassSchema = z.enum(SOURCE_TRUST_CLASSES);
export type SourceTrustClass = z.infer<typeof sourceTrustClassSchema>;

export const EVENT_SOURCE_TYPES = ["mcp", "rest", "backfill", "hook", "webhook"] as const;
export const eventSourceTypeSchema = z.enum(EVENT_SOURCE_TYPES);
export type EventSourceType = z.infer<typeof eventSourceTypeSchema>;

/**
 * Exact acknowledgement returned by the log_context path. It legitimately
 * contains the word "saved" inside the disclaimer "nothing has been saved as
 * memory yet"; what it must never do is claim a count of persisted memories.
 */
export const LOG_CONTEXT_ACK_MESSAGE =
  "Queued for memory analysis. Extraction runs server-side; nothing has been saved as memory yet.";

export const logContextInputSchema = z.object({
  rawEvent: z.string().trim().min(1).max(32000),
  sourceContext: z.string().max(2000).optional(),
  activeOrgId: z.uuid().optional(),
  entityHints: z.array(z.string()).max(25).optional(),
  // Optional client-supplied dedupe scope: paired with the actor, event_type,
  // and content hash in memory_events_idempotency_uq so a re-sent turn collapses
  // to one row. Omitted by most log_context callers (they dedupe on hash alone).
  sessionId: z.string().optional(),
  messageId: z.string().optional(),
});
export type LogContextInput = z.input<typeof logContextInputSchema>;

export const logContextOutputSchema = z.object({
  status: z.literal("queued"),
  eventId: z.uuid(),
  deduped: z.boolean(),
  message: z.string(),
});
export type LogContextOutput = z.infer<typeof logContextOutputSchema>;

/**
 * Service-level intake shape: the client-facing log_context fields plus the
 * source metadata the gateway/service attaches (source type, session/thread
 * identifiers, raw payload, trust class). `sourceType` is required — callers
 * name their channel explicitly (the REST route forces 'rest').
 */
export const recordEventInputSchema = logContextInputSchema.extend({
  sourceType: eventSourceTypeSchema,
  sourceClient: z.string().nullable().default(null),
  threadId: z.string().optional(),
  eventType: z.string().optional(),
  rawJson: z.unknown().optional(),
  sourceTrustClass: sourceTrustClassSchema.default("first_party"),
  sensitivityGuess: z.string().nullable().default(null),
});
export type RecordEventInput = z.input<typeof recordEventInputSchema>;
