import { z } from "zod";

import { resolutionSchema } from "./directive-precedence.ts";
import { orgMembershipRoleSchema, orgMembershipStatusSchema } from "./memory-v2.ts";
import { memoryTypeSchema } from "./memory-v2.ts";

/**
 * Memory-packet contracts (S3.1.3). A `get_context` call returns a composed
 * PACKET (not a bare memory list): a fixed-order rendering of the caller's
 * in-effect directives, profile, relevant memories, and procedures, plus a
 * server-verified context envelope. This module is pure contract — constants,
 * Zod schemas, and their inferred types; the composer and envelope verifier
 * live in `@entellix/core/packet`. Imported via the
 * `@entellix/contracts/packet` subpath.
 *
 * Two invariants are pinned here: the directive block is rendered FIRST and is
 * never dropped; and NO confidence/score signal is ever exposed in a packet —
 * a rendered memory carries only `{ memoryId, memoryType, text }`.
 */

/**
 * The packet sections in their FIXED render order. Truncation removes from the
 * BOTTOM (procedures → memories → org_profile → user_profile); `directives` is
 * the top section and is never removed. `pinned` (an always-on governance slice,
 * S4.2.2) renders right after `directives` and, like the directive block, is
 * never truncated away when non-empty — it draws on its OWN sub-budget so a
 * large pinned list cannot starve query recall. `sectionOrder` on a composed
 * packet is always a subsequence of this array (present sections only).
 */
export const PACKET_SECTIONS = [
  "directives",
  "pinned",
  "user_profile",
  "org_profile",
  "memories",
  "procedures",
] as const;
export const packetSectionSchema = z.enum(PACKET_SECTIONS);
export type PacketSection = z.infer<typeof packetSectionSchema>;

/**
 * One directive line rendered into the pinned directive block. Mirrors
 * `activeDirectiveSchema` from directive-precedence: `content` is the verbatim
 * rule text and `overrideAnnotation` is the SEPARATE annotation string (never
 * merged into `content`).
 */
export const packetDirectiveSchema = z.object({
  memoryId: z.uuid(),
  content: z.string().min(1),
  rank: z.number().int().min(0),
  overrideAnnotation: z.string().nullable(),
});
export type PacketDirective = z.infer<typeof packetDirectiveSchema>;

/** A single profile line (user or org profile): id + verbatim text, nothing else. */
export const profileLineSchema = z.object({
  memoryId: z.uuid(),
  text: z.string(),
});
export type ProfileLine = z.infer<typeof profileLineSchema>;

/**
 * A retrieved memory as rendered into the packet. Carries EXACTLY id, type, and
 * text — never a confidence or score. `memoryType` is nullable for v1 rows that
 * predate the v2 typing.
 */
export const packetMemorySchema = z.object({
  memoryId: z.uuid(),
  memoryType: memoryTypeSchema.nullable(),
  text: z.string(),
});
export type PacketMemory = z.infer<typeof packetMemorySchema>;

/** A labelled group of rendered memories (e.g. by subject or type). */
export const packetMemoryGroupSchema = z.object({
  label: z.string(),
  memories: z.array(packetMemorySchema),
});
export type PacketMemoryGroup = z.infer<typeof packetMemoryGroupSchema>;

/** A procedure/lesson line: id + verbatim text. */
export const packetProcedureSchema = z.object({
  memoryId: z.uuid(),
  text: z.string(),
});
export type PacketProcedure = z.infer<typeof packetProcedureSchema>;

/**
 * A signal that a retrieved memory may be stale and needs the user to
 * reconfirm. `superseded`: a more recent note says something different than the
 * memory recorded. `contradicted`: a newer note directly conflicts. The signal
 * NEVER mutates the memory; it is surfaced as a separate reconfirmation prompt.
 */
export const reconfirmSignalSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("superseded"),
    subject: z.string(),
    was: z.string(),
    now: z.string(),
  }),
  z.object({
    kind: z.literal("contradicted"),
    subject: z.string(),
    note: z.string(),
  }),
]);
export type ReconfirmSignal = z.infer<typeof reconfirmSignalSchema>;

