import type {
  EnvelopeMembership,
  VerifiedEnvelope,
  VerifyContextEnvelopeData,
} from "@entellix/contracts/packet";

/**
 * Provider-neutral context-envelope verifier (S3.1.3). PURE. The ONLY trusted input
 * is the auth-derived `actorUserId`; the model-asserted org/entity ids are never
 * trusted. Membership resolution (injected) decides the org: an asserted org is
 * honoured only when the caller is an ACTIVE member of it, otherwise the
 * caller's own active org is used, otherwise the scope is null. Entity ids are
 * only ever those a server-side resolver returns — a forged id can never leak.
 */

export interface VerifyContextEnvelopeInput extends VerifyContextEnvelopeData {
  /** Injected: the caller's resolved memberships (server-side). */
  resolveMembership: (userId: string) => readonly EnvelopeMembership[];
  /** Injected: resolves asserted entity ids to server-authorised ones. */
  resolveEntityIds?: (input: {
    orgId: string;
    candidateIds: readonly string[];
  }) => readonly string[];
}

export function verifyContextEnvelope(input: VerifyContextEnvelopeInput): VerifiedEnvelope {
  const active = input
    .resolveMembership(input.actorUserId)
    .filter((membership) => membership.status === "active");

  const assertedOrgId = input.asserted.orgId ?? null;
  let orgId: string | null = null;
  if (assertedOrgId !== null && active.some((m) => m.organizationId === assertedOrgId)) {
    orgId = assertedOrgId;
  } else if (active.length > 0) {
    orgId = active[0]!.organizationId;
  }

  let entityIds: string[] = [];
  if (orgId !== null && input.resolveEntityIds) {
    entityIds = [
      ...input.resolveEntityIds({ orgId, candidateIds: input.asserted.entityIds ?? [] }),
    ];
  }

  return {
    actorUserId: input.actorUserId,
    orgId,
    entityIds,
    verified: true,
  };
}
