/**
 * Defines directive precedence inputs, resolutions, and override annotations.
 *
 * Inputs: Imported dependencies and values passed to the module's documented functions.
 * Outputs: Exported types, values, and behavior provided by the module.
 * Errors: Functions document validation, dependency, and runtime errors individually.
 *
 * @packageDocumentation
 */

import { z } from "zod";

import { entityTypeSchema } from "./entities.ts";
import { ownerScopeTypeSchema, sourceAuthoritySchema } from "./memory-v2.ts";

/**
 * Directive precedence contracts. When a context packet is composed,
 * the caller's ACTIVE, in-scope directives are resolved against one another so
 * the most specific rule wins within the entity context it governs, with a
 * visible override annotation, and genuinely unresolvable conflicts are rendered
 * as-is and logged for review.
 *
 * This module is pure contract: constants, Zod schemas, and their inferred
 * types. The resolver and renderer live in `@entellix/core`. Convention mirrors
 * the rest of contracts (`const FOO = [...] as const` →
 * `fooSchema = z.enum(FOO)` → `z.infer`); imported via the
 * `@entellix/contracts/directive-precedence` subpath.
 */

const isoDatetimeSchema = z.iso.datetime({ offset: true });

/**
 * Specificity tiers, ordered MOST specific first — the array index IS the rank,
 * so a lower number wins a direct conflict.
 *
 * For subject-entity specificity: task > project > client > org_general. A
 * task-scoped rule is the tightest ("on THIS task"), a project rule governs a
 * whole project, a client rule a whole client, and `org_general` is the org-wide
 * default with no subject entity.
 *
 * `user_general` (the user's own interaction-style rules: "always give me the
 * TLDR first") sits LAST by number on purpose. Semantic pinned here: it governs
 * the user's interaction style EVERYWHERE and normally does NOT compete with
 * entity-scoped rules (different topics → both stay active). Only on a DIRECT
 * topic conflict does the number matter, and then any entity-scoped rule (more
 * specific) wins over the user-general rule within that entity's context.
 */
export const SPECIFICITY_RANKS = [
  "task",
  "project",
  "client",
  "org_general",
  "user_general",
] as const;
export const specificityRankSchema = z.enum(SPECIFICITY_RANKS);
export type SpecificityRank = z.infer<typeof specificityRankSchema>;

/**
 * Channel the directive block is being rendered for. `packet`/`file` render
 * directive content VERBATIM; `hook_injection` wraps the same verbatim bytes in
 * declarative framing (never imperative paraphrase) at the boundary (Decision
 * 12).
 */
export const PRECEDENCE_CHANNELS = ["packet", "file", "hook_injection"] as const;
export const precedenceChannelSchema = z.enum(PRECEDENCE_CHANNELS);
export type PrecedenceChannel = z.infer<typeof precedenceChannelSchema>;

/**
 * The context envelope a packet is composed under: who is asking, the active
 * org (context, never ownership), the entity ids the current work is about
 * (used to score subject specificity, with ancestor expansion applied by the
 * resolver), and the render channel.
 */
export const precedenceContextSchema = z.object({
  actorUserId: z.uuid(),
  activeOrgId: z.uuid().nullable(),
  activeEntityIds: z.array(z.uuid()),
  channel: precedenceChannelSchema,
});
export type PrecedenceContext = z.infer<typeof precedenceContextSchema>;

/**
 * One ACTIVE directive as fed to the resolver. `content` is the verbatim rule
 * text (never mutated). `title` is the short human label used to compose the
 * override annotation ("Project Acme requires Next.js — overrides ..."), so it
 * reads as a rule descriptor. `subjectEntityId`/`subjectEntityType` classify the
 * subject tier; `ownerScopeType` distinguishes org-general from user-general
 * when there is no subject entity. `audienceAllowed` is the caller's precomputed
 * audience decision (a directive the caller may not see is filtered before it
 * can compete, regardless of rank).
 */
