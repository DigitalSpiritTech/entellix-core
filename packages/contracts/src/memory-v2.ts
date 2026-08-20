/**
 * Implements memory v2 behavior for this TypeScript module.
 *
 * Inputs: Imported dependencies and values passed to the module's documented functions.
 * Outputs: Exported types, values, and behavior provided by the module.
 * Errors: Functions document validation, dependency, and runtime errors individually.
 *
 * @packageDocumentation
 */

import { z } from "zod";

const isoDatetimeSchema = z.iso.datetime({ offset: true });

export const MEMORY_TYPES = [
  "fact",
  "preference",
  "directive",
  "decision",
  "task_state",
  "procedure",
  "episodic_event",
  "observation",
  "policy",
] as const;
export const memoryTypeSchema = z.enum(MEMORY_TYPES);
export type MemoryType = z.infer<typeof memoryTypeSchema>;

export const AUDIENCE_POLICY_KINDS = [
  "private_to_owner",
  "org_members",
  "org_admins",
  "project_members",
  "explicit_users",
  "system_only",
] as const;
export const audiencePolicyKindSchema = z.enum(AUDIENCE_POLICY_KINDS);
export type AudiencePolicyKind = z.infer<typeof audiencePolicyKindSchema>;

export const ORG_KINDS = ["personal", "team", "client_workspace"] as const;
export const orgKindSchema = z.enum(ORG_KINDS);
export type OrgKind = z.infer<typeof orgKindSchema>;

export const ORG_MEMBERSHIP_ROLES = ["owner", "admin", "member"] as const;
export const orgMembershipRoleSchema = z.enum(ORG_MEMBERSHIP_ROLES);
export type OrgMembershipRole = z.infer<typeof orgMembershipRoleSchema>;

export const ORG_MEMBERSHIP_STATUSES = ["active", "invited", "revoked"] as const;
export const orgMembershipStatusSchema = z.enum(ORG_MEMBERSHIP_STATUSES);
export type OrgMembershipStatus = z.infer<typeof orgMembershipStatusSchema>;

export const OWNER_SCOPE_TYPES = ["user", "org"] as const;
export const ownerScopeTypeSchema = z.enum(OWNER_SCOPE_TYPES);
export type OwnerScopeType = z.infer<typeof ownerScopeTypeSchema>;

export const RENDER_POLICIES = ["always", "retrieval", "pinned", "never"] as const;
export const renderPolicySchema = z.enum(RENDER_POLICIES);
export type RenderPolicy = z.infer<typeof renderPolicySchema>;

export const SOURCE_AUTHORITIES = ["explicit", "inferred", "integration"] as const;
export const sourceAuthoritySchema = z.enum(SOURCE_AUTHORITIES);
export type SourceAuthority = z.infer<typeof sourceAuthoritySchema>;

export const SENSITIVITIES = ["normal", "sensitive", "secret"] as const;
export const sensitivitySchema = z.enum(SENSITIVITIES);
export type Sensitivity = z.infer<typeof sensitivitySchema>;

/**
 * Well-known ids for the four globally-seeded system audience policies
 * (organization_id null). project_members / explicit_users policies are created
 * per-org with params and therefore have no fixed id here.
 */
export const SYSTEM_AUDIENCE_POLICY_IDS = {
  private_to_owner: "00000000-0000-4000-8000-0000000000a1",
  org_members: "00000000-0000-4000-8000-0000000000a2",
  org_admins: "00000000-0000-4000-8000-0000000000a3",
  system_only: "00000000-0000-4000-8000-0000000000a4",
} as const;

/**
 * Params are policy-kind-specific. user_ids (explicit_users) is validated as a
 * uuid array here so a malformed service-written row is caught at the contract
 * boundary; audience_allows() additionally guards the shape in SQL and denies
 * rather than throwing.
 */
export const audiencePolicyParamsSchema = z
  .object({
    user_ids: z.array(z.uuid()).optional(),
    project_entity_id: z.uuid().optional(),
  })
  .catchall(z.unknown());

export const audiencePolicySchema = z.object({
  id: z.uuid(),
  kind: audiencePolicyKindSchema,
  organizationId: z.uuid().nullable(),
  params: audiencePolicyParamsSchema.nullable(),
  createdAt: isoDatetimeSchema,
  updatedAt: isoDatetimeSchema,
});
export type AudiencePolicy = z.infer<typeof audiencePolicySchema>;

export const orgMembershipSchema = z.object({
  id: z.uuid(),
  organizationId: z.uuid(),
  userId: z.uuid(),
  role: orgMembershipRoleSchema,
  status: orgMembershipStatusSchema,
  createdAt: isoDatetimeSchema,
  updatedAt: isoDatetimeSchema,
});
export type OrgMembership = z.infer<typeof orgMembershipSchema>;

/**
 * The additive v2 columns on `memories`, all optional so v1 rows (which leave
 * them null) still parse. Shape enforcement (a v2 row must carry the required
 * subset together) lives in the DB `memories_v2_shape_check` constraint.
 */
export const memoryV2FieldsSchema = z.object({
  ownerScopeType: ownerScopeTypeSchema.optional(),
  ownerScopeId: z.uuid().optional(),
  subjectEntityId: z.uuid().nullable().optional(),
  memoryType: memoryTypeSchema.optional(),
  content: z.string().optional(),
  contentVerbatim: z.string().nullable().optional(),
  renderPolicy: renderPolicySchema.optional(),
  audiencePolicyId: z.uuid().optional(),
  confidence: z.number().optional(),
  sourceAuthority: sourceAuthoritySchema.optional(),
  sensitivity: sensitivitySchema.optional(),
  validFrom: isoDatetimeSchema.optional(),
  validTo: isoDatetimeSchema.nullable().optional(),
  expiresAt: isoDatetimeSchema.nullable().optional(),
  supersededBy: z.uuid().nullable().optional(),
});
export type MemoryV2Fields = z.infer<typeof memoryV2FieldsSchema>;
