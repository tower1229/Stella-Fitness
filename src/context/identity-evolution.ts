import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { ManagedAgentArtifactInput } from "../agent-workspace/manager.js";
import { canonicalizeJcs } from "./runtime-contract.js";

export type FitnessIdentityField = {
  readonly content: string;
  readonly sourceReferenceIds: readonly string[];
};

export type FitnessIdentityConflict = {
  readonly id: string;
  readonly sourceReferenceIds: readonly string[];
  readonly summary: string;
};

export type FitnessIdentityRetraction = {
  readonly id: string;
  readonly sourceReferenceId: string;
  readonly retractedRevision: string;
};

export type FitnessIdentitySnapshot = {
  readonly sourceRevision: string;
  readonly projectionRevision: string;
  readonly manifestChecksum: string;
  readonly asOf: string;
  readonly freshness: "active" | "stale";
  readonly fields: Readonly<Record<string, FitnessIdentityField>>;
  readonly conflicts: readonly FitnessIdentityConflict[];
  readonly retractions: readonly FitnessIdentityRetraction[];
};

export type FitnessIdentityPublicationCandidate = FitnessIdentitySnapshot & {
  readonly artifacts: readonly ManagedAgentArtifactInput[];
  readonly disclosure: string;
  readonly contextCompleteness: "complete" | "degraded";
};

export type FitnessIdentityContextDiff =
  | { readonly kind: "none"; readonly changedFieldIds: readonly [] }
  | {
      readonly kind: "minor" | "material" | "retraction";
      readonly changedFieldIds: readonly string[];
    }
  | {
      readonly kind: "conflict";
      readonly conflictIds: readonly string[];
      readonly changedFieldIds: readonly string[];
    };

const MATERIAL_IDENTITY_FIELDS = new Set(["agent-name", "persona-core"]);
const IDENTITY_EVOLUTION_STATE_SCHEMA = "stella-fitness/identity-evolution-state/v1";

type PendingIdentityUpdate = {
  readonly updateId: string;
  readonly decision: "pending" | "deferred";
  readonly baseSourceRevision: string;
  readonly baseProjectionRevision: string;
  readonly baseManifestChecksum: string;
  readonly candidateSourceRevision: string;
  readonly candidateProjectionRevision: string;
  readonly candidateManifestChecksum: string;
  readonly changedFieldIds: readonly string[];
  readonly candidate: FitnessIdentityPublicationCandidate;
  readonly createdAt: string;
  readonly updatedAt: string;
};

type IdentityEvolutionState = {
  readonly schema_version: typeof IDENTITY_EVOLUTION_STATE_SCHEMA;
  readonly status: "ready" | "pending" | "stale" | "conflicted" | "degraded";
  readonly active: FitnessIdentityPublicationCandidate;
  readonly pending?: PendingIdentityUpdate;
  readonly reasonCode?: string;
  readonly conflicts?: readonly FitnessIdentityConflict[];
  readonly lastDecision?: {
    readonly updateId: string;
    readonly decision: "accepted" | "rejected" | "deferred";
    readonly decidedAt: string;
  };
  readonly updatedAt: string;
};

type IdentityEvolutionJournal = {
  readonly schema_version: "stella-fitness/identity-evolution-journal/v1";
  readonly phase: "prepared" | "published";
  readonly candidate: FitnessIdentityPublicationCandidate;
  readonly lastDecision?: NonNullable<IdentityEvolutionState["lastDecision"]>;
  readonly updatedAt: string;
};

type IdentityEvolutionTestHooks = {
  readonly crashAfterPublication?: boolean;
};

export type FitnessIdentityEvolutionResult = {
  readonly status: IdentityEvolutionState["status"];
  readonly active: FitnessIdentitySnapshot;
  readonly pending?: Omit<PendingIdentityUpdate, "candidate">;
  readonly reasonCode?: string;
  readonly conflicts?: readonly FitnessIdentityConflict[];
};

