import { describe, expect, it } from "vitest";

import {
  AUDIENCE_POLICY_KINDS,
  ENTITY_TYPES,
  MEMORY_STATUSES,
  MEMORY_TYPES,
  ORG_KINDS,
  ORG_MEMBERSHIP_ROLES,
  ORG_MEMBERSHIP_STATUSES,
  OWNER_SCOPE_TYPES,
  RENDER_POLICIES,
  SENSITIVITIES,
  SOURCE_AUTHORITIES,
  SYSTEM_AUDIENCE_POLICY_IDS,
  audiencePolicyKindSchema,
  audiencePolicySchema,
  entityAliasSchema,
  entityEdgeSchema,
  entitySchema,
  entityTypeSchema,
  memoryStatusSchema,
  memoryTypeSchema,
  memoryV2FieldsSchema,
  orgMembershipSchema,
} from "../src/index.ts";

describe("v2 enum arrays", () => {
  it("defines exactly the v2 memory types in order", () => {
    expect(MEMORY_TYPES).toEqual([
      "fact",
      "preference",
      "directive",
      "decision",
      "task_state",
      "procedure",
      "episodic_event",
      "observation",
      "policy",
    ]);
  });

  it("defines exactly the v2 entity types in order", () => {
    expect(ENTITY_TYPES).toEqual([
      "client",
      "project",
      "product",
      "task",
      "repo",
      "person",
      "team",
      "procedure",
      "decision",
      "document",
      "metric",
      "concept",
    ]);
  });

  it("defines exactly the audience policy kinds in order", () => {
    expect(AUDIENCE_POLICY_KINDS).toEqual([
      "private_to_owner",
      "org_members",
      "org_admins",
      "project_members",
      "explicit_users",
      "system_only",
    ]);
  });

  it("defines the org kinds, membership roles, and statuses", () => {
    expect(ORG_KINDS).toEqual(["personal", "team", "client_workspace"]);
    expect(ORG_MEMBERSHIP_ROLES).toEqual(["owner", "admin", "member"]);
    expect(ORG_MEMBERSHIP_STATUSES).toEqual(["active", "invited", "revoked"]);
  });

  it("defines the owner scope types", () => {
    expect(OWNER_SCOPE_TYPES).toEqual(["user", "org"]);
  });

  it("defines the render policies", () => {
    expect(RENDER_POLICIES).toEqual(["always", "retrieval", "pinned", "never"]);
  });

  it("defines the source authorities and sensitivities", () => {
    expect(SOURCE_AUTHORITIES).toEqual(["explicit", "inferred", "integration"]);
    expect(SENSITIVITIES).toEqual(["normal", "sensitive", "secret"]);
  });
});

describe("MEMORY_STATUSES widening", () => {
  it("widens to the six v2 statuses while keeping v1 values in positions 0-1", () => {
    expect(MEMORY_STATUSES).toEqual([
      "active",
      "removed",
      "superseded",
      "expired",
      "pending_review",
      "rejected",
    ]);
    expect(MEMORY_STATUSES[0]).toBe("active");
    expect(MEMORY_STATUSES[1]).toBe("removed");
  });

  it("still parses the v1 statuses so existing consumers keep working", () => {
    expect(memoryStatusSchema.parse("active")).toBe("active");
    expect(memoryStatusSchema.parse("removed")).toBe("removed");
  });

  it("parses the newly added statuses", () => {
    expect(memoryStatusSchema.parse("superseded")).toBe("superseded");
    expect(memoryStatusSchema.parse("pending_review")).toBe("pending_review");
    expect(memoryStatusSchema.safeParse("archived").success).toBe(false);
  });
});

describe("v2 enum schemas", () => {
  it("rejects values outside the enums", () => {
    expect(memoryTypeSchema.safeParse("rumor").success).toBe(false);
    expect(entityTypeSchema.safeParse("spaceship").success).toBe(false);
    expect(audiencePolicyKindSchema.safeParse("everyone").success).toBe(false);
  });

  it("accepts valid enum values", () => {
    expect(memoryTypeSchema.parse("directive")).toBe("directive");
    expect(entityTypeSchema.parse("project")).toBe("project");
    expect(audiencePolicyKindSchema.parse("org_members")).toBe("org_members");
  });
});

describe("SYSTEM_AUDIENCE_POLICY_IDS", () => {
  it("pins the four well-known global system audience policy ids", () => {
    expect(SYSTEM_AUDIENCE_POLICY_IDS).toEqual({
      private_to_owner: "00000000-0000-4000-8000-0000000000a1",
      org_members: "00000000-0000-4000-8000-0000000000a2",
      org_admins: "00000000-0000-4000-8000-0000000000a3",
      system_only: "00000000-0000-4000-8000-0000000000a4",
    });
  });
});

const iso = "2026-06-11T10:00:00.000Z";