export const precedenceDirectiveSchema = z.object({
  memoryId: z.uuid(),
  content: z.string().min(1),
  title: z.string().min(1),
  subjectEntityId: z.uuid().nullable(),
  subjectEntityType: entityTypeSchema.nullable(),
  ownerScopeType: ownerScopeTypeSchema,
  sourceAuthority: sourceAuthoritySchema,
  validFrom: isoDatetimeSchema,
  audienceAllowed: z.boolean(),
});
export type PrecedenceDirective = z.infer<typeof precedenceDirectiveSchema>;

/**
 * How a detected direct conflict was settled. `more_specific_won`: specificity
 * broke the tie (the loser is excluded within that entity context, the winner
 * carries an override annotation). `tie_source_authority`: same specificity, the
 * explicit-authority rule beat the inferred one. `tie_recency`: same specificity
 * AND authority, the later `validFrom` won. `unresolved`: still tied on all
 * three (or the semantic check says both genuinely stand) → BOTH render and a
 * review-log entry is emitted. Surface, do not arbitrate.
 */
export const CONFLICT_RESOLUTIONS = [
  "more_specific_won",
  "tie_source_authority",
  "tie_recency",
  "unresolved",
] as const;
export const conflictResolutionSchema = z.enum(CONFLICT_RESOLUTIONS);
export type ConflictResolutionKind = z.infer<typeof conflictResolutionSchema>;

/**
 * A directive that survives resolution and renders into the packet. `rank` is
 * its resolved specificity rank number (index into SPECIFICITY_RANKS).
 * `overrideAnnotation` is non-null ONLY when this directive won a specificity
 * override — it is a SEPARATE annotation string, never merged into `content`.
 */
export const activeDirectiveSchema = z.object({
  memoryId: z.uuid(),
  content: z.string().min(1),
  rank: z.number().int().min(0),
  overrideAnnotation: z.string().nullable(),
});
export type ActiveDirective = z.infer<typeof activeDirectiveSchema>;

/**
 * A conflict the resolver detected between two directives and how it settled it.
 * `memoryIds` is the ordered [winner, loser] pair for decided conflicts, and the
 * two co-standing ids for `unresolved`.
 */
export const precedenceConflictSchema = z.object({
  memoryIds: z.tuple([z.uuid(), z.uuid()]),
  resolution: conflictResolutionSchema,
  note: z.string(),
});
export type PrecedenceConflict = z.infer<typeof precedenceConflictSchema>;

/**
 * A packet-composition-time conflict escalation. Only UNRESOLVED conflicts
 * produce one (decided conflicts need no human). Persisted by
 * persistPacketConflicts as a `memory_reviews` row (decision 'pending', note
 * prefixed 'directive_conflict:').
 */
export const reviewLogEntrySchema = z.object({
  kind: z.literal("directive_conflict"),
  memoryIds: z.array(z.uuid()),
  note: z.string(),
});
export type ReviewLogEntry = z.infer<typeof reviewLogEntrySchema>;

/**
 * The full output of resolveDirectives: the ranked ACTIVE directives to render,
 * every conflict detected (decided or not), and the review-log entries for the
 * unresolved ones.
 */
export const resolutionSchema = z.object({
  active: z.array(activeDirectiveSchema),
  conflicts: z.array(precedenceConflictSchema),
  reviewLogEntries: z.array(reviewLogEntrySchema),
});
export type Resolution = z.infer<typeof resolutionSchema>;

export const entityContextSchema = z.object({
  activeIds: z.array(z.uuid()),
  ancestorsById: z.record(z.uuid(), z.array(z.uuid())),
});
export type EntityContext = z.infer<typeof entityContextSchema>;

/** Data portion of directive resolution; the semantic check remains an injected port. */
export const resolveDirectivesDataSchema = z.object({
  directives: z.array(precedenceDirectiveSchema),
  context: precedenceContextSchema,
  entityContext: entityContextSchema.optional(),
});
export type ResolveDirectivesData = z.infer<typeof resolveDirectivesDataSchema>;

export const renderDirectiveBlockInputSchema = z.object({
  resolution: resolutionSchema,
  channel: precedenceChannelSchema,
});
export type RenderDirectiveBlockInput = z.infer<typeof renderDirectiveBlockInputSchema>;
