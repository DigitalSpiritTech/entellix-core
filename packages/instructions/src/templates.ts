/**
 * Implements templates behavior for this TypeScript module.
 *
 * Inputs: Imported dependencies and values passed to the module's documented functions.
 * Outputs: Exported types, values, and behavior provided by the module.
 * Errors: Functions document validation, dependency, and runtime errors individually.
 *
 * @packageDocumentation
 */

import {
  INSTRUCTION_MARKER_BEGIN,
  INSTRUCTION_MARKER_END,
  type InstructionClient,
  type InstructionTemplate,
  type InstructionTemplates,
  type TemplatePackVersion,
} from "./schema.ts";

/**
 * S4.1.1 per-client instruction template pack. Pure data: each entry is the
 * body a user (or the S4.1.2 CLI) drops into one client surface so that client
 * recalls Entellix memory before work and logs durable context after. The copy
 * mirrors the live MCP server instructions and uses the real Entellix tool
 * names — get_context to recall, save_memory to capture — so the two surfaces
 * read the same way. The versioned registry keeps clients and hosts aligned.
 */

/**
 * Wrap a managed-block body in the marker constants the S4.1.2 CLI uses to do
 * an idempotent insert-or-update inside a user-owned file (CLAUDE.md /
 * AGENTS.md). Kept as a local helper so both managed-block clients stay
 * marker-consistent by construction.
 *
 * @param inner - Value supplied for `inner`.
 * @returns The result produced by `managedBlock`.
 * @throws Errors raised by validation or dependent operations.
 */
function managedBlock(inner: string): string {
  return `${INSTRUCTION_MARKER_BEGIN}\n${inner.trim()}\n${INSTRUCTION_MARKER_END}`;
}

const CLAUDE_CODE_TEMPLATE: InstructionTemplate = {
  client: "claude-code",
  label: "Claude Code (CLAUDE.md)",
  target: "CLAUDE.md",
  format: "managed-block",
  body: managedBlock(`## Entellix memory

You have an Entellix Brain connected over MCP. Use it as your durable memory across sessions.

- **Recall first.** Before you start a task or answer, call \`get_context\` with a short summary of the current work — active task, named people, tools, repositories, decisions, and constraints — and treat the returned memories as quiet working context (do not announce retrieval).
- **Whenever the user gives a directive, run \`get_context\` to see if there are any memories that relate to the directive.**
- **Log after.** After you finish a task — or the user states a preference, decision, or fact — call \`save_memory\` so it persists for future sessions.
- **Do not decide scope yourself.** Entellix classifies owner and scope server-side; you just capture the raw exchange. Do not pre-label a memory as personal, client, or project.
- **Wrap up.** At the end of the session, write a short summary of what changed or was decided and save that summary with \`save_memory\`.`),
};

const CODEX_TEMPLATE: InstructionTemplate = {
  client: "codex",
  label: "OpenAI Codex (AGENTS.md)",
  target: "AGENTS.md",
  format: "managed-block",
  body: managedBlock(`## Entellix memory

An Entellix Brain is connected over MCP and is your durable memory across Codex sessions.

- **Recall first.** Before you begin coding or reply, call \`get_context\` with a short summary of the current work — the task, repository, files, named people, and any relevant decisions — and use the returned memories as quiet working context.
- **Log after.** After you complete a task — or the user states a preference, decision, or fact — call \`save_memory\` to persist it.
- **Do not decide scope yourself.** Entellix classifies owner and scope on the server; hand it the raw context and let the Brain decide where the memory belongs.
- **Wrap up.** At the end of the session, capture a brief summary of what was built or decided and save that summary with \`save_memory\`.`),
};

const CLAUDE_DESKTOP_TEMPLATE: InstructionTemplate = {
  client: "claude-desktop",
  label: "Claude Desktop (project instructions)",
  target: "Claude Desktop → Project → Instructions",
  format: "copy-paste",
  body: `You have an Entellix Brain connected over MCP that serves as your durable memory across chats.

Recall first: before you answer, call get_context with a short summary of the current work — the topic, named people, organizations, and any active decisions or constraints — and treat the returned memories as quiet working context without announcing that you retrieved them.

Log after: after you finish a task — or the user states a preference, decision, or fact — call save_memory so it persists for future chats.

Do not decide scope yourself. Entellix classifies owner and scope server-side, so hand it the raw exchange and let the Brain decide where each memory belongs.

At the end of the session, write a short summary of what was decided or changed and save that summary with save_memory.`,
};