export type FitnessIdentityEvolutionCoordinator = {
  recordPublished(candidate: FitnessIdentityPublicationCandidate): Promise<
    FitnessIdentityEvolutionResult
  >;
  reconcile(candidate: FitnessIdentityPublicationCandidate, input?: {
    readonly forcePublication?: boolean;
    readonly testHooks?: IdentityEvolutionTestHooks;
  }): Promise<
    FitnessIdentityEvolutionResult
  >;
  decide(input: {
    readonly decision: "accept" | "reject" | "defer";
    readonly currentCandidate: FitnessIdentityPublicationCandidate;
    readonly testHooks?: IdentityEvolutionTestHooks;
  }): Promise<FitnessIdentityEvolutionResult>;
  retainLastVerified(input: {
    readonly status: "stale" | "conflicted" | "degraded";
    readonly reasonCode: string;
    readonly conflicts?: readonly FitnessIdentityConflict[];
  }): Promise<FitnessIdentityEvolutionResult>;
  recover(currentCandidate?: FitnessIdentityPublicationCandidate): Promise<
    FitnessIdentityEvolutionResult | undefined
  >;
  diagnostics(): Promise<FitnessIdentityEvolutionResult | undefined>;
};

export function createFitnessIdentityEvolutionCoordinator(options: {
  readonly runtimeDirectory: string;
  readonly publish: (
    candidate: FitnessIdentityPublicationCandidate,
  ) => Promise<{ readonly status: string; readonly reasonCode?: string }>;
  readonly now?: () => Date;
}): FitnessIdentityEvolutionCoordinator {
  let tail: Promise<void> = Promise.resolve();
  const enqueue = <Result>(operation: () => Promise<Result>): Promise<Result> => {
    const queued = tail.then(operation, operation);
    tail = queued.then(() => undefined, () => undefined);
    return queued;
  };
  const recordPublished = async (
    candidate: FitnessIdentityPublicationCandidate,
  ): Promise<FitnessIdentityEvolutionResult> => {
    const state: IdentityEvolutionState = {
      schema_version: IDENTITY_EVOLUTION_STATE_SCHEMA,
      status: candidate.freshness === "active" ? "ready" : "stale",
      active: candidate,
      updatedAt: now(options),
    };
    await persistState(options.runtimeDirectory, state);
    return resultFromState(state);
  };
  return {
    recordPublished(candidate) {
      return enqueue(() => recordPublished(candidate));
    },
    reconcile(candidate, input = {}) {
      return enqueue(async () => {
        const state = await readState(options.runtimeDirectory);
        if (state === undefined) return await recordPublished(candidate);
        const diff = classifyFitnessIdentityContextDiff(state.active, candidate);
        if (candidate.freshness === "stale") {
          const stale = { ...state, status: "stale" as const,
            reasonCode: "IDENTITY_CANDIDATE_STALE", updatedAt: now(options) };
          await persistState(options.runtimeDirectory, stale);
          return resultFromState(stale);
        }
        if (sameRevision(state.active, candidate)) {
          if (state.pending !== undefined) return resultFromState(state);
          if (input.forcePublication === true) {
            return await publishAndCommit(
              options,
              state,
              candidate,
              state.lastDecision,
              input.testHooks,
            );
          }
          const { reasonCode: _reasonCode, conflicts: _conflicts, ...verified } = state;
          const ready: IdentityEvolutionState = {
            ...verified,
            status: "ready",
            updatedAt: now(options),
          };
          await persistState(options.runtimeDirectory, ready);
          return resultFromState(ready);
        }
        if (diff.kind === "conflict") {
          const conflicted = { ...state, status: "conflicted" as const,
            reasonCode: "IDENTITY_SOURCE_CONFLICT", updatedAt: now(options) };
          await persistState(options.runtimeDirectory, conflicted);
          return resultFromState(conflicted);
        }
        if (diff.kind === "material") {
          const updateId = identityUpdateId(state.active, candidate);
          if (
            state.lastDecision?.updateId === updateId &&
            state.lastDecision.decision === "rejected"
          ) return resultFromState(state);
          const pending: PendingIdentityUpdate = {
            updateId,
            decision: state.pending?.updateId === updateId
              ? state.pending.decision
              : "pending",
            baseSourceRevision: state.active.sourceRevision,
            baseProjectionRevision: state.active.projectionRevision,
            baseManifestChecksum: state.active.manifestChecksum,
            candidateSourceRevision: candidate.sourceRevision,
            candidateProjectionRevision: candidate.projectionRevision,
            candidateManifestChecksum: candidate.manifestChecksum,
            changedFieldIds: diff.changedFieldIds,
            candidate,
            createdAt: state.pending?.updateId === updateId
              ? state.pending.createdAt
              : now(options),
            updatedAt: now(options),
          };
          const next = { ...state, status: "pending" as const, pending,
            reasonCode: "MATERIAL_IDENTITY_UPDATE_PENDING", updatedAt: now(options) };
          await persistState(options.runtimeDirectory, next);
          return resultFromState(next);
        }
        return await publishAndCommit(
          options,
          state,
          candidate,
          undefined,
          input.testHooks,
        );
      });
    },
    decide(input) {
      return enqueue(async () => {
        const state = await requiredState(options.runtimeDirectory);
        if (state.pending === undefined) {
          if (
            state.lastDecision?.decision === decisionPastTense(input.decision) &&
            sameRevision(state.active, input.currentCandidate)
          ) return resultFromState(state);
          throw new Error("PENDING_IDENTITY_UPDATE_REQUIRED");
        }
        if (
          !pendingBaseMatches(state) ||
          !pendingCandidateMatches(state.pending, input.currentCandidate)
        ) {
          const { pending: _pending, ...retained } = state;
          const invalid: IdentityEvolutionState = {
            ...retained,
            status: "conflicted",
            reasonCode: "IDENTITY_CONFIRMATION_INVALIDATED",
            updatedAt: now(options),
          };
          await persistState(options.runtimeDirectory, invalid);
          return resultFromState(invalid);
        }
        if (input.decision === "accept") {
          return await publishAndCommit(
            options,
            state,
            state.pending.candidate,
            {
              updateId: state.pending.updateId,
              decision: "accepted",
              decidedAt: now(options),
            },
            input.testHooks,
          );
        }
        const lastDecision = {
          updateId: state.pending.updateId,
          decision: decisionPastTense(input.decision),
          decidedAt: now(options),
        } as const;
        const next: IdentityEvolutionState = input.decision === "defer"
          ? { ...state, status: "pending", pending: {
              ...state.pending, decision: "deferred", updatedAt: now(options),
            }, lastDecision, updatedAt: now(options) }
          : rejectedState(state, lastDecision, now(options));
        await persistState(options.runtimeDirectory, next);
        return resultFromState(next);
      });
    },
    retainLastVerified(input) {
      return enqueue(async () => {
        const state = await requiredState(options.runtimeDirectory);
        const { conflicts: _conflicts, ...withoutConflicts } = state;
        const retained: IdentityEvolutionState = {
          ...withoutConflicts,
          status: input.status,
          reasonCode: input.reasonCode,
          ...(input.conflicts === undefined ? {} : { conflicts: input.conflicts }),
          updatedAt: now(options),
        };
        await persistState(options.runtimeDirectory, retained);
        return resultFromState(retained);
      });
    },
    recover(currentCandidate) {
      return enqueue(async () => {
        const journal = await readJournal(options.runtimeDirectory);
        if (journal === undefined) {
          const state = await readState(options.runtimeDirectory);
          return state === undefined ? undefined : resultFromState(state);
        }
        const state = await requiredState(options.runtimeDirectory);
        if (
          currentCandidate !== undefined &&
          !sameRevision(journal.candidate, currentCandidate)
        ) {
          const restoration = await options.publish(state.active);
          if (restoration.status !== "ready") {
            throw new Error(
              restoration.reasonCode ?? "IDENTITY_RECOVERY_RESTORE_FAILED",
            );
          }
          const { pending: _pending, ...retained } = state;
          const conflicted: IdentityEvolutionState = {
            ...retained,
            status: "conflicted",
            reasonCode: "IDENTITY_RECOVERY_CANDIDATE_DRIFT",
            updatedAt: now(options),
          };
          await persistState(options.runtimeDirectory, conflicted);
          await clearJournal(options.runtimeDirectory);
          return resultFromState(conflicted);
        }
        return await publishAndCommit(
          options,
          state,
          journal.candidate,
          journal.lastDecision,
        );
      });
    },
    diagnostics() {
      return enqueue(async () => {
        const state = await readState(options.runtimeDirectory);
        return state === undefined ? undefined : resultFromState(state);
      });
    },
  };
}

