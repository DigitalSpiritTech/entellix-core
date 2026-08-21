/**
 * Adapts standalone operator services into authenticated Mastra HTTP routes.
 *
 * Inputs: Imported dependencies and values passed to the module's documented functions.
 * Outputs: Exported types, values, and behavior provided by the module.
 * Errors: Functions document validation, dependency, and runtime errors individually.
 *
 * @packageDocumentation
 */

import { reviewDecisionInputSchema } from "@entellix/contracts/reviews";
import { registerApiRoute } from "@mastra/core/server";

import { standaloneRepository, standaloneService } from "../runtime.ts";

const health = registerApiRoute("/healthz", {
  method: "GET",
  /**
   * Executes handler.
   *
   * @param c - Value supplied for `c`.
   * @returns The result produced by `handler`.
   * @throws Errors raised by validation or dependent operations.
   */
  handler: async (c) => {
    try {
      await standaloneRepository.ping();
      return c.json({ ok: true, distribution: "standalone", workspace: "single" });
    } catch {
      return c.json({ ok: false, error: "database_unavailable" }, 503);
    }
  },
});

const reviews = registerApiRoute("/operator/v1/reviews", {
  method: "GET",
  /**
   * Executes handler.
   *
   * @param c - Value supplied for `c`.
   * @returns The result produced by `handler`.
   * @throws Errors raised by validation or dependent operations.
   */
  handler: async (c) => c.json(await standaloneService.listReviews()),
});

const reviewDecision = registerApiRoute("/operator/v1/reviews/decision", {
  method: "POST",
  /**
   * Executes handler.
   *
   * @param c - Value supplied for `c`.
   * @returns The result produced by `handler`.
   * @throws Errors raised by validation or dependent operations.
   */
  handler: async (c) => {
    const body: unknown = await c.req.json().catch(() => undefined);
    const parsed = reviewDecisionInputSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "invalid_request", description: parsed.error.message }, 400);
    }
    return c.json(await standaloneService.decideReview(parsed.data));
  },
});

const retention = registerApiRoute("/operator/v1/retention/run", {
  method: "POST",
  /**
   * Executes handler.
   *
   * @param c - Value supplied for `c`.
   * @returns The result produced by `handler`.
   * @throws Errors raised by validation or dependent operations.
   */
  handler: async (c) => c.json(await standaloneService.runRetention()),
});

const exportWorkspace = registerApiRoute("/operator/v1/data/export", {
  method: "GET",
  /**
   * Executes handler.
   *
   * @param c - Value supplied for `c`.
   * @returns The result produced by `handler`.
   * @throws Errors raised by validation or dependent operations.
   */
  handler: async (c) => c.json(await standaloneService.exportWorkspace()),
});

const deleteWorkspace = registerApiRoute("/operator/v1/data", {
  method: "DELETE",
  /**
   * Executes handler.
   *
   * @param c - Value supplied for `c`.
   * @returns The result produced by `handler`.
   * @throws Errors raised by validation or dependent operations.
   */
  handler: async (c) => {
    if (c.req.header("x-entellix-confirm-delete") !== "delete-workspace") {
      return c.json(
        {
          error: "confirmation_required",
          description: "Set x-entellix-confirm-delete: delete-workspace.",
        },
        409,
      );
    }
    return c.json(await standaloneService.deleteWorkspace());
  },
});

export const standaloneRoutes = [
  health,
  reviews,
  reviewDecision,
  retention,
  exportWorkspace,
  deleteWorkspace,
];
