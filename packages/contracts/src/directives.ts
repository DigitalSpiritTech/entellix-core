/**
 * Implements directives behavior for this TypeScript module.
 *
 * Inputs: Imported dependencies and values passed to the module's documented functions.
 * Outputs: Exported types, values, and behavior provided by the module.
 * Errors: Functions document validation, dependency, and runtime errors individually.
 *
 * @packageDocumentation
 */

import { z } from "zod";

import { sourceTrustClassSchema } from "./events.ts";
import { memoryTypeSchema, renderPolicySchema } from "./memory-v2.ts";

/**
 * Directive-core contracts (S2.3.2). Directives (memory_type=directive) are the
 * VERBATIM type: their content is stored and rendered byte-for-byte, they are
 * always pinned into the context packet, and they may be created only from a
 * first-person explicit statement (first_party trust) or the review UI — never
 * silently from ambient/external content (Decisions 10, 12, 18; PRD §9).
 *
 * This module is the single source of truth for two shapes the directive engine
 * (`@entellix/core/directives`) produces:
 *   - `DirectivePacketBlock` — the pinned directive block composed into a context
 *     packet, with a line cap and a ranked overflow list.
 *   - `DirectiveCreationContext` — the inputs the creation gate reads to decide
 *     whether a directive may be created without review.
 *
 * Convention mirrors the rest of contracts: `const FOO = [...] as const` →
 * `fooSchema = z.enum(FOO)` → `z.infer`. Imported via the
 * `@entellix/contracts/directives` subpath (not the package barrel), like the
 * sibling pipeline contracts (`./candidates.ts`, `./classification.ts`).
 */

/**
 * Default packet cap: the maximum number of directive CONTENT LINES pinned into
 * one packet (PRD §9). Counted across all pinned directives — a single
 * multi-line directive consumes as many lines as it has. Directives beyond the
 * cap are ranked out into `overflow` (listed by title) with a fetch hint.
 */
export const DIRECTIVE_PACKET_CAP_DEFAULT = 15;

/**
 * One pinned directive in the packet block. `content` is the VERBATIM directive
 * text — byte-for-byte as stored, never canonicalized (the verbatim carve-out,
 * Decision 10). `precedenceRank` is the resolved precedence order (lower = wins;
 * from the precedence engine S2.3.3) used to decide what overflows when the cap
 * is hit. `overrideAnnotation` is the rendered override note when a more-specific
 * directive overrides a broader one ("Project Acme requires Next.js — overrides
 * the org rule for this project").
 */
export const directivePacketPinnedEntrySchema = z.object({
  memoryId: z.uuid(),
  content: z.string().min(1),
  precedenceRank: z.number().int().nonnegative().optional(),
  overrideAnnotation: z.string().min(1).optional(),
});
export type DirectivePacketPinnedEntry = z.infer<typeof directivePacketPinnedEntrySchema>;

/**
 * One overflowed directive: not pinned this packet (cap exceeded), listed by
 * `title` so the reader knows it exists and can fetch it (via `fetchHint`).
 */
export const directivePacketOverflowEntrySchema = z.object({
  memoryId: z.uuid(),
  title: z.string().min(1),
});
export type DirectivePacketOverflowEntry = z.infer<typeof directivePacketOverflowEntrySchema>;

/**
 * The composed directive block for a context packet. `pinned` holds the verbatim
 * directives up to the line cap (ranked in); `overflow` lists the rest by title.
 * `fetchHint` is guidance for retrieving the overflowed directives — a NON-EMPTY
 * string when `overflow` is non-empty, and the EMPTY string `''` when nothing
 * overflowed (documented "no fetch hint" state, so the field is always a string
 * for a stable shape).
 */
export const directivePacketBlockSchema = z.object({
  pinned: z.array(directivePacketPinnedEntrySchema),
  overflow: z.array(directivePacketOverflowEntrySchema),
  fetchHint: z.string(),
});
export type DirectivePacketBlock = z.infer<typeof directivePacketBlockSchema>;

/**
 * How a directive-creation is being attempted:
 * - `pipeline`  — the automatic capture pipeline proposed it (subject to the
 *   creation gate AND the policy matrix).
 * - `review_ui` — a human is creating/approving it in the review UI (the trusted
 *   creation path; always allowed to become a directive).
 */
export const DIRECTIVE_CREATION_VIAS = ["pipeline", "review_ui"] as const;
export const directiveCreationViaSchema = z.enum(DIRECTIVE_CREATION_VIAS);
export type DirectiveCreationVia = z.infer<typeof directiveCreationViaSchema>;

/**
 * Inputs the directive-creation gate reads (S2.3.2). `sourceTrustClass` is
 * carried from the source event; `isFirstPersonExplicit` is the classifier's
 * signal that the statement is a first-person explicit standing rule ("from now
 * on I always …"), NOT ambient/observed content. Only `review_ui`, or
 * `pipeline` + `first_party` + `isFirstPersonExplicit`, may create a directive
 * without being forced to review.
 */
export const directiveCreationContextSchema = z.object({
  via: directiveCreationViaSchema,
  sourceTrustClass: sourceTrustClassSchema,
  isFirstPersonExplicit: z.boolean(),
});
export type DirectiveCreationContext = z.infer<typeof directiveCreationContextSchema>;

export const directivePacketDirectiveInputSchema = z.object({
  memoryId: z.uuid(),
  content: z.string().min(1),
  precedenceRank: z.number().int().nonnegative(),
  overrideAnnotation: z.string().optional(),
  title: z.string().min(1),
});
export type DirectivePacketDirectiveInput = z.infer<typeof directivePacketDirectiveInputSchema>;

export const buildDirectivePacketBlockInputSchema = z.object({
  directives: z.array(directivePacketDirectiveInputSchema),
  cap: z.number().int().positive().optional(),
});
export type BuildDirectivePacketBlockInput = z.infer<typeof buildDirectivePacketBlockInputSchema>;

export const directiveRowInvariantInputSchema = z.object({
  memoryType: memoryTypeSchema,
  contentVerbatim: z.boolean(),
  renderPolicy: renderPolicySchema,
});
export type DirectiveRowInvariantInput = z.infer<typeof directiveRowInvariantInputSchema>;

/**
 * The gate's verdict. `allowed` — the directive may be created on this path
 * without review. `forcedReview` — the directive candidate is routed to review
 * instead of silently created (NEVER silently dropped, NEVER silently
 * auto-committed). `reason` is a short human-facing explanation (no
 * chain-of-thought). Exactly one of `allowed`/`forcedReview` is true.
 */
export const canCreateDirectiveResultSchema = z.object({
  allowed: z.boolean(),
  forcedReview: z.boolean(),
  reason: z.string().min(1),
});
export type CanCreateDirectiveResult = z.infer<typeof canCreateDirectiveResultSchema>;