export function classifyFitnessIdentityContextDiff(
  previous: FitnessIdentitySnapshot,
  candidate: FitnessIdentitySnapshot,
): FitnessIdentityContextDiff {
  const changedFieldIds = [...new Set([
    ...Object.keys(previous.fields),
    ...Object.keys(candidate.fields),
  ])].filter((id) => !fieldsEqual(previous.fields[id], candidate.fields[id])).sort();
  if (candidate.conflicts.length > 0) {
    return {
      kind: "conflict",
      conflictIds: candidate.conflicts.map(({ id }) => id).sort(),
      changedFieldIds,
    };
  }
  if (
    candidate.retractions.length > 0 ||
    changedFieldIds.some((id) => candidate.fields[id] === undefined)
  ) {
    return { kind: "retraction", changedFieldIds };
  }
  if (changedFieldIds.some((id) => MATERIAL_IDENTITY_FIELDS.has(id))) {
    return { kind: "material", changedFieldIds };
  }
  if (
    changedFieldIds.length > 0 ||
    previous.sourceRevision !== candidate.sourceRevision ||
    previous.projectionRevision !== candidate.projectionRevision ||
    previous.manifestChecksum !== candidate.manifestChecksum
  ) {
    return { kind: "minor", changedFieldIds };
  }
  return { kind: "none", changedFieldIds: [] };
}

