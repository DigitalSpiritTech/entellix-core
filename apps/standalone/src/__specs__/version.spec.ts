/**
 * Tests standalone version metadata.
 *
 * Inputs: The standalone package manifest and exported runtime version.
 * Outputs: Assertions that runtime metadata follows the release version.
 * Errors: Assertion failures when the values diverge.
 *
 * @packageDocumentation
 */

import { expect, it } from "vitest";

import standaloneManifest from "../../package.json" with { type: "json" };
import { STANDALONE_VERSION } from "../version.ts";

it("uses the package version in runtime metadata", () => {
  expect(STANDALONE_VERSION).toBe(standaloneManifest.version);
});
