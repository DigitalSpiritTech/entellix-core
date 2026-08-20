/**
 * Implements auth behavior for this TypeScript module.
 *
 * Inputs: Imported dependencies and values passed to the module's documented functions.
 * Outputs: Exported types, values, and behavior provided by the module.
 * Errors: Functions document validation, dependency, and runtime errors individually.
 *
 * @packageDocumentation
 */

import { timingSafeEqual } from "node:crypto";

import { z } from "zod";

const localTokenVerifierOptionsSchema = z.object({
  token: z.string().min(24),
  actorUserId: z.uuid(),
});

export type VerifiedLocalUser = z.infer<typeof verifiedLocalUserSchema>;
export const verifiedLocalUserSchema = z.object({ userId: z.uuid() });

/**
 * Executes token from authorization.
 *
 * @param authorization - Value supplied for `authorization`.
 * @returns The result produced by `tokenFromAuthorization`.
 * @throws Errors raised by validation or dependent operations.
 */
export function tokenFromAuthorization(authorization: string): string | undefined {
  return authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : undefined;
}

/**
 * Creates local token verifier.
 *
 * @param rawOptions - Value supplied for `rawOptions`.
 * @returns The result produced by `createLocalTokenVerifier`.
 * @throws Errors raised by validation or dependent operations.
 */
export function createLocalTokenVerifier(
  rawOptions: z.input<typeof localTokenVerifierOptionsSchema>,
) {
  const options = localTokenVerifierOptionsSchema.parse(rawOptions);
  const expected = Buffer.from(options.token);

  return async (token: string): Promise<VerifiedLocalUser> => {
    const actual = Buffer.from(token);
    const matches = actual.length === expected.length && timingSafeEqual(actual, expected);
    if (!matches) throw new Error("invalid token");
    return { userId: options.actorUserId };
  };
}
