/**
 * Provides the standalone distribution's review-first policy matrix.
 *
 * Inputs: Imported dependencies and values passed to the module's documented functions.
 * Outputs: Exported types, values, and behavior provided by the module.
 * Errors: Functions document validation, dependency, and runtime errors individually.
 *
 * @packageDocumentation
 */

import { policyMatrixConfigSchema } from "@entellix/contracts/policy-matrix";

/**
 * Safe distribution default for a local single-workspace host: workers classify
 * automatically and route every candidate to local review. Review decisions
 * remain capable of canonical commitment.
 */
export const STANDALONE_POLICY_MATRIX = policyMatrixConfigSchema.parse({
  version: "standalone/1.0-review-first",
  cells: [],
  defaults: { disposition: "review", minConfidence: 0 },
});