function fieldsEqual(
  left: FitnessIdentityField | undefined,
  right: FitnessIdentityField | undefined,
): boolean {
  return left?.content === right?.content &&
    left?.sourceReferenceIds.join("\0") === right?.sourceReferenceIds.join("\0");
}

async function publishAndCommit(
  options: {
    readonly runtimeDirectory: string;
    readonly publish: (
      candidate: FitnessIdentityPublicationCandidate,
    ) => Promise<{ readonly status: string; readonly reasonCode?: string }>;
    readonly now?: () => Date;
  },
  state: IdentityEvolutionState,
  candidate: FitnessIdentityPublicationCandidate,
  lastDecision?: IdentityEvolutionState["lastDecision"],
  testHooks?: IdentityEvolutionTestHooks,
): Promise<FitnessIdentityEvolutionResult> {
  let journal: IdentityEvolutionJournal = {
    schema_version: "stella-fitness/identity-evolution-journal/v1",
    phase: "prepared",
    candidate,
    ...(lastDecision === undefined ? {} : { lastDecision }),
    updatedAt: now(options),
  };
  await persistJournal(options.runtimeDirectory, journal);
  const publication = await options.publish(candidate);
  if (publication.status !== "ready") {
    const failed: IdentityEvolutionState = {
      ...state,
      status: publication.status === "conflicted" ? "conflicted" : "degraded",
      reasonCode: publication.reasonCode ?? "IDENTITY_PUBLICATION_INCOMPLETE",
      updatedAt: now(options),
    };
    await persistState(options.runtimeDirectory, failed);
    await clearJournal(options.runtimeDirectory);
    return resultFromState(failed);
  }
  journal = { ...journal, phase: "published", updatedAt: now(options) };
  await persistJournal(options.runtimeDirectory, journal);
  if (testHooks?.crashAfterPublication === true) {
    throw new Error("SIMULATED_IDENTITY_EVOLUTION_CRASH:published");
  }
  const next: IdentityEvolutionState = {
    schema_version: IDENTITY_EVOLUTION_STATE_SCHEMA,
    status: "ready",
    active: candidate,
    ...(lastDecision === undefined ? {} : { lastDecision }),
    updatedAt: now(options),
  };
  await persistState(options.runtimeDirectory, next);
  await clearJournal(options.runtimeDirectory);
  return resultFromState(next);
}

