/**
 * Implements schema behavior for this TypeScript module.
 *
 * Inputs: Imported dependencies and values passed to the module's documented functions.
 * Outputs: Exported types, values, and behavior provided by the module.
 * Errors: Functions document validation, dependency, and runtime errors individually.
 *
 * @packageDocumentation
 */

import { z } from "zod";

/**
 * S4.1.1 contract for the per-client instruction template pack. A template is
 * pure data describing how Entellix's recall/log/scope/summary instructions
 * are packaged for one client surface (see ai/platforms/index.md for the
 * per-platform surface facts these targets align to). This module owns the
 * schema only — `templates.ts` (developer-authored) supplies the content.
 */

export const INSTRUCTION_CLIENTS = [
  "claude-code",
  "codex",
  "claude-desktop",
  "cowork",
  "chatgpt",
] as const;
export const instructionClientSchema = z.enum(INSTRUCTION_CLIENTS);
export type InstructionClient = z.infer<typeof instructionClientSchema>;

/**
 * `managed-block` targets are files Entellix inserts/updates a marked block
 * into (CLAUDE.md, AGENTS.md). `copy-paste` targets are surfaces with no file
 * Entellix can write to directly (Claude Desktop / Cowork / ChatGPT project or
 * custom instructions) — the user pastes the body in manually.
 */
export const INSTRUCTION_FORMATS = ["managed-block", "copy-paste"] as const;
export const instructionFormatSchema = z.enum(INSTRUCTION_FORMATS);
export type InstructionFormat = z.infer<typeof instructionFormatSchema>;

/**
 * Managed-block markers. The S4.1.2 CLI reuses these verbatim to do an
 * idempotent insert-or-update of the Entellix-owned block inside a
 * user-owned file (CLAUDE.md / AGENTS.md) without disturbing surrounding
 * content.
 */
export const INSTRUCTION_MARKER_BEGIN = "<!-- entellix:begin -->";
export const INSTRUCTION_MARKER_END = "<!-- entellix:end -->";

export const instructionTemplateSchema = z.object({
  client: instructionClientSchema,
  label: z.string().trim().min(1).max(80),
  target: z.string().trim().min(1).max(200),
  format: instructionFormatSchema,
  body: z.string().trim().min(1).max(8000),
});
export type InstructionTemplate = z.infer<typeof instructionTemplateSchema>;

export const instructionTemplatesSchema = z.record(
  instructionClientSchema,
  instructionTemplateSchema,
);
export type InstructionTemplates = z.infer<typeof instructionTemplatesSchema>;

/**
 * A single change-log entry for one template pack version. Hosts can use the
 * same shape for their versioned tool-description registry.
 */
export const templatePackVersionSchema = z.object({
  version: z.string().trim().min(1),
  date: z.string().trim().min(1),
  summary: z.string().trim().min(1),
  templates: instructionTemplatesSchema,
});
export type TemplatePackVersion = z.infer<typeof templatePackVersionSchema>;
