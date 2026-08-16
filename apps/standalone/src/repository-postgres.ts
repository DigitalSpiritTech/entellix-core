/* oxlint-disable no-await-in-loop */
import { createHash, randomUUID } from "node:crypto";

import type { MemoryCandidate } from "@entellix/contracts/candidates";
import type { Neighbor } from "@entellix/contracts/conflicts";
import {
  type ReviewDecisionResult,
  type ReviewQueueItem,
  reviewDecisionInputSchema,
} from "@entellix/contracts/reviews";
import { canonicalizeContent, deriveRowPolicies } from "@entellix/core/reconciler";
import postgres, { type Sql, type TransactionSql } from "postgres";
import { z } from "zod";

import {
  type CandidateGovernance,
  type CommitCandidateInput,
  type RecordStandaloneEventInput,
  type StandaloneEvent,
  type StandaloneMemory,
  STANDALONE_ACTOR_ID,
  STANDALONE_WORKSPACE_ID,
  candidateGovernanceSchema,
  eventReceiptSchema,
  recordStandaloneEventInputSchema,
  standaloneEventSchema,
  standaloneExportSchema,
  standaloneMemorySchema,
} from "./contracts.ts";
import type { StandaloneRepository } from "./repository.ts";

const postgresRepositoryOptionsSchema = z.object({
  databaseUrl: z.url(),
  actorUserId: z.uuid().default(STANDALONE_ACTOR_ID),
  workspaceId: z.uuid().default(STANDALONE_WORKSPACE_ID),
});

const eventRowSchema = z.object({
  id: z.uuid(),
  raw_event: z.string(),
  source_context: z.string().nullable(),
  source_type: z.enum(["mcp", "rest", "backfill", "hook", "webhook"]),
  source_trust_class: z.enum(["first_party", "external_included", "integration"]),
  status: z.enum(["queued", "processing", "completed", "failed"]),
  attempts: z.number().int(),
  error: z.string().nullable(),
  created_at: z.coerce.date(),
  updated_at: z.coerce.date(),
});

const candidateRowSchema = z.object({
  id: z.uuid(),
  source_event_id: z.uuid(),
  candidate_text: z.string(),
  provisional_type: z.enum([
    "fact",
    "preference",
    "directive",
    "decision",
    "task_state",
    "procedure",
    "episodic_event",
    "observation",
    "policy",
  ]),
  evidence_span: z.string(),
  reason_summary: z.string(),
  status: z.enum([
    "pending_classification",
    "classified",
    "committed",
    "rejected",
    "review",
    "expired",
  ]),
  extractor_version: z.string(),
  extractor_model: z.string(),
  classification: z.unknown().nullable(),
  disposition: z.unknown().nullable(),
  created_at: z.coerce.date(),
});

const memoryRowSchema = z.object({
  id: z.uuid(),
  source_candidate_id: z.uuid().nullable(),
  text: z.string(),
  scope: z.enum(["profile", "organization"]),
  status: z.enum(["active", "removed", "superseded", "expired"]),
  memory_type: z.enum([
    "fact",
    "preference",
    "directive",
    "decision",
    "task_state",
    "procedure",
    "episodic_event",
    "observation",
    "policy",
  ]),
  owner_scope_type: z.enum(["user", "org"]),
  render_policy: z.enum(["always", "retrieval", "pinned", "never"]),
  confidence: z.coerce.number(),
  source_authority: z.enum(["explicit", "inferred", "integration"]),
  sensitivity: z.enum(["normal", "sensitive", "secret"]),
  entity_ids: z.array(z.uuid()),
  embedding: z.array(z.number()).nullable(),
  valid_from: z.coerce.date(),
  valid_to: z.coerce.date().nullable(),
  expires_at: z.coerce.date().nullable(),
  superseded_by: z.uuid().nullable(),
  created_at: z.coerce.date(),
  updated_at: z.coerce.date(),
  lexical_score: z.coerce.number().optional(),
});

type QueryClient = Sql | TransactionSql;

function eventKey(input: RecordStandaloneEventInput): string {
  return createHash("sha256")
    .update(
      `${input.sourceType}\0${input.sessionId ?? ""}\0${input.messageId ?? ""}\0${input.rawEvent}`,
    )
    .digest("hex");
}

function toStandaloneEvent(row: unknown): StandaloneEvent {
  const value = eventRowSchema.parse(row);
  return standaloneEventSchema.parse({
    id: value.id,
    rawEvent: value.raw_event,
    sourceContext: value.source_context,
    sourceType: value.source_type,
    sourceTrustClass: value.source_trust_class,
    status: value.status,
    attempts: value.attempts,
    error: value.error,
    createdAt: value.created_at,
    updatedAt: value.updated_at,
  });
}