function sameRevision(
  left: FitnessIdentitySnapshot,
  right: FitnessIdentitySnapshot,
): boolean {
  return left.sourceRevision === right.sourceRevision &&
    left.projectionRevision === right.projectionRevision &&
    left.manifestChecksum === right.manifestChecksum;
}

function pendingBaseMatches(state: IdentityEvolutionState): boolean {
  const pending = state.pending;
  return pending !== undefined &&
    state.active.sourceRevision === pending.baseSourceRevision &&
    state.active.projectionRevision === pending.baseProjectionRevision &&
    state.active.manifestChecksum === pending.baseManifestChecksum;
}

function pendingCandidateMatches(
  pending: PendingIdentityUpdate,
  candidate: FitnessIdentityPublicationCandidate,
): boolean {
  return candidate.freshness === "active" &&
    candidate.sourceRevision === pending.candidateSourceRevision &&
    candidate.projectionRevision === pending.candidateProjectionRevision &&
    candidate.manifestChecksum === pending.candidateManifestChecksum;
}

function identityUpdateId(
  active: FitnessIdentitySnapshot,
  candidate: FitnessIdentitySnapshot,
): string {
  return `identity-update-${createHash("sha256").update(canonicalizeJcs({
    base_source_revision: active.sourceRevision,
    base_projection_revision: active.projectionRevision,
    base_manifest_checksum: active.manifestChecksum,
    candidate_source_revision: candidate.sourceRevision,
    candidate_projection_revision: candidate.projectionRevision,
    candidate_manifest_checksum: candidate.manifestChecksum,
  })).digest("hex")}`;
}

function decisionPastTense(
  decision: "accept" | "reject" | "defer",
): "accepted" | "rejected" | "deferred" {
  if (decision === "accept") return "accepted";
  if (decision === "reject") return "rejected";
  return "deferred";
}

function rejectedState(
  state: IdentityEvolutionState,
  lastDecision: NonNullable<IdentityEvolutionState["lastDecision"]>,
  updatedAt: string,
): IdentityEvolutionState {
  const {
    pending: _pending,
    reasonCode: _reasonCode,
    ...retained
  } = state;
  return { ...retained, status: "ready", lastDecision, updatedAt };
}

function resultFromState(
  state: IdentityEvolutionState,
): FitnessIdentityEvolutionResult {
  const pending = state.pending === undefined
    ? undefined
    : {
        updateId: state.pending.updateId,
        decision: state.pending.decision,
        baseSourceRevision: state.pending.baseSourceRevision,
        baseProjectionRevision: state.pending.baseProjectionRevision,
        baseManifestChecksum: state.pending.baseManifestChecksum,
        candidateSourceRevision: state.pending.candidateSourceRevision,
        candidateProjectionRevision: state.pending.candidateProjectionRevision,
        candidateManifestChecksum: state.pending.candidateManifestChecksum,
        changedFieldIds: state.pending.changedFieldIds,
        createdAt: state.pending.createdAt,
        updatedAt: state.pending.updatedAt,
      };
  return {
    status: state.status,
    active: state.active,
    ...(pending === undefined ? {} : { pending }),
    ...(state.reasonCode === undefined ? {} : { reasonCode: state.reasonCode }),
    ...(state.conflicts === undefined ? {} : { conflicts: state.conflicts }),
  };
}

