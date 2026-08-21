/**
 * Tests templates behavior.
 *
 * Inputs: Imported dependencies and values passed to the module's documented functions.
 * Outputs: Exported types, values, and behavior provided by the module.
 * Errors: Functions document validation, dependency, and runtime errors individually.
 *
 * @packageDocumentation
 */

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  INSTRUCTION_CLIENTS,
  INSTRUCTION_MARKER_BEGIN,
  INSTRUCTION_MARKER_END,
  instructionTemplateSchema,
} from "../schema.ts";
import {
  ACTIVE_INSTRUCTION_TEMPLATES,
  ACTIVE_TEMPLATE_PACK_VERSION,
  TEMPLATE_PACK_VERSIONS,
  getInstructionTemplate,
} from "../templates.ts";

// Behavioral contract for the shipped per-client instruction template pack.

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const MANAGED_BLOCK_CLIENTS = ["claude-code", "codex"];
const COPY_PASTE_CLIENTS = ["claude-desktop", "cowork", "chatgpt"];

// Loose, phrasing-tolerant (case-insensitive) intent matchers for the four
// required behaviors every template body must instruct.
const RECALL_BEFORE_WORK_RE =
  /\bbefore\b[^.]{0,120}\bget_context\b|\bget_context\b[^.]{0,120}\bbefore\b/i;
const LOG_AFTER_TASK_RE =
  /\bafter\b[^.]{0,120}\b(log_context|save_memory)\b|\b(log_context|save_memory)\b[^.]{0,120}\bafter\b/i;
const NEVER_DECIDE_SCOPE_RE = /\b(do not|never|don't)\b[^.]{0,40}\bdecide scope\b/i;
const SESSION_END_SUMMARY_RE =
  /\b(session[\s-]?end|end of (the )?session|wrap[\s-]?up)\b[^.]{0,120}\bsummary\b|\bsummary\b[^.]{0,120}\b(session[\s-]?end|end of (the )?session|wrap[\s-]?up)\b/i;

describe("ACTIVE_INSTRUCTION_TEMPLATES", () => {
  it("has a schema-valid entry for every instruction client", () => {
    for (const client of INSTRUCTION_CLIENTS) {
      const template = ACTIVE_INSTRUCTION_TEMPLATES[client];
      expect(template, `missing template for client "${client}"`).toBeDefined();
      expect(() => instructionTemplateSchema.parse(template)).not.toThrow();
    }
  });

  it("every body instructs a recall-before-work trigger (get_context, before task work)", () => {
    for (const client of INSTRUCTION_CLIENTS) {
      const template = ACTIVE_INSTRUCTION_TEMPLATES[client];
      expect(template?.body, `client "${client}"`).toMatch(RECALL_BEFORE_WORK_RE);
    }
  });

  it("every body instructs a log-after-task trigger (log_context/save_memory, after durable context)", () => {
    for (const client of INSTRUCTION_CLIENTS) {
      const template = ACTIVE_INSTRUCTION_TEMPLATES[client];
      expect(template?.body, `client "${client}"`).toMatch(LOG_AFTER_TASK_RE);
    }
  });

  it("every body instructs the client to never decide scope itself", () => {
    for (const client of INSTRUCTION_CLIENTS) {
      const template = ACTIVE_INSTRUCTION_TEMPLATES[client];
      expect(template?.body, `client "${client}"`).toMatch(NEVER_DECIDE_SCOPE_RE);
    }
  });

  it("every body nudges a session-end summary", () => {
    for (const client of INSTRUCTION_CLIENTS) {
      const template = ACTIVE_INSTRUCTION_TEMPLATES[client];
      expect(template?.body, `client "${client}"`).toMatch(SESSION_END_SUMMARY_RE);
    }
  });

  it("claude-code and codex are managed-block templates wrapped by the marker constants", () => {
    for (const client of MANAGED_BLOCK_CLIENTS) {
      const template = ACTIVE_INSTRUCTION_TEMPLATES[client as (typeof INSTRUCTION_CLIENTS)[number]];
      expect(template?.format, `client "${client}"`).toBe("managed-block");
      expect(
        template?.body.trim().startsWith(INSTRUCTION_MARKER_BEGIN),
        `client "${client}" begin marker`,
      ).toBe(true);
      expect(
        template?.body.trim().endsWith(INSTRUCTION_MARKER_END),
        `client "${client}" end marker`,
      ).toBe(true);
    }
  });

  it("claude-desktop, cowork, and chatgpt are copy-paste templates", () => {
    for (const client of COPY_PASTE_CLIENTS) {
      const template = ACTIVE_INSTRUCTION_TEMPLATES[client as (typeof INSTRUCTION_CLIENTS)[number]];
      expect(template?.format, `client "${client}"`).toBe("copy-paste");
    }
  });
});

describe("TEMPLATE_PACK_VERSIONS", () => {
  it("is a non-empty version registry with a changelog note per entry", () => {
    const entries = Object.entries(TEMPLATE_PACK_VERSIONS);
    expect(entries.length).toBeGreaterThan(0);
    for (const [key, version] of entries) {
      expect(version.version, `version key "${key}"`).toBeTruthy();
      expect(version.date, `version key "${key}"`).toBeTruthy();
      expect(version.summary, `version key "${key}" changelog summary`).toBeTruthy();
    }
  });

  it("ACTIVE_TEMPLATE_PACK_VERSION points at a real entry in the registry", () => {
    const active = TEMPLATE_PACK_VERSIONS[ACTIVE_TEMPLATE_PACK_VERSION];
    expect(active, `ACTIVE_TEMPLATE_PACK_VERSION "${ACTIVE_TEMPLATE_PACK_VERSION}"`).toBeDefined();
    expect(active?.templates).toBe(ACTIVE_INSTRUCTION_TEMPLATES);
  });
});

describe("getInstructionTemplate", () => {
  it("returns the claude-code template", () => {
    expect(getInstructionTemplate("claude-code")).toEqual(
      ACTIVE_INSTRUCTION_TEMPLATES["claude-code"],
    );
  });

  it("throws for an unknown client", () => {
    // Unknown clients are a type error at the call site (the parameter is
    // typed as InstructionClient); this asserts the runtime guard for values
    // that reach the function despite that, e.g. from an untyped boundary.
    expect(() => getInstructionTemplate("not-a-real-client" as never)).toThrow(/./);
  });
});

describe("setup docs", () => {
  it("has a setup guide for every instruction client", () => {
    for (const client of INSTRUCTION_CLIENTS) {
      const path = join(PACKAGE_ROOT, "docs", "setup", `${client}.md`);
      expect(existsSync(path), `missing setup guide: ${path}`).toBe(true);
    }
  });

  it("has a verification checklist", () => {
    const path = join(PACKAGE_ROOT, "docs", "verification-checklist.md");
    expect(existsSync(path), `missing verification checklist: ${path}`).toBe(true);
  });
});