describe("audiencePolicySchema", () => {
  const validPolicy = {
    id: "00000000-0000-4000-8000-0000000000a2",
    kind: "org_members",
    organizationId: null,
    params: null,
    createdAt: iso,
    updatedAt: iso,
  };

  it("round-trips a valid system policy", () => {
    expect(audiencePolicySchema.parse(validPolicy)).toEqual(validPolicy);
  });

  it("accepts an org-scoped policy with json params", () => {
    const parsed = audiencePolicySchema.parse({
      ...validPolicy,
      kind: "explicit_users",
      organizationId: "0d9c8b7a-6f5e-4d3c-8b1a-9e8f7a6b5c4d",
      params: { user_ids: ["0d9c8b7a-6f5e-4d3c-8b1a-9e8f7a6b5c4d"] },
    });
    expect(parsed.kind).toBe("explicit_users");
  });

  it("rejects an unknown kind", () => {
    expect(audiencePolicySchema.safeParse({ ...validPolicy, kind: "everyone" }).success).toBe(
      false,
    );
  });
});

describe("entitySchema", () => {
  const validEntity = {
    id: "6f2b9a3e-9c1d-4a5b-8e7f-1a2b3c4d5e6f",
    ownerOrgId: "0d9c8b7a-6f5e-4d3c-8b1a-9e8f7a6b5c4d",
    linkedOrgId: null,
    type: "project",
    name: "Brain v2",
    description: null,
    archivedAt: null,
    createdAt: iso,
    updatedAt: iso,
  };

  it("round-trips a valid entity", () => {
    expect(entitySchema.parse(validEntity)).toEqual(validEntity);
  });

  it("rejects an unknown entity type", () => {
    expect(entitySchema.safeParse({ ...validEntity, type: "spaceship" }).success).toBe(false);
  });
});

describe("entityAliasSchema", () => {
  it("round-trips a valid alias", () => {
    const validAlias = {
      id: "6f2b9a3e-9c1d-4a5b-8e7f-1a2b3c4d5e6f",
      entityId: "0d9c8b7a-6f5e-4d3c-8b1a-9e8f7a6b5c4d",
      alias: "Entellix Brain",
      source: null,
      createdAt: iso,
      updatedAt: iso,
    };
    expect(entityAliasSchema.parse(validAlias)).toEqual(validAlias);
  });
});

describe("entityEdgeSchema", () => {
  it("round-trips a valid edge", () => {
    const validEdge = {
      id: "6f2b9a3e-9c1d-4a5b-8e7f-1a2b3c4d5e6f",
      fromEntityId: "0d9c8b7a-6f5e-4d3c-8b1a-9e8f7a6b5c4d",
      toEntityId: "1a2b3c4d-5e6f-4a5b-8e7f-6f2b9a3e9c1d",
      edgeType: "belongs_to",
      validFrom: iso,
      validTo: null,
      metadata: null,
      createdAt: iso,
      updatedAt: iso,
    };
    expect(entityEdgeSchema.parse(validEdge)).toEqual(validEdge);
  });
});

describe("orgMembershipSchema", () => {
  const validMembership = {
    id: "6f2b9a3e-9c1d-4a5b-8e7f-1a2b3c4d5e6f",
    organizationId: "0d9c8b7a-6f5e-4d3c-8b1a-9e8f7a6b5c4d",
    userId: "1a2b3c4d-5e6f-4a5b-8e7f-6f2b9a3e9c1d",
    role: "owner",
    status: "active",
    createdAt: iso,
    updatedAt: iso,
  };

  it("round-trips a valid membership", () => {
    expect(orgMembershipSchema.parse(validMembership)).toEqual(validMembership);
  });

  it("rejects an unknown role or status", () => {
    expect(orgMembershipSchema.safeParse({ ...validMembership, role: "superadmin" }).success).toBe(
      false,
    );
    expect(orgMembershipSchema.safeParse({ ...validMembership, status: "banned" }).success).toBe(
      false,
    );
  });
});

describe("memoryV2FieldsSchema", () => {
  it("accepts an empty object because every v2 field is optional", () => {
    expect(memoryV2FieldsSchema.parse({}).ownerScopeType).toBeUndefined();
  });

  it("round-trips a fully populated set of v2 fields", () => {
    const fields = {
      ownerScopeType: "org",
      ownerScopeId: "0d9c8b7a-6f5e-4d3c-8b1a-9e8f7a6b5c4d",
      subjectEntityId: "1a2b3c4d-5e6f-4a5b-8e7f-6f2b9a3e9c1d",
      memoryType: "fact",
      content: "Ted prefers schemas then failing tests then code",
      contentVerbatim: "schemas -> failing tests -> code",
      renderPolicy: "retrieval",
      audiencePolicyId: "00000000-0000-4000-8000-0000000000a2",
      confidence: 0.9,
      sourceAuthority: "explicit",
      sensitivity: "normal",
      validFrom: iso,
      validTo: null,
      expiresAt: null,
      supersededBy: null,
    };
    expect(memoryV2FieldsSchema.parse(fields)).toMatchObject(fields);
  });

  it("rejects an invalid owner scope type", () => {
    expect(memoryV2FieldsSchema.safeParse({ ownerScopeType: "team" }).success).toBe(false);
  });

  it("rejects an invalid memory type", () => {
    expect(memoryV2FieldsSchema.safeParse({ memoryType: "rumor" }).success).toBe(false);
  });
});