async function requiredState(runtimeDirectory: string): Promise<IdentityEvolutionState> {
  const state = await readState(runtimeDirectory);
  if (state === undefined) throw new Error("IDENTITY_EVOLUTION_UNINITIALIZED");
  return state;
}

async function readState(
  runtimeDirectory: string,
): Promise<IdentityEvolutionState | undefined> {
  let bytes: Buffer;
  try {
    bytes = await readFile(statePath(runtimeDirectory));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error("IDENTITY_EVOLUTION_STATE_INVALID");
  }
  if (!isIdentityEvolutionState(value) || !canonicalizeJcs(value).equals(bytes)) {
    throw new Error("IDENTITY_EVOLUTION_STATE_INVALID");
  }
  return value;
}

async function persistState(
  runtimeDirectory: string,
  state: IdentityEvolutionState,
): Promise<void> {
  const path = statePath(runtimeDirectory);
  const directory = dirname(path);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = join(directory, `.tmp-${randomUUID()}`);
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(canonicalizeJcs(state));
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, path);
  const directoryHandle = await open(directory, "r");
  try {
    await directoryHandle.sync();
  } finally {
    await directoryHandle.close();
  }
}

async function persistJournal(
  runtimeDirectory: string,
  journal: IdentityEvolutionJournal,
): Promise<void> {
  await durableAtomicWrite(journalPath(runtimeDirectory), canonicalizeJcs(journal));
}

async function readJournal(
  runtimeDirectory: string,
): Promise<IdentityEvolutionJournal | undefined> {
  let bytes: Buffer;
  try {
    bytes = await readFile(journalPath(runtimeDirectory));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error("IDENTITY_EVOLUTION_JOURNAL_INVALID");
  }
  if (!isIdentityEvolutionJournal(value) || !canonicalizeJcs(value).equals(bytes)) {
    throw new Error("IDENTITY_EVOLUTION_JOURNAL_INVALID");
  }
  return value;
}

async function clearJournal(runtimeDirectory: string): Promise<void> {
  const path = journalPath(runtimeDirectory);
  await rm(path, { force: true });
  const handle = await open(dirname(path), "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function durableAtomicWrite(path: string, bytes: Buffer): Promise<void> {
  const directory = dirname(path);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = join(directory, `.tmp-${randomUUID()}`);
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, path);
  const directoryHandle = await open(directory, "r");
  try {
    await directoryHandle.sync();
  } finally {
    await directoryHandle.close();
  }
}

function statePath(runtimeDirectory: string): string {
  return join(runtimeDirectory, "identity-evolution", "state.json");
}

function journalPath(runtimeDirectory: string): string {
  return join(runtimeDirectory, "identity-evolution", "journal.json");
}

function isIdentityEvolutionState(value: unknown): value is IdentityEvolutionState {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Readonly<Record<string, unknown>>;
  return record.schema_version === IDENTITY_EVOLUTION_STATE_SCHEMA &&
    (record.status === "ready" || record.status === "pending" ||
      record.status === "stale" || record.status === "conflicted" ||
      record.status === "degraded") &&
    typeof record.active === "object" && record.active !== null &&
    typeof record.updatedAt === "string";
}

function isIdentityEvolutionJournal(value: unknown): value is IdentityEvolutionJournal {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Readonly<Record<string, unknown>>;
  return record.schema_version === "stella-fitness/identity-evolution-journal/v1" &&
    (record.phase === "prepared" || record.phase === "published") &&
    typeof record.candidate === "object" && record.candidate !== null &&
    typeof record.updatedAt === "string";
}

function now(options: { readonly now?: () => Date }): string {
  return (options.now?.() ?? new Date()).toISOString();
}
