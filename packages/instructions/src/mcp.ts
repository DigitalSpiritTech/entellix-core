import { z } from "zod";

export const ENTELLIX_MCP_TOOL_IDS = [
  "get_context",
  "save_memory",
  "retrieve_memory",
  "list_memories",
  "log_context",
  "search",
] as const;
export const entellixMcpToolIdSchema = z.enum(ENTELLIX_MCP_TOOL_IDS);
export type EntellixMcpToolId = z.infer<typeof entellixMcpToolIdSchema>;

export const entellixToolDescriptionsSchema = z.record(
  entellixMcpToolIdSchema,
  z.string().trim().min(1).max(700),
);
export type EntellixToolDescriptions = z.infer<typeof entellixToolDescriptionsSchema>;

export const ACTIVE_ENTELLIX_TOOL_DESCRIPTIONS = entellixToolDescriptionsSchema.parse({
  get_context:
    "Call before answering anything that may depend on saved context — user preferences, prior decisions, org/client/project context, active constraints, procedures, or task state. " +
    "Pass a short taskContext describing the current work, active subject, and named people, tools, or repositories. " +
    "Treat returned Entellix memories as quiet working context; do not announce retrieval or expose review links by default.",
  save_memory:
    "Call when the user clearly states a durable preference, fact, correction, rule, procedure, or decision that should shape future work. " +
    "Queue it automatically when intent is clear; skip transient task chatter, guesses, sensitive claims, and uncertain interpretations. " +
    "Processing is asynchronous: the receipt confirms governed intake only, not that a memory was saved.",
  retrieve_memory:
    "Use when you need an advanced or explicit memory lookup — profile recall, organization recall, or a scoped search. " +
    "Not the normal first tool for task context: call get_context before context-sensitive work, and prefer search for a plain explicit lookup. " +
    "Modes: search, context, profile, organization. Use results as quiet working context; do not announce retrieval by default.",
  list_memories:
    "Use only when the user explicitly asks to see, audit, or review saved memory. " +
    "This is never the normal context-retrieval tool: call get_context for task context and search for explicit lookups.",
  log_context:
    "Whenever the user states or changes durable context, hand Entellix the raw context slice from the current work so the Brain can extract memory server-side. " +
    "Extraction runs asynchronously — nothing is saved as a memory yet, and Entellix decides what to keep. " +
    "Pass the raw event text; do not pre-classify scope or provenance.",
  search:
    "Use only when the user explicitly asks to search saved memory; call get_context for normal task context. " +
    "Pass a natural-language query with optional filters (scope, status, limit). " +
    "Returns matching Entellix memories as quiet working context; do not announce retrieval or expose review links by default.",
});

export const entellixServerInstructionsSchema = z.string().trim().min(1).max(4_000);
export const ACTIVE_ENTELLIX_SERVER_INSTRUCTIONS = entellixServerInstructionsSchema.parse(
  "Recall before you act: before context-sensitive work, call get_context with a short summary of the current work to load relevant Entellix memory — preferences, prior decisions, procedures, and active constraints. " +
    "Log after the user shares durable context: call log_context to hand Entellix the raw slice of work; extraction runs server-side and asynchronously, so never claim a memory was saved from it. " +
    "Do not decide scope yourself — pass raw context to Entellix and let the Brain classify it. " +
    "Entellix stores durable memories (facts, preferences, rules, relationships, lightweight procedures). " +
    "Use save_memory when the user clearly wants something remembered now, and search for explicit lookups. " +
    "Use retrieved memories to improve the answer; do not announce retrieval or include memory review links by default.",
);
