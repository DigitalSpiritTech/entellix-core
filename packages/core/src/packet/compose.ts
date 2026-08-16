import type {
  ComposeMemoryPacketData,
  MemoryPacket,
  PacketMemoryGroup,
  PacketProcedure as ProcedureInput,
  PacketSection,
  ProfileLine as ProfileLineInput,
  ReconfirmSignal,
  ReconfirmationPrompt,
  RetrievedMemoryInput,
} from "@entellix/contracts/packet";
import { PACKET_SECTIONS } from "@entellix/contracts/packet";

import { renderDirectiveBlock } from "../directive-precedence.ts";

export type {
  ProfileLine as ProfileLineInput,
  PacketProcedure as ProcedureInput,
  RetrievedMemoryInput,
} from "@entellix/contracts/packet";

/**
 * Pure memory-packet composer (S3.1.3). Renders the caller's in-effect
 * directives, profile, relevant memories, and procedures into a single packet
 * in the FIXED section order, dropping lower sections first to fit a token
 * budget. The directive block is rendered verbatim (via renderDirectiveBlock)
 * and is NEVER truncated — it survives even a zero budget. No confidence/score
 * is ever exposed: a rendered memory carries only `{ memoryId, memoryType, text }`.
 *
 * Everything here is a pure function over data with the token estimator injected
 * (`estimateTokens`, char-based by default), so behaviour is provable without a
 * DB. Side effects (retrieval, membership resolution) stay in the service.
 */

/** Estimates the token cost of a rendered string. */
export type TokenEstimator = (text: string) => number;

/** Chars-per-token used by the default char-based estimator. */
const CHARS_PER_TOKEN = 4;

/**
 * Default char-based token estimator: `ceil(length / 4)`. Monotonic in text
 * length and 0 for the empty string. Used when the caller injects no estimator.
 */
export const defaultEstimateTokens: TokenEstimator = (text) =>
  Math.ceil(text.length / CHARS_PER_TOKEN);

/**
 * Section header strings. `directives` MUST equal renderDirectiveBlock's first
 * line so the pinned block reads as one section.
 */
export const PACKET_HEADERS = {
  directives: "Directives in effect:",
  pinned: "Pinned governance:",
  userProfile: "User profile:",
  orgProfile: "Organization profile:",
  memories: "Relevant memories:",
  procedures: "Procedures & lessons:",
  reconfirmations: "Please reconfirm:",
} as const;

/**
 * The pinned governance slice draws on its OWN sub-budget carved from the total
 * token budget, so a large pinned list can never starve query recall. The slice
 * gets at most `PINNED_SUBBUDGET_FRACTION` of the budget, but never less than
 * `PINNED_SUBBUDGET_FLOOR` — the floor guarantees a modest governance set always
 * renders even at a zero total budget (the slice, like directives, is never
 * dropped when non-empty). Pinned items overflowing the sub-budget drop from the
 * bottom; the surviving prefix always renders.
 */
const PINNED_SUBBUDGET_FRACTION = 0.15;
const PINNED_SUBBUDGET_FLOOR = 1_000;

/** Default label for retrieved memories that carry no explicit group. */
const DEFAULT_MEMORY_GROUP_LABEL = "General";

export interface ComposeMemoryPacketInput extends ComposeMemoryPacketData {
  estimateTokens?: TokenEstimator;
}

/** The number of items kept in each truncatable section for a given prefix. */
interface SectionCounts {
  user: number;
  org: number;
  mem: number;
  proc: number;
}

function renderProfile(header: string, lines: readonly ProfileLineInput[]): string {
  return [header, ...lines.map((line) => `- ${line.text}`)].join("\n");
}

function groupMemories(memories: readonly RetrievedMemoryInput[]): PacketMemoryGroup[] {
  const order: string[] = [];
  const byLabel = new Map<string, PacketMemoryGroup>();
  for (const memory of memories) {
    const label = memory.group ?? DEFAULT_MEMORY_GROUP_LABEL;
    let group = byLabel.get(label);
    if (!group) {
      group = { label, memories: [] };
      byLabel.set(label, group);
      order.push(label);
    }
    group.memories.push({
      memoryId: memory.memoryId,
      memoryType: memory.memoryType,
      text: memory.text,
    });
  }
  return order.map((label) => byLabel.get(label)!);
}