/** A rendered reconfirmation prompt tied to the memory that raised it. */
export const reconfirmationPromptSchema = z.object({
  memoryId: z.uuid(),
  prompt: z.string(),
});
export type ReconfirmationPrompt = z.infer<typeof reconfirmationPromptSchema>;

/**
 * A caller's resolved org membership as fed to the envelope verifier. The
 * verifier trusts these (server-resolved), never the model-asserted org id.
 */
export const envelopeMembershipSchema = z.object({
  organizationId: z.uuid(),
  role: orgMembershipRoleSchema,
  status: orgMembershipStatusSchema,
});
export type EnvelopeMembership = z.infer<typeof envelopeMembershipSchema>;

/**
 * The composed memory packet returned by `get_context`. Sections render in the
 * fixed PACKET_SECTIONS order; `directives.rendered` is the verbatim directive
 * block and is always the FIRST thing in `rendered`. `pinned` is the always-on
 * governance slice (S4.2.2) — structured alongside `rendered` so a consumer can
 * read the guaranteed governance memories without re-parsing the string.
 * `memoryIds` lists every source memory id for traceability. `estimatedTokens`
 * equals the token estimate of `rendered`; `truncated` is true when the token
 * budget dropped any lower section. No confidence/score is present anywhere.
 */
export const memoryPacketSchema = z.object({
  directives: z.object({
    lines: z.array(packetDirectiveSchema),
    rendered: z.string(),
  }),
  pinned: z.array(packetMemorySchema),
  userProfile: z.array(profileLineSchema),
  orgProfile: z.array(profileLineSchema),
  memories: z.array(packetMemoryGroupSchema),
  procedures: z.array(packetProcedureSchema),
  reconfirmations: z.array(reconfirmationPromptSchema),
  memoryIds: z.array(z.uuid()),
  sectionOrder: z.array(packetSectionSchema),
  rendered: z.string(),
  estimatedTokens: z.number().int().min(0),
  truncated: z.boolean(),
});
export type MemoryPacket = z.infer<typeof memoryPacketSchema>;

/**
 * The server-VERIFIED context envelope. `actorUserId` is the auth-derived
 * principal (trusted). `orgId` is the org the caller is actually an active
 * member of (asserted org honoured only when membership confirms it, else the
 * caller's active org, else null). `entityIds` are server-resolved only.
 * `verified` is always true — this shape is only ever produced by the verifier.
 */
export const contextEnvelopeSchema = z.object({
  actorUserId: z.uuid(),
  orgId: z.uuid().nullable(),
  entityIds: z.array(z.uuid()),
  verified: z.literal(true),
});
export type VerifiedEnvelope = z.infer<typeof contextEnvelopeSchema>;

export const retrievedMemoryInputSchema = packetMemorySchema.extend({
  group: z.string().optional(),
  reconfirm: reconfirmSignalSchema.optional(),
});
export type RetrievedMemoryInput = z.infer<typeof retrievedMemoryInputSchema>;

/** Serializable/data portion of the packet composer input. */
export const composeMemoryPacketDataSchema = z.object({
  directives: resolutionSchema,
  pinned: z.array(retrievedMemoryInputSchema).optional(),
  userProfile: z.array(profileLineSchema),
  orgProfile: z.array(profileLineSchema),
  memories: z.array(retrievedMemoryInputSchema),
  procedures: z.array(packetProcedureSchema).optional(),
  tokenBudget: z.number().int().nonnegative(),
  now: z.date().optional(),
});
export type ComposeMemoryPacketData = z.infer<typeof composeMemoryPacketDataSchema>;

/** Trusted data portion of envelope verification; resolvers remain host ports. */
export const verifyContextEnvelopeDataSchema = z.object({
  actorUserId: z.uuid(),
  asserted: z.object({
    orgId: z.uuid().nullable().optional(),
    entityIds: z.array(z.uuid()).optional(),
  }),
});
export type VerifyContextEnvelopeData = z.infer<typeof verifyContextEnvelopeDataSchema>;
