/**
 * Enforces directive creation rules and composes pinned directive blocks.
 *
 * Inputs: Imported dependencies and values passed to the module's documented functions.
 * Outputs: Exported types, values, and behavior provided by the module.
 * Errors: Functions document validation, dependency, and runtime errors individually.
 *
 * @packageDocumentation
 */

import type {
  BuildDirectivePacketBlockInput,
  CanCreateDirectiveResult,
  DirectiveCreationContext,
  DirectivePacketBlock,
  DirectiveRowInvariantInput,
} from "@entellix/contracts/directives";
import {
  DIRECTIVE_PACKET_CAP_DEFAULT,
  buildDirectivePacketBlockInputSchema,
  directiveRowInvariantInputSchema,
} from "@entellix/contracts/directives";
import { TYPE_DERIVED_POLICIES } from "@entellix/contracts/reconciler";

export type {
  BuildDirectivePacketBlockInput,
  DirectivePacketDirectiveInput,
  DirectiveRowInvariantInput,
} from "@entellix/contracts/directives";

/**
 * Directive-type core. The pure directive engine provides the creation gate,
 * the packet-block composer (line cap + ranked overflow), and the row-invariant
 * assertion that keeps directive and policy rows verbatim and pinned. The core
 * directive specifications pin these pure rules. Host persistence adapters can
 * enforce the matching database constraint named below.
 *
 * Nothing here mutates directive content. The verbatim rule is upheld end-to-end
 * by the reconciler's `assertDirectiveByteEquality` plus these guards.
 */

/**
 * Name reserved for a database CHECK constraint that host adapters can use to
 * enforce the row invariant in PostgreSQL. The code half is
 * `assertDirectiveRowInvariant`.
 * Documented here so the migration and the code stay in lockstep:
 *
 *   ALTER TABLE memories ADD CONSTRAINT memories_verbatim_type_shape_check
 *   CHECK (
 *     memory_type NOT IN ('directive','policy')
 *     OR (content_verbatim IS NOT NULL AND render_policy = 'pinned')
 *   );
 *
 * i.e. a directive/policy row MUST carry byte-verbatim content and render_policy
 * 'pinned' (mirrors TYPE_DERIVED_POLICIES for the verbatim types). `content_verbatim`
 * is the TEXT column that HOLDS those bytes (not a boolean), so at the DB layer
 * "is verbatim" is `content_verbatim IS NOT NULL` — its presence is the storage
 * of the derived contentVerbatim=true state. (The code half,
 * `assertDirectiveRowInvariant`, works over the derived boolean.)
 */
export const EXPECTED_DIRECTIVE_ROW_CONSTRAINT = "memories_verbatim_type_shape_check";

/**
 * Pure creation gate with no I/O:
 *   - `via: 'review_ui'` → allowed (the trusted human creation path).
 *   - `via: 'pipeline'` + `first_party` + `isFirstPersonExplicit` → allowed
 *     (the automatic path is still subject to the policy matrix downstream).
 *   - anything else on the pipeline path (external/integration trust, or not a
 *     first-person explicit statement) → forcedReview:true, NEVER silently
 *     allowed and NEVER silently dropped.
 * Exactly one of `allowed`/`forcedReview` is true.
 *
 * @param ctx - Value supplied for `ctx`.
 * @returns The result produced by `canCreateDirective`.
 * @throws Errors raised by validation or dependent operations.
 */
export function canCreateDirective(ctx: DirectiveCreationContext): CanCreateDirectiveResult {
  // Trusted human path: a directive created/approved in the review UI is always
  // allowed regardless of source trust or explicit-marker signal.
  if (ctx.via === "review_ui") {
    return { allowed: true, forcedReview: false, reason: "created via the review UI" };
  }

  // Pipeline path: only a first-party, first-person explicit standing rule may be
  // created without review. Everything else (external/integration trust, or a
  // first-party but non-first-person/ambient statement) is forced to review —
  // never silently created and never silently dropped.
  if (ctx.sourceTrustClass === "first_party" && ctx.isFirstPersonExplicit) {
    return {
      allowed: true,
      forcedReview: false,
      reason: "first-party first-person explicit directive",
    };
  }

  const reason =
    ctx.sourceTrustClass !== "first_party"
      ? `directive proposed by ${ctx.sourceTrustClass} content — forced to review`
      : "first-party but not a first-person explicit statement — forced to review";
  return { allowed: false, forcedReview: true, reason };
}

