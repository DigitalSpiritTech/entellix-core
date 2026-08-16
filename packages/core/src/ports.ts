import type { MemoryCandidate } from "@entellix/contracts/candidates";
import type { EnrichedCandidate } from "@entellix/contracts/classification";
import type { ConflictAnnotation } from "@entellix/contracts/conflicts";
import type {
  ApplyDispositionInput,
  PacketConflictWriteOptions,
  PersistBatchContext,
} from "@entellix/contracts/core-ports";
import type { ReviewLogEntry } from "@entellix/contracts/directive-precedence";
import type { DispositionRecord } from "@entellix/contracts/policy-matrix";
import type { ReconcileInput, ReconcileResult } from "@entellix/contracts/reconciler";

import type { ClassificationResult } from "./classifier.ts";
import type { ExtractionResult } from "./extractor.ts";
export type {
  ApplyDispositionInput,
  PacketConflictWriteOptions,
  PersistBatchContext,
} from "@entellix/contracts/core-ports";

export type PersistCandidatesPort = (
  result: ExtractionResult,
  context: PersistBatchContext,
) => Promise<MemoryCandidate[]>;

export type PersistClassificationPort = (
  result: ClassificationResult,
  lockedAt?: Date,
) => Promise<EnrichedCandidate>;

export type ApplyDispositionPort = (input: ApplyDispositionInput) => Promise<DispositionRecord>;

export type PersistConflictsPort = (
  annotations: ConflictAnnotation[],
  lockedAt?: Date,
) => Promise<void>;

export type PersistPacketConflictsPort = (
  entries: ReviewLogEntry[],
  options?: PacketConflictWriteOptions,
) => Promise<void>;

export type ReconcilePort = (input: ReconcileInput, lockedAt?: Date) => Promise<ReconcileResult>;

/** Persistence capabilities a host must supply to run the complete core engine. */
export interface CorePersistencePorts {
  persistCandidates: PersistCandidatesPort;
  persistClassification: PersistClassificationPort;
  applyDisposition: ApplyDispositionPort;
  persistConflicts: PersistConflictsPort;
  persistPacketConflicts: PersistPacketConflictsPort;
  reconcile: ReconcilePort;
}