const COWORK_TEMPLATE: InstructionTemplate = {
  client: "cowork",
  label: "Claude Cowork (project instructions)",
  target: "Cowork → Project → Instructions",
  format: "copy-paste",
  body: `This project has an Entellix Brain connected over MCP as its shared durable memory.

Recall first: before you start or respond to a request, call get_context with a short summary of the current work — the task, named people, tools, and any relevant prior decisions — and use the returned memories as quiet working context.

Log after: after you complete a task — or a teammate states a preference, decision, or fact — call save_memory so the team's Brain keeps it.

Do not decide scope yourself. Entellix classifies owner and scope server-side; pass it the raw context and let the Brain place the memory.

At the end of the session, write a short summary of the outcome and save that summary with save_memory.`,
};

const CHATGPT_TEMPLATE: InstructionTemplate = {
  client: "chatgpt",
  label: "ChatGPT (project / custom instructions)",
  target: "ChatGPT → Project instructions or Settings → Custom instructions",
  format: "copy-paste",
  body: `An Entellix Brain is connected over MCP as your durable memory across chats.

Recall first: before you answer, call get_context with a short summary of the current work and use the returned memories as quiet working context; do not announce retrieval.

Log after: after you finish a task, or when the user states a preference, decision, or fact, call save_memory to persist it.

Do not decide scope yourself — Entellix classifies owner and scope server-side from the raw context.

At the end of the session, save a short summary of what changed with save_memory.`,
};

/** All five per-client templates for the v1 pack. */
export const INSTRUCTION_TEMPLATES_V1: InstructionTemplates = {
  "claude-code": CLAUDE_CODE_TEMPLATE,
  codex: CODEX_TEMPLATE,
  "claude-desktop": CLAUDE_DESKTOP_TEMPLATE,
  cowork: COWORK_TEMPLATE,
  chatgpt: CHATGPT_TEMPLATE,
};

/**
 * Version registry / change log. Each entry holds the templates shipped under a
 * version tag plus a date and human summary, so the registry doubles as the
 * copy change log — the same shape as TOOL_DESCRIPTION_VERSIONS. Dates are
 * fixed strings; this module stays pure data with no runtime clock.
 */
export const TEMPLATE_PACK_VERSIONS: Record<"v1", TemplatePackVersion> = {
  v1: {
    version: "v1",
    date: "2026-07-08",
    summary:
      "Initial S4.1.1 instruction pack: recall-before/log-after/never-decide-scope/session-end-summary copy for claude-code and codex (managed-block) and claude-desktop, cowork, and chatgpt (copy-paste), aligned to the v2.1 MCP server instructions.",
    templates: INSTRUCTION_TEMPLATES_V1,
  },
};

/** The pack version served on the live default surface. */
export const ACTIVE_TEMPLATE_PACK_VERSION = "v1" as const;

/** Active templates — the object that production wiring and the CLI read their templates from. */
export const ACTIVE_INSTRUCTION_TEMPLATES =
  TEMPLATE_PACK_VERSIONS[ACTIVE_TEMPLATE_PACK_VERSION].templates;

/**
 * Look up the active template for a client. Throws for any value that is not a
 * known instruction client — the parameter is typed, but this guards untyped
 * boundaries (CLI args, request payloads) that reach the function anyway.
 *
 * @param client - Value supplied for `client`.
 * @returns The result produced by `getInstructionTemplate`.
 * @throws Errors raised by validation or dependent operations.
 */
export function getInstructionTemplate(client: InstructionClient): InstructionTemplate {
  const template = ACTIVE_INSTRUCTION_TEMPLATES[client];
  if (!template) {
    throw new Error(`Unknown instruction client: ${String(client)}`);
  }
  return template;
}
