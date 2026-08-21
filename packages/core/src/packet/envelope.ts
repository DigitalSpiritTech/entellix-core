/**
 * Verifies caller context envelopes against trusted membership resolution.
 *
 * Inputs: Imported dependencies and values passed to the module's documented functions.
 * Outputs: Exported types, values, and behavior provided by the module.
 * Errors: Functions document validation, dependency, and runtime errors individually.
 *
 * @packageDocumentation
 */

import type {
  EnvelopeMembership,
  VerifiedEnvelope,
  VerifyContextEnvelopeData,
} from "@entellix/contracts/packet";

/**
 * Provider-neutral context-envelope verifier. The only trusted input
 * is the auth-derived `actorUserId`; the model-asserted org/entity ids are never
 * trusted. Membership resolution (injected) decides the org: an asserted org is
 * honoured only when the caller is an ACTIVE member of it, otherwise the
 * caller's own active org is used, otherwise the scope is null. Entity ids are
 * only ever those a server-side resolver returns — a forged id can never leak.
 */

export interface VerifyContextEnvelopeInput extends VerifyContextEnvelopeData {
  /** Injected: the caller's resolved memberships (server-side).
   *
   * @param userId - Value supplied for `userId`.
   * @returns The result produced by `resolveMembership`.
   * @throws Errors raised by validation or dependent operations.
   */
  resolveMembership: (userId: string) => readonly EnvelopeMembership[];
  /** Injected: resolves asserted entity ids to server-authorised ones.
   *
   * @param input - Value supplied for `input`.
   * @returns The result produced by `resolveEntityIds`.
   * @throws Errors raised by validation or dependent operations.
   */
  resolveEntityIds?: (input: {
    orgId: string;
    candidateIds: readonly string[];
  }) => readonly string[];
}

/**
 * Executes verify context envelope.
 *
 * @param input - Value supplied for `input`.
 * @returns The result produced by `verifyContextEnvelope`.
 * @throws Errors raised by validation or dependent operations.
 */
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
