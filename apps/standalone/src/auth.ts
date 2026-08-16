import { timingSafeEqual } from "node:crypto";

import { z } from "zod";

const localTokenVerifierOptionsSchema = z.object({
  token: z.string().min(24),
  actorUserId: z.uuid(),
});

export type VerifiedLocalUser = z.infer<typeof verifiedLocalUserSchema>;
export const verifiedLocalUserSchema = z.object({ userId: z.uuid() });

export function tokenFromAuthorization(authorization: string): string | undefined {
  return authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : undefined;
}

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