/**
 * Compose the pinned directive block for a packet. Pure behavior:
 *   - directives are considered in ascending `precedenceRank` (best first);
 *   - pinned VERBATIM (content byte-for-byte) until the TOTAL CONTENT-LINE count
 *     across pinned directives would exceed `cap` (default 15) — a multi-line
 *     directive counts as many lines as it has;
 *   - directives that do not fit go to `overflow`, listed by `title`;
 *   - `fetchHint` is a non-empty guidance string when `overflow` is non-empty,
 *     and `''` when nothing overflowed.
 *
 * @param rawInput - Value supplied for `rawInput`.
 * @returns The result produced by `buildDirectivePacketBlock`.
 * @throws Errors raised by validation or dependent operations.
 */
export function buildDirectivePacketBlock(
  rawInput: BuildDirectivePacketBlockInput,
): DirectivePacketBlock {
  const input = buildDirectivePacketBlockInputSchema.parse(rawInput);
  const cap = input.cap ?? DIRECTIVE_PACKET_CAP_DEFAULT;

  // Best precedence first (lower rank wins). Stable across the input order.
  const ordered = input.directives.toSorted((a, b) => a.precedenceRank - b.precedenceRank);

  const pinned: DirectivePacketBlock["pinned"] = [];
  const overflow: DirectivePacketBlock["overflow"] = [];

  let usedLines = 0;
  let overflowing = false;
  for (const directive of ordered) {
    // A multi-line directive consumes as many lines as it has. Content is pinned
    // VERBATIM — byte-for-byte, never trimmed or canonicalized.
    const lineCount = directive.content.split("\n").length;
    if (overflowing || usedLines + lineCount > cap) {
      // Once a directive does not fit, it and every lower-precedence directive
      // are ranked out into overflow, listed by title with a fetch hint.
      overflowing = true;
      overflow.push({ memoryId: directive.memoryId, title: directive.title });
      continue;
    }
    usedLines += lineCount;
    pinned.push({
      memoryId: directive.memoryId,
      content: directive.content,
      precedenceRank: directive.precedenceRank,
      ...(directive.overrideAnnotation === undefined
        ? {}
        : { overrideAnnotation: directive.overrideAnnotation }),
    });
  }

  const fetchHint =
    overflow.length > 0
      ? `${overflow.length} lower-precedence directive(s) not pinned — fetch by title to view in full.`
      : "";

  return { pinned, overflow, fetchHint };
}

/**
 * Code-level half of the directive and policy row invariant. Throws
 * unless the row's (contentVerbatim, renderPolicy) match TYPE_DERIVED_POLICIES
 * for its type: for a verbatim type (directive/policy) contentVerbatim MUST be
 * true AND renderPolicy MUST be 'pinned'; a non-verbatim type MUST NOT claim
 * verbatim/pinned. The DB half is EXPECTED_DIRECTIVE_ROW_CONSTRAINT.
 *
 * @param rawRow - Value supplied for `rawRow`.
 * @returns Nothing.
 * @throws A Zod error for invalid input or an Error when the row violates type-derived policy.
 */
export function assertDirectiveRowInvariant(rawRow: DirectiveRowInvariantInput): void {
  const row = directiveRowInvariantInputSchema.parse(rawRow);
  const derived = TYPE_DERIVED_POLICIES[row.memoryType];
  if (
    row.contentVerbatim !== derived.contentVerbatim ||
    row.renderPolicy !== derived.renderPolicy
  ) {
    throw new Error(
      `directive row invariant violated for memory_type '${row.memoryType}': expected ` +
        `content_verbatim=${derived.contentVerbatim} render_policy='${derived.renderPolicy}', got ` +
        `content_verbatim=${row.contentVerbatim} render_policy='${row.renderPolicy}'`,
    );
  }
}
