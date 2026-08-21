/**
 * Tests migration behavior.
 *
 * Inputs: Imported dependencies and values passed to the module's documented functions.
 * Outputs: Exported types, values, and behavior provided by the module.
 * Errors: Functions document validation, dependency, and runtime errors individually.
 *
 * @packageDocumentation
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(import.meta.dirname, "../../migrations/0001_single_workspace.sql"),
  "utf8",
);

describe("single-workspace PostgreSQL baseline", () => {
  it("contains the full standalone inventory", () => {
    for (const table of ["memory_events", "memory_candidates", "memories", "memory_reviews"]) {
      expect(migration).toContain(`CREATE TABLE ${table}`);
    }
  });

  it("contains no hosted tenancy or lifecycle constructs", () => {
    expect(migration).not.toMatch(
      /organization_membership|org_membership|audience_polic|row level security|create policy|auth\./i,
    );
  });
});