function toStandaloneMemory(row: unknown): StandaloneMemory {
  const value = memoryRowSchema.parse(row);
  return standaloneMemorySchema.parse({
    id: value.id,
    sourceCandidateId: value.source_candidate_id,
    text: value.text,
    scope: value.scope,
    status: value.status,
    memoryType: value.memory_type,
    ownerScopeType: value.owner_scope_type,
    renderPolicy: value.render_policy,
    confidence: value.confidence,
    sourceAuthority: value.source_authority,
    sensitivity: value.sensitivity,
    embedding: value.embedding,
    validFrom: value.valid_from,
    validTo: value.valid_to,
    expiresAt: value.expires_at,
    supersededBy: value.superseded_by,
    createdAt: value.created_at,
    updatedAt: value.updated_at,
  });
}

function toCandidate(row: unknown, actorUserId: string, workspaceId: string): MemoryCandidate {
  const value = candidateRowSchema.parse(row);
  return {
    id: value.id,
    batchId: value.source_event_id,
    sourceEventIds: [value.source_event_id],
    actorUserId,
    activeOrgId: workspaceId,
    candidateText: value.candidate_text,
    provisionalType: value.provisional_type,
    evidenceSpan: value.evidence_span,
    reasonSummary: value.reason_summary,
    status: value.status,
    extractorVersion: value.extractor_version,
    model: value.extractor_model,
    createdAt: value.created_at.toISOString(),
  };
}

function cosine(left: number[] | null, right: number[] | undefined): number {
  if (!left || !right || left.length !== right.length || left.length === 0) return 0;
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;
    dot += leftValue * rightValue;
    leftMagnitude += leftValue * leftValue;
    rightMagnitude += rightValue * rightValue;
  }
  const denominator = Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude);
  return denominator === 0 ? 0 : dot / denominator;
}

async function commitWithClient(
  sql: QueryClient,
  input: CommitCandidateInput,
): Promise<StandaloneMemory | null> {
  const [existing] = await sql`
    SELECT * FROM memories WHERE source_candidate_id = ${input.candidate.id} LIMIT 1
  `;
  if (existing) return toStandaloneMemory(existing);

  if (input.operation === "NOOP") {
    await sql`
      UPDATE memory_candidates SET status = 'committed', updated_at = ${input.now}
      WHERE id = ${input.candidate.id}
    `;
    return null;
  }

  const classification = input.governance.classification;
  const policies = deriveRowPolicies(classification.memoryType, input.now);
  const canonical = canonicalizeContent({
    text: input.candidate.candidateText,
    memoryType: classification.memoryType,
  });
  let text = canonical;
  let target: StandaloneMemory | undefined;
  if (input.targetMemoryId) {
    const [targetRow] = await sql`
      SELECT * FROM memories WHERE id = ${input.targetMemoryId} AND status = 'active' FOR UPDATE
    `;
    if (!targetRow) throw new Error(`active target memory '${input.targetMemoryId}' not found`);
    target = toStandaloneMemory(targetRow);
    if (input.operation === "MERGE") text = `${target.text} ${canonical}`;
  }

  const memoryId = randomUUID();
  const entityIds = classification.entityLinks.map((link) => link.entityId);
  const [row] = await sql`
    INSERT INTO memories (
      id, source_candidate_id, text, scope, status, memory_type, owner_scope_type,
      render_policy, confidence, source_authority, sensitivity, entity_ids, embedding,
      valid_from, expires_at, created_at, updated_at
    ) VALUES (
      ${memoryId}, ${input.candidate.id}, ${text},
      ${classification.owner.value === "user" ? "profile" : "organization"}, 'active',
      ${classification.memoryType}, ${classification.owner.value}, ${policies.renderPolicy},
      ${classification.confidence}, ${classification.sourceAuthority},
      ${classification.sensitivity.level}, ${sql.array(entityIds)},
      ${input.embedding ? sql.array(input.embedding) : null}, ${input.now},
      ${policies.expiresAt}, ${input.now}, ${input.now}
    )
    RETURNING *
  `;
  if (target) {
    await sql`
      UPDATE memories
      SET status = 'superseded', valid_to = ${input.now}, superseded_by = ${memoryId},
          updated_at = ${input.now}
      WHERE id = ${target.id}
    `;
  }
  await sql`
    UPDATE memory_candidates SET status = 'committed', updated_at = ${input.now}
    WHERE id = ${input.candidate.id}
  `;
  return toStandaloneMemory(row);
}

