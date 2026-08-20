import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { inspectTsdocCompliance } from "./tsdoc-compliance.mjs";

const compliantFile = `/**
 * Provides arithmetic helpers for compliance fixtures.
 *
 * Inputs: Numeric values supplied to exported helpers.
 * Outputs: Numeric results returned by exported helpers.
 * Errors: The helpers in this module do not throw.
 *
 * @packageDocumentation
 */

/**
 * Adds two numbers.
 *
 * @param left - First number to add.
 * @param right - Second number to add.
 * @returns The sum of both numbers.
 * @throws This function does not throw.
 */
export function add(left: number, right: number): number {
  return left + right;
}
`;

/**
 * Exercises the TSDoc compliance inspection contract.
 *
 * Inputs: TypeScript fixture source strings.
 * Outputs: Assertions describing accepted and rejected documentation.
 * Errors: Assertion failures when the checker violates its contract.
 */
describe("inspectTsdocCompliance", () => {
  /**
   * Accepts a fully documented module and function.
   *
   * Inputs: None.
   * @returns Nothing.
   * @throws An assertion error when compliant source produces a violation.
   */
  it("accepts compliant file and function documentation", () => {
    assert.deepEqual(inspectTsdocCompliance("fixture.ts", compliantFile), []);
  });

  /**
   * Rejects a module without package documentation.
   *
   * Inputs: None.
   * @returns Nothing.
   * @throws An assertion error when missing file documentation is accepted.
   */
  it("requires file-level package documentation", () => {
    const violations = inspectTsdocCompliance("fixture.ts", "export const value = 1;\n");

    assert.ok(violations.some((violation) => violation.rule === "file-documentation"));
  });

  /**
   * Rejects incomplete function contracts.
   *
   * Inputs: None.
   * @returns Nothing.
   * @throws An assertion error when incomplete function tags are accepted.
   */
  it("requires parameter, return, and error documentation", () => {
    const source = `${compliantFile}\n/** Adds one. */\nexport const increment = (value: number) => value + 1;\n`;
    const violations = inspectTsdocCompliance("fixture.ts", source);

    assert.ok(violations.some((violation) => violation.rule === "function-params"));
    assert.ok(violations.some((violation) => violation.rule === "function-returns"));
    assert.ok(violations.some((violation) => violation.rule === "function-errors"));
  });

  /**
   * Requires an explicit statement when a function accepts no inputs.
   *
   * Inputs: None.
   * @returns Nothing.
   * @throws An assertion error when undocumented empty inputs are accepted.
   */
  it("requires explicit no-input documentation", () => {
    const source = `${compliantFile}\n/**
 * Gets a value.
 *
 * @returns A value.
 * @throws This function does not throw.
 */
export function getValue(): number { return 1; }
`;
    const violations = inspectTsdocCompliance("fixture.ts", source);

    assert.ok(violations.some((violation) => violation.rule === "function-params"));
  });

  /**
   * Requires void-returning declarations to describe the absence of output.
   *
   * Inputs: None.
   * @returns Nothing.
   * @throws An assertion error when a vague void result is accepted.
   */
  it("requires explicit no-output documentation for void functions", () => {
    const source = `${compliantFile}\n/**
 * Records a signal.
 *
 * @param value - Signal to record.
 * @returns The result produced by the function.
 * @throws This function does not throw.
 */
export function record(value: string): void { console.log(value); }
`;
    const violations = inspectTsdocCompliance("fixture.ts", source);

    assert.ok(violations.some((violation) => violation.rule === "function-returns"));
  });

  /**
   * Checks class-level input, output, and error descriptions.
   *
   * Inputs: None.
   * @returns Nothing.
   * @throws An assertion error when incomplete class documentation is accepted.
   */
  it("requires class contract documentation", () => {
    const source = `${compliantFile}\n/** Represents a counter. */\nexport class Counter {}\n`;
    const violations = inspectTsdocCompliance("fixture.ts", source);

    assert.ok(violations.some((violation) => violation.rule === "class-inputs"));
    assert.ok(violations.some((violation) => violation.rule === "class-outputs"));
    assert.ok(violations.some((violation) => violation.rule === "class-errors"));
  });

  /**
   * Applies class rules to class expressions owned by a variable declaration.
   *
   * Inputs: None.
   * @returns Nothing.
   * @throws An assertion error when an undocumented class expression is accepted.
   */
  it("requires documentation for class-valued declarations", () => {
    const source = `${compliantFile}\nexport const Counter = class {};\n`;
    const violations = inspectTsdocCompliance("fixture.ts", source);

    assert.ok(violations.some((violation) => violation.rule === "class-documentation"));
  });

  /**
   * Applies function rules to a callable default export.
   *
   * Inputs: None.
   * @returns Nothing.
   * @throws An assertion error when an undocumented default function is accepted.
   */
  it("requires documentation for callable default exports", () => {
    const source = `${compliantFile}\nexport default () => 1;\n`;
    const violations = inspectTsdocCompliance("fixture.ts", source);

    assert.ok(violations.some((violation) => violation.rule === "function-documentation"));
  });

  /**
   * Leaves anonymous inline callbacks under the documentation of their owning operation.
   *
   * Inputs: None.
   * @returns Nothing.
   * @throws An assertion error when an unattached callback is treated as a declaration.
   */
  it("does not require unattached TSDoc for inline callbacks", () => {
    const source = `${compliantFile}\nexport const values = [1].map((value) => value + 1);\n`;

    assert.deepEqual(inspectTsdocCompliance("fixture.ts", source), []);
  });
});
