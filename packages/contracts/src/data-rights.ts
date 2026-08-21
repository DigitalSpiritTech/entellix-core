/**
 * Defines portable export, retention, and deletion contracts with integrity metadata.
 *
 * Inputs: Imported dependencies and values passed to the module's documented functions.
 * Outputs: Exported types, values, and behavior provided by the module.
 * Errors: Functions document validation, dependency, and runtime errors individually.
 *
 * @packageDocumentation
 */

import { createHash } from "node:crypto";

import { z } from "zod";

export const DATA_RIGHTS_EXPORT_SCHEMA_VERSION = "entellix.data-rights.export/v1" as const;

/**
 * Every subject-owned raw, canonical, derived, projection, and telemetry class
 * known to the Brain schema. Keeping this vocabulary versioned with the export
 * contract makes omissions visible to tests and future migrations.
 */
export const DATA_RIGHTS_ARTIFACT_KINDS = [
  "user_access_state",
  "organization",
  "organization_handoff_receipt",
  "organization_client",
  "org_membership",
  "audience_policy",
  "entity",
  "entity_alias",
  "entity_edge",
  "memory_event",
  "memory_event_route",
  "memory_event_batch",
  "memory_event_batch_member",
  "retention_redaction_receipt",
  "memory_candidate",
  "memory_candidate_conflict",
  "memory_candidate_execution_audit",
  "memory_candidate_reconcile_result",
  "memory_session_close_receipt",
  "canonical_memory",
  "memory_version",
  "memory_entity_link",
  "memory_review",
  "memory_audit",
  "memory_embedding",
  "memory_ingestion_job",
  "projection_manifest",
  "retrieval_event",
  "tool_call_event",
  "event_intake_budget",
] as const;

export const dataRightsArtifactKindSchema = z.enum(DATA_RIGHTS_ARTIFACT_KINDS);
export const dataRightsScopeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("user"), id: z.uuid() }),
  z.object({ kind: z.literal("organization"), id: z.uuid() }),
]);
export const dataRightsArtifactOwnerSchema = dataRightsScopeSchema;

const jsonPrimitiveSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
export const dataRightsJsonValueSchema: z.ZodType<
  string | number | boolean | null | { [key: string]: unknown } | unknown[]
> = z.lazy(() =>
  z.union([
    jsonPrimitiveSchema,
    z.array(dataRightsJsonValueSchema),
    z.record(z.string(), dataRightsJsonValueSchema),
  ]),
);

export const dataRightsExportArtifactSchema = z.object({
  kind: dataRightsArtifactKindSchema,
  id: z.string().min(1),
  owner: dataRightsArtifactOwnerSchema,
  data: z.record(z.string(), dataRightsJsonValueSchema),
});

export const dataRightsExportSchema = z.object({
  schemaVersion: z.literal(DATA_RIGHTS_EXPORT_SCHEMA_VERSION),
  manifest: z.object({
    requestId: z.uuid(),
    scope: dataRightsScopeSchema,
    generatedAt: z.iso.datetime({ offset: true }),
    artifactCount: z.number().int().nonnegative(),
    checksum: z.string().regex(/^[a-f0-9]{64}$/),
  }),
  artifacts: z.array(dataRightsExportArtifactSchema),
});

export type DataRightsScope = z.infer<typeof dataRightsScopeSchema>;
export type DataRightsArtifactKind = z.infer<typeof dataRightsArtifactKindSchema>;
export type DataRightsExportArtifact = z.infer<typeof dataRightsExportArtifactSchema>;
export type DataRightsExport = z.infer<typeof dataRightsExportSchema>;

/** Locale-independent lexicographic ordering for checksummed export content.
 *
 * @param left - Value supplied for `left`.
 * @param right - Value supplied for `right`.
 * @returns The result produced by `compareDataRightsCanonicalStrings`.
 * @throws Errors raised by validation or dependent operations.
 */
export function compareDataRightsCanonicalStrings(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

/**
 * Executes canonicalize.
 *
 * @param value - Value supplied for `value`.
 * @returns The result produced by `canonicalize`.
 * @throws Errors raised by validation or dependent operations.
 */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .toSorted(([left], [right]) => compareDataRightsCanonicalStrings(left, right))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }
  return value;
}

/** Deterministic UTF-8 JSON used for both export delivery and checksums.
 *
 * @param document - Value supplied for `document`.
 * @returns The result produced by `serializeDataRightsExport`.
 * @throws Errors raised by validation or dependent operations.
 */
export function serializeDataRightsExport(document: DataRightsExport): string {
  return JSON.stringify(canonicalize(dataRightsExportSchema.parse(document)));
}

/**
 * Parses data rights export json.
 *
 * @param json - Value supplied for `json`.
 * @returns The result produced by `parseDataRightsExportJson`.
 * @throws Errors raised by validation or dependent operations.
 */
export function parseDataRightsExportJson(json: string): DataRightsExport {
  return verifyDataRightsExport(dataRightsExportSchema.parse(JSON.parse(json)));
}

/** The checksum covers the full document except the checksum field itself.
 *
 * @param document - Value supplied for `document`.
 * @returns The result produced by `checksumDataRightsExport`.
 * @throws Errors raised by validation or dependent operations.
 */
export function checksumDataRightsExport(
  document: Omit<DataRightsExport, "manifest"> & {
    manifest: Omit<DataRightsExport["manifest"], "checksum">;
  },
): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(document)))
    .digest("hex");
}

/** Verifies both the declared inventory size and checksum before consumption.
 *
 * @param document - Value supplied for `document`.
 * @returns The result produced by `verifyDataRightsExport`.
 * @throws Errors raised by validation or dependent operations.
 */
export function verifyDataRightsExport(document: DataRightsExport): DataRightsExport {
  const parsed = dataRightsExportSchema.parse(document);
  if (parsed.manifest.artifactCount !== parsed.artifacts.length) {
    throw Object.assign(new Error("data-rights export artifact count does not match manifest"), {
      code: "DATA_RIGHTS_EXPORT_ARTIFACT_COUNT_MISMATCH" as const,
    });
  }
  const { checksum, ...manifest } = parsed.manifest;
  const expected = checksumDataRightsExport({
    schemaVersion: parsed.schemaVersion,
    manifest,
    artifacts: parsed.artifacts,
  });
  if (checksum !== expected) {
    throw Object.assign(new Error("data-rights export checksum verification failed"), {
      code: "DATA_RIGHTS_EXPORT_CHECKSUM_MISMATCH" as const,
    });
  }
  return parsed;
}