export function createPostgresStandaloneRepository(
  rawOptions: z.input<typeof postgresRepositoryOptionsSchema>,
): StandaloneRepository {
  const options = postgresRepositoryOptionsSchema.parse(rawOptions);
  const sql = postgres(options.databaseUrl, { max: 10 });

  return {
    async recordEvent(rawInput) {
      const input = recordStandaloneEventInputSchema.parse(rawInput);
      const id = randomUUID();
      const key = eventKey(input);
      const rows = await sql`
        INSERT INTO memory_events (
          id, raw_event, source_context, source_type, source_trust_class, idempotency_key
        ) VALUES (
          ${id}, ${input.rawEvent}, ${input.sourceContext ?? null}, ${input.sourceType},
          ${input.sourceTrustClass ?? "first_party"}, ${key}
        )
        ON CONFLICT (idempotency_key) DO NOTHING
        RETURNING id
      `;
      if (rows[0]) return eventReceiptSchema.parse({ eventId: rows[0].id, deduped: false });
      const [existing] = await sql`SELECT id FROM memory_events WHERE idempotency_key = ${key}`;
      return eventReceiptSchema.parse({ eventId: existing?.id, deduped: true });
    },
    async claimNextEvent() {
      return sql.begin(async (tx) => {
        const [row] = await tx`
          SELECT * FROM memory_events
          WHERE status IN ('queued', 'failed') AND attempts < 5
          ORDER BY created_at
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        `;
        if (!row) return null;
        const [claimed] = await tx`
          UPDATE memory_events
          SET status = 'processing', attempts = attempts + 1, error = NULL, updated_at = now()
          WHERE id = ${row.id}
          RETURNING *
        `;
        return toStandaloneEvent(claimed);
      });
    },
    async completeEvent(eventId) {
      await sql`
        UPDATE memory_events SET status = 'completed', error = NULL, updated_at = now()
        WHERE id = ${eventId}
      `;
    },
    async failEvent(eventId, error) {
      const message = error instanceof Error ? error.message : String(error);
      await sql`
        UPDATE memory_events SET status = 'failed', error = ${message.slice(0, 2000)}, updated_at = now()
        WHERE id = ${eventId}
      `;
    },
    async persistCandidates(event, extraction, actorUserId, workspaceId) {
      const result: MemoryCandidate[] = [];
      for (const [index, candidate] of extraction.candidates.entries()) {
        const id = randomUUID();
        const [row] = await sql`
          INSERT INTO memory_candidates (
            id, source_event_id, candidate_index, candidate_text, provisional_type,
            evidence_span, reason_summary, status, extractor_version, extractor_model
          ) VALUES (
            ${id}, ${event.id}, ${index}, ${candidate.candidateText}, ${candidate.provisionalType},
            ${candidate.evidenceSpan}, ${candidate.reasonSummary}, 'pending_classification',
            ${extraction.promptVersion}, ${extraction.model}
          )
          ON CONFLICT (source_event_id, candidate_index) DO UPDATE
          SET updated_at = memory_candidates.updated_at
          RETURNING *
        `;
        result.push(toCandidate(row, actorUserId, workspaceId));
      }
      return result;
    },
    async persistCandidateDecision(input) {
      await sql`
        UPDATE memory_candidates
        SET classification = ${sql.json(input.governance.classification)},
            disposition = ${sql.json(input.governance.decision)}, status = ${input.status},
            updated_at = now()
        WHERE id = ${input.candidateId}
      `;
    },
    async findNeighbors(candidate, governance) {
      const entityIds = governance.classification.entityLinks.map((link) => link.entityId);
      if (entityIds.length === 0) return [];
      const ownerScope = governance.classification.owner.value;
      const rows = await sql`
        SELECT *, ts_rank_cd(to_tsvector('english', text), plainto_tsquery('english', ${candidate.candidateText})) AS lexical_score
        FROM memories
        WHERE status = 'active' AND owner_scope_type = ${ownerScope}
          AND entity_ids && ${sql.array(entityIds)}::uuid[]
        ORDER BY lexical_score DESC, updated_at DESC
        LIMIT 10
      `;
      return rows.map((row): Neighbor => {
        const parsed = memoryRowSchema.parse(row);
        return {
          memoryId: parsed.id,
          content: parsed.text,
          memoryType: parsed.memory_type,
          ownerScopeType: parsed.owner_scope_type,
          ownerScopeId:
            parsed.owner_scope_type === "user"
              ? candidate.actorUserId
              : (candidate.activeOrgId ?? candidate.actorUserId),
          entityIds: parsed.entity_ids,
          similarity: parsed.lexical_score ?? 0,
        };
      });
    },
    async commitCandidate(input) {
      return sql.begin((tx) => commitWithClient(tx, input));
    },
    async searchMemories(query, limit, queryEmbedding) {
      const rows = await sql`
        SELECT *, ts_rank_cd(to_tsvector('english', text), plainto_tsquery('english', ${query})) AS lexical_score
        FROM memories
        WHERE status = 'active' AND render_policy <> 'never'
        ORDER BY lexical_score DESC, updated_at DESC
        LIMIT ${Math.max(limit, 100)}
      `;
      return rows
        .map((row) => {
          const parsed = memoryRowSchema.parse(row);
          return {
            memory: toStandaloneMemory(parsed),
            score: (parsed.lexical_score ?? 0) + cosine(parsed.embedding, queryEmbedding),
          };
        })
        .toSorted((left, right) => right.score - left.score)
        .slice(0, limit)
        .map((item) => item.memory);
    },
    async listMemories(limit) {
      const rows = await sql`
        SELECT * FROM memories WHERE status = 'active' ORDER BY updated_at DESC LIMIT ${limit}
      `;
      return rows.map(toStandaloneMemory);
    },
    async listReviewQueue() {
      const rows = await sql`
        SELECT * FROM memory_candidates WHERE status = 'review' ORDER BY created_at LIMIT 100
      `;
      return rows.map((row): ReviewQueueItem => {
        const candidate = candidateRowSchema.parse(row);
        const state = candidateGovernanceSchema.parse({
          classification: candidate.classification,
          decision: candidate.disposition,
        });
        return {
          candidateId: candidate.id,
          candidateText: candidate.candidate_text,
          evidenceSpan: candidate.evidence_span,
          reasonSummary: candidate.reason_summary,
          suggestedType: state.classification.memoryType,
          suggestedOwner: state.classification.owner.value,
          suggestedAudienceKind: state.classification.audienceSuggestion.kind,
          sourceEventIds: [candidate.source_event_id],
          conflicts: [],
          whoWouldSee:
            state.classification.audienceSuggestion.kind === "private_to_owner"
              ? "Local operator only"
              : "This standalone workspace",
          disposition: state.decision.disposition,
          dispositionReason: state.decision.reason,
          createdAt: candidate.created_at.toISOString(),
        };
      });
    },
    async decideReview(rawInput, now) {
      const input = reviewDecisionInputSchema.parse(rawInput);
      return sql.begin(async (tx): Promise<ReviewDecisionResult> => {
        const [row] = await tx`
          SELECT * FROM memory_candidates WHERE id = ${input.candidateId} AND status = 'review' FOR UPDATE
        `;
        if (!row) throw new Error(`review candidate '${input.candidateId}' not found`);
        const parsed = candidateRowSchema.parse(row);
        const state = candidateGovernanceSchema.parse({
          classification: parsed.classification,
          decision: parsed.disposition,
        });
        const reviewId = randomUUID();
        await tx`
          INSERT INTO memory_reviews (id, candidate_id, action, note, decision)
          VALUES (${reviewId}, ${input.candidateId}, ${input.action}, ${input.note ?? null}, ${tx.json(input)})
        `;
        if (input.action === "reject" || input.action === "mark_sensitive") {
          const classification =
            input.action === "mark_sensitive"
              ? {
                  ...state.classification,
                  sensitivity: { ...state.classification.sensitivity, level: "sensitive" as const },
                }
              : state.classification;
          await tx`
            UPDATE memory_candidates
            SET status = ${input.action === "reject" ? "rejected" : "review"},
                classification = ${tx.json(classification)}, updated_at = ${now}
            WHERE id = ${input.candidateId}
          `;
          return {
            candidateId: input.candidateId,
            action: input.action,
            reviewId,
            reconcileOutcome: null,
          };
        }
        const candidate = toCandidate(parsed, options.actorUserId, options.workspaceId);
        const editedCandidate = input.edits?.content
          ? { ...candidate, candidateText: input.edits.content }
          : candidate;
        const ownerScopeType =
          input.action === "save_as_user_private"
            ? "user"
            : (input.edits?.ownerScopeType ?? state.classification.owner.value);
        const governance: CandidateGovernance = {
          ...state,
          classification: {
            ...state.classification,
            ...(input.edits?.memoryType ? { memoryType: input.edits.memoryType } : {}),
            owner: { ...state.classification.owner, value: ownerScopeType },
          },
        };
        const operation =
          input.action === "merge_with_existing"
            ? "MERGE"
            : input.action === "supersede_existing"
              ? "SUPERSEDE"
              : "ADD";
        const memory = await commitWithClient(tx, {
          candidate: editedCandidate,
          governance,
          operation,
          targetMemoryId: input.targetMemoryId ?? null,
          embedding: null,
          now,
        });
        return {
          candidateId: input.candidateId,
          action: input.action,
          reviewId,
          reconcileOutcome: { operation, memoryId: memory?.id ?? null },
        };
      });
    },
    async runRetention(cutoff, now) {
      const events = await sql`
        UPDATE memory_events
        SET raw_event = '[retained metadata only]', source_context = NULL,
            raw_redacted_at = ${now}, updated_at = ${now}
        WHERE created_at < ${cutoff} AND raw_redacted_at IS NULL
        RETURNING id
      `;
      const candidates = await sql`
        UPDATE memory_candidates
        SET evidence_span = '[retained metadata only]', evidence_redacted_at = ${now}, updated_at = ${now}
        WHERE created_at < ${cutoff} AND evidence_redacted_at IS NULL AND status <> 'review'
        RETURNING id
      `;
      const memories = await sql`
        UPDATE memories
        SET status = 'expired', valid_to = ${now}, updated_at = ${now}
        WHERE status = 'active' AND expires_at IS NOT NULL AND expires_at <= ${now}
        RETURNING id
      `;
      return {
        eventsRedacted: events.length,
        candidatesRedacted: candidates.length,
        memoriesExpired: memories.length,
      };
    },
    async exportWorkspace(workspaceId, now) {
      const [memoryRows, eventRows, candidates, reviews] = await Promise.all([
        sql`SELECT * FROM memories ORDER BY created_at`,
        sql`SELECT * FROM memory_events ORDER BY created_at`,
        sql`SELECT * FROM memory_candidates ORDER BY created_at`,
        sql`SELECT * FROM memory_reviews ORDER BY created_at`,
      ]);
      return standaloneExportSchema.parse({
        format: "entellix-standalone-export/v1",
        exportedAt: now.toISOString(),
        workspaceId,
        memories: memoryRows.map((row) => {
          const memory = toStandaloneMemory(row);
          return {
            id: memory.id,
            sourceCandidateId: memory.sourceCandidateId,
            text: memory.text,
            scope: memory.scope,
            status: memory.status,
            memoryType: memory.memoryType,
            ownerScopeType: memory.ownerScopeType,
            renderPolicy: memory.renderPolicy,
            confidence: memory.confidence,
            sourceAuthority: memory.sourceAuthority,
            sensitivity: memory.sensitivity,
            validFrom: memory.validFrom.toISOString(),
            validTo: memory.validTo?.toISOString() ?? null,
            expiresAt: memory.expiresAt?.toISOString() ?? null,
            supersededBy: memory.supersededBy,
            createdAt: memory.createdAt.toISOString(),
            updatedAt: memory.updatedAt.toISOString(),
          };
        }),
        events: eventRows.map((row) => {
          const event = eventRowSchema.parse(row);
          return {
            id: event.id,
            rawEvent: event.raw_event,
            sourceContext: event.source_context,
            sourceType: event.source_type,
            sourceTrustClass: event.source_trust_class,
            status: event.status,
            attempts: event.attempts,
            error: event.error,
            createdAt: event.created_at.toISOString(),
            updatedAt: event.updated_at.toISOString(),
          };
        }),
        candidates,
        reviews,
      });
    },
    async deleteWorkspace() {
      return sql.begin(async (tx) => {
        const [reviewCount, memoryCount, candidateCount, eventCount] = await Promise.all([
          tx`SELECT count(*)::int AS count FROM memory_reviews`,
          tx`SELECT count(*)::int AS count FROM memories`,
          tx`SELECT count(*)::int AS count FROM memory_candidates`,
          tx`SELECT count(*)::int AS count FROM memory_events`,
        ]);
        await tx`DELETE FROM memory_reviews`;
        await tx`DELETE FROM memories`;
        await tx`DELETE FROM memory_candidates`;
        await tx`DELETE FROM memory_events`;
        return {
          reviews: Number(reviewCount[0]?.count ?? 0),
          memories: Number(memoryCount[0]?.count ?? 0),
          candidates: Number(candidateCount[0]?.count ?? 0),
          events: Number(eventCount[0]?.count ?? 0),
        };
      });
    },
    async ping() {
      await sql`SELECT 1`;
    },
    close: () => sql.end(),
  };
}