function renderMemories(groups: readonly PacketMemoryGroup[]): string {
  const parts: string[] = [PACKET_HEADERS.memories];
  for (const group of groups) {
    parts.push(group.label);
    for (const memory of group.memories) {
      parts.push(`- ${memory.text} [${memory.memoryType ?? "memory"}] (${memory.memoryId})`);
    }
  }
  return parts.join("\n");
}

function renderProcedures(procedures: readonly ProcedureInput[]): string {
  return [PACKET_HEADERS.procedures, ...procedures.map((proc) => `- ${proc.text}`)].join("\n");
}

function renderPinned(memories: readonly RetrievedMemoryInput[]): string {
  return [
    PACKET_HEADERS.pinned,
    ...memories.map(
      (memory) => `- ${memory.text} [${memory.memoryType ?? "memory"}] (${memory.memoryId})`,
    ),
  ].join("\n");
}

/**
 * Largest prefix of the pinned slice whose render fits `subBudget`, dropping
 * from the BOTTOM. The empty prefix (0) always fits, so an over-budget first
 * item still leaves the slice empty rather than throwing.
 */
function pinnedFitCount(
  pinned: readonly RetrievedMemoryInput[],
  subBudget: number,
  estimate: TokenEstimator,
): number {
  let best = 0;
  for (let count = 1; count <= pinned.length; count += 1) {
    if (estimate(renderPinned(pinned.slice(0, count))) <= subBudget) {
      best = count;
    } else {
      break;
    }
  }
  return best;
}

/** Slice each section to the prefix `count` demands, top section first. */
function countsForPrefix(prefix: number, totals: SectionCounts): SectionCounts {
  const user = Math.min(prefix, totals.user);
  let rest = prefix - user;
  const org = Math.min(rest, totals.org);
  rest -= org;
  const mem = Math.min(rest, totals.mem);
  rest -= mem;
  const proc = Math.min(rest, totals.proc);
  return { user, org, mem, proc };
}

function renderPacketBody(
  directivesRendered: string,
  pinnedRendered: string,
  input: ComposeMemoryPacketInput,
  queryMemories: readonly RetrievedMemoryInput[],
  counts: SectionCounts,
): string {
  const blocks = [directivesRendered];
  if (pinnedRendered.length > 0) {
    blocks.push(pinnedRendered);
  }
  if (counts.user > 0) {
    blocks.push(renderProfile(PACKET_HEADERS.userProfile, input.userProfile.slice(0, counts.user)));
  }
  if (counts.org > 0) {
    blocks.push(renderProfile(PACKET_HEADERS.orgProfile, input.orgProfile.slice(0, counts.org)));
  }
  if (counts.mem > 0) {
    blocks.push(renderMemories(groupMemories(queryMemories.slice(0, counts.mem))));
  }
  if (counts.proc > 0) {
    blocks.push(renderProcedures((input.procedures ?? []).slice(0, counts.proc)));
  }
  return blocks.join("\n\n");
}

function reconfirmationPrompt(signal: ReconfirmSignal): string {
  if (signal.kind === "superseded") {
    return `${signal.subject} was marked ${signal.was}; recent notes say ${signal.now} — update?`;
  }
  return `${signal.subject}: ${signal.note} — still accurate?`;
}

/**
 * Compose a memory packet. PURE. Renders the directive block first (verbatim,
 * never truncated), then user profile, org profile, grouped memories, and
 * procedures — dropping items from the BOTTOM up until the rendered packet fits
 * the token budget. Reconfirmation prompts are surfaced in their own field and
 * never mutate the memories.
 */
