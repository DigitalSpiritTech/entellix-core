import { reviewDecisionInputSchema } from "@entellix/contracts/reviews";
import { registerApiRoute } from "@mastra/core/server";

import { standaloneRepository, standaloneService } from "../runtime.ts";

const health = registerApiRoute("/healthz", {
  method: "GET",
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
  handler: async (c) => c.json(await standaloneService.listReviews()),
});

const reviewDecision = registerApiRoute("/operator/v1/reviews/decision", {
  method: "POST",
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
  handler: async (c) => c.json(await standaloneService.runRetention()),
});

const exportWorkspace = registerApiRoute("/operator/v1/data/export", {
  method: "GET",
  handler: async (c) => c.json(await standaloneService.exportWorkspace()),
});

const deleteWorkspace = registerApiRoute("/operator/v1/data", {
  method: "DELETE",
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