export function composeMemoryPacket(input: ComposeMemoryPacketInput): MemoryPacket {
  const estimate = input.estimateTokens ?? defaultEstimateTokens;
  const procedures = input.procedures ?? [];
  const directivesRendered = renderDirectiveBlock({
    resolution: input.directives,
    channel: "packet",
  });

  // Always-on pinned governance slice: fit to its OWN sub-budget (dropping from
  // the bottom), then dedupe its ids out of the query memories so a pinned id
  // surfaces exactly once, via the pinned slice.
  const pinnedInput = input.pinned ?? [];
  const pinnedSubBudget = Math.max(
    PINNED_SUBBUDGET_FLOOR,
    Math.floor(input.tokenBudget * PINNED_SUBBUDGET_FRACTION),
  );
  const pinned = pinnedInput.slice(0, pinnedFitCount(pinnedInput, pinnedSubBudget, estimate));
  const pinnedIds = new Set(pinned.map((memory) => memory.memoryId));
  const pinnedRendered = pinned.length > 0 ? renderPinned(pinned) : "";

  const queryMemories = input.memories.filter((memory) => !pinnedIds.has(memory.memoryId));

  const totals: SectionCounts = {
    user: input.userProfile.length,
    org: input.orgProfile.length,
    mem: queryMemories.length,
    proc: procedures.length,
  };
  const total = totals.user + totals.org + totals.mem + totals.proc;

  // Largest prefix (top-preserved order) whose rendered packet fits the budget.
  // The directive block AND the pinned slice are always included (prefix 0), so
  // they never drop; the pinned slice's own sub-budget caps how much of the
  // total budget it can consume, leaving query recall unstarved.
  let best = 0;
  for (let prefix = 0; prefix <= total; prefix += 1) {
    const counts = countsForPrefix(prefix, totals);
    const rendered = renderPacketBody(
      directivesRendered,
      pinnedRendered,
      input,
      queryMemories,
      counts,
    );
    if (estimate(rendered) <= input.tokenBudget) {
      best = prefix;
    }
  }

  const counts = countsForPrefix(best, totals);
  const rendered = renderPacketBody(
    directivesRendered,
    pinnedRendered,
    input,
    queryMemories,
    counts,
  );

  const memoryGroups = groupMemories(queryMemories.slice(0, counts.mem));

  const sectionOrder: PacketSection[] = PACKET_SECTIONS.filter((section) => {
    switch (section) {
      case "directives":
        return true;
      case "pinned":
        return pinned.length > 0;
      case "user_profile":
        return counts.user > 0;
      case "org_profile":
        return counts.org > 0;
      case "memories":
        return counts.mem > 0;
      case "procedures":
        return counts.proc > 0;
    }
  });

  const reconfirmations: ReconfirmationPrompt[] = queryMemories
    .filter((memory) => memory.reconfirm !== undefined)
    .map((memory) => ({
      memoryId: memory.memoryId,
      prompt: reconfirmationPrompt(memory.reconfirm!),
    }));

  const memoryIds = [
    ...input.directives.active.map((directive) => directive.memoryId),
    ...pinned.map((memory) => memory.memoryId),
    ...input.userProfile.map((line) => line.memoryId),
    ...input.orgProfile.map((line) => line.memoryId),
    ...queryMemories.map((memory) => memory.memoryId),
    ...procedures.map((proc) => proc.memoryId),
  ];

  return {
    directives: {
      lines: input.directives.active.map((directive) => ({
        memoryId: directive.memoryId,
        content: directive.content,
        rank: directive.rank,
        overrideAnnotation: directive.overrideAnnotation,
      })),
      rendered: directivesRendered,
    },
    pinned: pinned.map((memory) => ({
      memoryId: memory.memoryId,
      memoryType: memory.memoryType,
      text: memory.text,
    })),
    userProfile: input.userProfile
      .slice(0, counts.user)
      .map((line) => ({ memoryId: line.memoryId, text: line.text })),
    orgProfile: input.orgProfile
      .slice(0, counts.org)
      .map((line) => ({ memoryId: line.memoryId, text: line.text })),
    memories: memoryGroups,
    procedures: procedures
      .slice(0, counts.proc)
      .map((proc) => ({ memoryId: proc.memoryId, text: proc.text })),
    reconfirmations,
    memoryIds,
    sectionOrder,
    rendered,
    estimatedTokens: estimate(rendered),
    truncated: best < total,
  };
}
