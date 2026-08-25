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
  readonly summary?: string;
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

const MATERIAL_IDENTITY_FIELDS = new Set([
  "agent-name",
  "persona-core",
  "stable-values",
]);
const IDENTITY_EVOLUTION_STATE_SCHEMA = "stella-fitness/identity-evolution-state/v1";

type PendingIdentityUpdate = {
  readonly updateId: string;
  readonly decision: "pending" | "deferred";
  readonly baseSourceRevision: string;
  readonly baseProjectionRevision: string;
  readonly baseManifestChecksum: string;
  readonly baseRecoveryToken?: string;
  readonly candidateSourceRevision: string;
  readonly candidateProjectionRevision: string;
  readonly candidateManifestChecksum: string;
  readonly changedFieldIds: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
};

type IdentityEvolutionState = {
  readonly schema_version: typeof IDENTITY_EVOLUTION_STATE_SCHEMA;
  readonly status: "ready" | "pending" | "stale" | "conflicted" | "degraded";
  readonly active: StoredFitnessIdentitySnapshot;
  readonly pending?: PendingIdentityUpdate;
  readonly reasonCode?: string;
  readonly conflicts?: readonly FitnessIdentityConflict[];
  readonly lastDecision?: {
    readonly updateId: string;
    readonly decision: "accepted" | "rejected" | "deferred";
    readonly decidedAt: string;
  };
  readonly lastDisclosureKey?: string;
  readonly updatedAt: string;
};

type IdentityEvolutionJournal = {
  readonly schema_version: "stella-fitness/identity-evolution-journal/v1";
  readonly phase: "prepared" | "published";
  readonly candidate: StoredFitnessIdentitySnapshot;
  readonly recoveryToken?: string;
  readonly lastDecision?: NonNullable<IdentityEvolutionState["lastDecision"]>;
  readonly updatedAt: string;
};

type IdentityEvolutionTestHooks = {
  readonly crashAfterPublication?: boolean;
};

export type FitnessIdentityEvolutionResult = {
  readonly status: IdentityEvolutionState["status"];
  readonly active: StoredFitnessIdentitySnapshot;
  readonly pending?: Omit<PendingIdentityUpdate, "candidate">;
  readonly reasonCode?: string;
  readonly conflicts?: readonly FitnessIdentityConflict[];
};

type StoredFitnessIdentityField = {
  readonly contentChecksum: string;
  readonly sourceReferenceIds: readonly string[];
};

type StoredFitnessIdentitySnapshot = Omit<FitnessIdentitySnapshot, "fields"> & {
  readonly fields: Readonly<Record<string, StoredFitnessIdentityField>>;
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
  retainLastVerified(input:
    | {
        readonly status: "stale" | "degraded";
        readonly reasonCode: string;
        readonly conflicts?: never;
      }
    | {
        readonly status: "conflicted";
        readonly reasonCode: string;
        readonly conflicts?: readonly FitnessIdentityConflict[];
      }
  ): Promise<FitnessIdentityEvolutionResult>;
  recover(currentCandidate?: FitnessIdentityPublicationCandidate): Promise<
    FitnessIdentityEvolutionResult | undefined
  >;
  diagnostics(): Promise<FitnessIdentityEvolutionResult | undefined>;
  claimDisclosure(
    disclosureKey: string,
  ): Promise<"first" | "changed" | "unchanged">;
};

export function createFitnessIdentityEvolutionCoordinator(options: {
  readonly runtimeDirectory: string;
  readonly publish: (
    candidate: FitnessIdentityPublicationCandidate,
  ) => Promise<{ readonly status: string; readonly reasonCode?: string }>;
  readonly captureRecoveryToken?: () => Promise<string | undefined>;
  readonly restore?: (
    recoveryToken: string,
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
      active: storedSnapshot(candidate),
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
        const diff = classifyStoredFitnessIdentityContextDiff(
          state.active,
          storedSnapshot(candidate),
        );
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
          const baseRecoveryToken = state.pending?.updateId === updateId
            ? state.pending.baseRecoveryToken
            : await options.captureRecoveryToken?.();
          const pending: PendingIdentityUpdate = {
            updateId,
            decision: state.pending?.updateId === updateId
              ? state.pending.decision
              : "pending",
            baseSourceRevision: state.active.sourceRevision,
            baseProjectionRevision: state.active.projectionRevision,
            baseManifestChecksum: state.active.manifestChecksum,
            ...(baseRecoveryToken === undefined ? {} : { baseRecoveryToken }),
            candidateSourceRevision: candidate.sourceRevision,
            candidateProjectionRevision: candidate.projectionRevision,
            candidateManifestChecksum: candidate.manifestChecksum,
            changedFieldIds: diff.changedFieldIds,
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
            state.lastDecision?.decision === decisionPastTense(input.decision) && (
              sameRevision(state.active, input.currentCandidate) ||
              (input.decision === "reject" &&
                state.lastDecision.updateId === identityUpdateId(
                  state.active,
                  input.currentCandidate,
                ))
            )
          ) return resultFromState(state);
          throw new Error("PENDING_IDENTITY_UPDATE_REQUIRED");
        }
        if (
          !pendingBaseMatches(state) ||
          state.pending.baseRecoveryToken !==
            await options.captureRecoveryToken?.() ||
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
            input.currentCandidate,
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
          ...(input.conflicts === undefined
            ? {}
            : { conflicts: input.conflicts.map(sanitizedConflict) }),
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
          currentCandidate === undefined
        ) {
          throw new Error("IDENTITY_RECOVERY_CANDIDATE_REQUIRED");
        }
        if (!sameRevision(journal.candidate, currentCandidate)) {
          if (journal.recoveryToken === undefined || options.restore === undefined) {
            throw new Error("IDENTITY_RECOVERY_RESTORE_REQUIRED");
          }
          const restoration = await options.restore(journal.recoveryToken);
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
          currentCandidate,
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
    claimDisclosure(disclosureKey) {
      return enqueue(async () => {
        if (disclosureKey.length === 0) throw new Error("DISCLOSURE_KEY_REQUIRED");
        const state = await requiredState(options.runtimeDirectory);
        if (state.lastDisclosureKey === disclosureKey) return "unchanged";
        const outcome = state.lastDisclosureKey === undefined ? "first" : "changed";
        await persistState(options.runtimeDirectory, {
          ...state,
          lastDisclosureKey: disclosureKey,
          updatedAt: now(options),
        });
        return outcome;
      });
    },
  };
}

export function classifyFitnessIdentityContextDiff(
  previous: FitnessIdentitySnapshot,
  candidate: FitnessIdentitySnapshot,
): FitnessIdentityContextDiff {
  return classifyStoredFitnessIdentityContextDiff(
    storedSnapshot(previous),
    storedSnapshot(candidate),
  );
}

function classifyStoredFitnessIdentityContextDiff(
  previous: StoredFitnessIdentitySnapshot,
  candidate: StoredFitnessIdentitySnapshot,
): FitnessIdentityContextDiff {
  const changedFieldIds = [...new Set([
    ...Object.keys(previous.fields),
    ...Object.keys(candidate.fields),
  ])].filter((id) => !storedFieldsEqual(
    previous.fields[id],
    candidate.fields[id],
  )).sort();
  if (candidate.conflicts.length > 0) {
    return {
      kind: "conflict",
      conflictIds: candidate.conflicts.map(({ id }) => id).sort(),
      changedFieldIds,
    };
  }
  if (changedFieldIds.some((id) => MATERIAL_IDENTITY_FIELDS.has(id))) {
    return { kind: "material", changedFieldIds };
  }
  if (
    candidate.retractions.length > 0 ||
    changedFieldIds.some((id) => candidate.fields[id] === undefined)
  ) {
    return { kind: "retraction", changedFieldIds };
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

function storedFieldsEqual(
  left: StoredFitnessIdentityField | undefined,
  right: StoredFitnessIdentityField | undefined,
): boolean {
  return left?.contentChecksum === right?.contentChecksum &&
    left?.sourceReferenceIds.join("\0") === right?.sourceReferenceIds.join("\0");
}

function storedSnapshot(
  snapshot: FitnessIdentitySnapshot,
): StoredFitnessIdentitySnapshot {
  return {
    sourceRevision: snapshot.sourceRevision,
    projectionRevision: snapshot.projectionRevision,
    manifestChecksum: snapshot.manifestChecksum,
    asOf: snapshot.asOf,
    freshness: snapshot.freshness,
    fields: Object.fromEntries(Object.entries(snapshot.fields).map(([id, field]) => [
      id,
      {
        contentChecksum: `sha256:${createHash("sha256")
          .update(field.content)
          .digest("hex")}`,
        sourceReferenceIds: [...field.sourceReferenceIds],
      },
    ])),
    conflicts: snapshot.conflicts.map(sanitizedConflict),
    retractions: snapshot.retractions.map((retraction) => ({ ...retraction })),
  };
}

function sanitizedConflict(
  conflict: FitnessIdentityConflict,
): FitnessIdentityConflict {
  return {
    id: conflict.id,
    sourceReferenceIds: [...conflict.sourceReferenceIds],
  };
}

async function publishAndCommit(
  options: {
    readonly runtimeDirectory: string;
    readonly publish: (
      candidate: FitnessIdentityPublicationCandidate,
    ) => Promise<{ readonly status: string; readonly reasonCode?: string }>;
    readonly captureRecoveryToken?: () => Promise<string | undefined>;
    readonly restore?: (
      recoveryToken: string,
    ) => Promise<{ readonly status: string; readonly reasonCode?: string }>;
    readonly now?: () => Date;
  },
  state: IdentityEvolutionState,
  candidate: FitnessIdentityPublicationCandidate,
  lastDecision?: IdentityEvolutionState["lastDecision"],
  testHooks?: IdentityEvolutionTestHooks,
): Promise<FitnessIdentityEvolutionResult> {
  const recoveryToken = await options.captureRecoveryToken?.();
  let journal: IdentityEvolutionJournal = {
    schema_version: "stella-fitness/identity-evolution-journal/v1",
    phase: "prepared",
    candidate: storedSnapshot(candidate),
    ...(recoveryToken === undefined ? {} : { recoveryToken }),
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
    active: storedSnapshot(candidate),
    ...(lastDecision === undefined ? {} : { lastDecision }),
    ...(state.lastDisclosureKey === undefined
      ? {}
      : { lastDisclosureKey: state.lastDisclosureKey }),
    updatedAt: now(options),
  };
  await persistState(options.runtimeDirectory, next);
  await clearJournal(options.runtimeDirectory);
  return resultFromState(next);
}

function sameRevision(
  left: Pick<FitnessIdentitySnapshot, "sourceRevision" | "projectionRevision" | "manifestChecksum">,
  right: Pick<FitnessIdentitySnapshot, "sourceRevision" | "projectionRevision" | "manifestChecksum">,
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
  active: Pick<FitnessIdentitySnapshot, "sourceRevision" | "projectionRevision" | "manifestChecksum">,
  candidate: Pick<FitnessIdentitySnapshot, "sourceRevision" | "projectionRevision" | "manifestChecksum">,
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
  if (!isIdentityEvolutionState(state)) {
    throw new Error("IDENTITY_EVOLUTION_STATE_INVALID");
  }
  await durableAtomicWrite(statePath(runtimeDirectory), canonicalizeJcs(state));
}

async function persistJournal(
  runtimeDirectory: string,
  journal: IdentityEvolutionJournal,
): Promise<void> {
  if (!isIdentityEvolutionJournal(journal)) {
    throw new Error("IDENTITY_EVOLUTION_JOURNAL_INVALID");
  }
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
  const record = exactRecord(value, [
    "schema_version", "status", "active", "pending", "reasonCode",
    "conflicts", "lastDecision", "lastDisclosureKey", "updatedAt",
  ], ["schema_version", "status", "active", "updatedAt"]);
  return record !== undefined &&
    record.schema_version === IDENTITY_EVOLUTION_STATE_SCHEMA &&
    (record.status === "ready" || record.status === "pending" ||
      record.status === "stale" || record.status === "conflicted" ||
      record.status === "degraded") &&
    isStoredFitnessIdentitySnapshot(record.active) &&
    (record.pending === undefined || isPendingIdentityUpdate(record.pending)) &&
    (record.reasonCode === undefined || typeof record.reasonCode === "string") &&
    (record.conflicts === undefined || isStoredConflicts(record.conflicts)) &&
    (record.lastDecision === undefined || isLastDecision(record.lastDecision)) &&
    (record.lastDisclosureKey === undefined ||
      typeof record.lastDisclosureKey === "string") &&
    stateInvariantHolds(record) &&
    typeof record.updatedAt === "string";
}

function isIdentityEvolutionJournal(value: unknown): value is IdentityEvolutionJournal {
  const record = exactRecord(value, [
    "schema_version", "phase", "candidate", "recoveryToken", "lastDecision",
    "updatedAt",
  ], ["schema_version", "phase", "candidate", "updatedAt"]);
  return record !== undefined &&
    record.schema_version === "stella-fitness/identity-evolution-journal/v1" &&
    (record.phase === "prepared" || record.phase === "published") &&
    isStoredFitnessIdentitySnapshot(record.candidate) &&
    (record.recoveryToken === undefined || typeof record.recoveryToken === "string") &&
    (record.lastDecision === undefined || isLastDecision(record.lastDecision)) &&
    typeof record.updatedAt === "string";
}

function isStoredFitnessIdentitySnapshot(
  value: unknown,
): value is StoredFitnessIdentitySnapshot {
  const record = exactRecord(value, [
    "sourceRevision", "projectionRevision", "manifestChecksum", "asOf",
    "freshness", "fields", "conflicts", "retractions",
  ], [
    "sourceRevision", "projectionRevision", "manifestChecksum", "asOf",
    "freshness", "fields", "conflicts", "retractions",
  ]);
  if (
    record === undefined ||
    typeof record.sourceRevision !== "string" ||
    typeof record.projectionRevision !== "string" ||
    typeof record.manifestChecksum !== "string" ||
    typeof record.asOf !== "string" ||
    (record.freshness !== "active" && record.freshness !== "stale") ||
    !isStoredConflicts(record.conflicts) ||
    !isStoredRetractions(record.retractions) ||
    typeof record.fields !== "object" || record.fields === null ||
    Array.isArray(record.fields)
  ) return false;
  return Object.entries(record.fields).every(([id, field]) => {
    const fieldRecord = exactRecord(
      field,
      ["contentChecksum", "sourceReferenceIds"],
      ["contentChecksum", "sourceReferenceIds"],
    );
    return id.length > 0 && fieldRecord !== undefined &&
      typeof fieldRecord.contentChecksum === "string" &&
      /^sha256:[a-f0-9]{64}$/u.test(fieldRecord.contentChecksum) &&
      isStringArray(fieldRecord.sourceReferenceIds);
  });
}

function isPendingIdentityUpdate(value: unknown): value is PendingIdentityUpdate {
  const record = exactRecord(value, [
    "updateId", "decision", "baseSourceRevision", "baseProjectionRevision",
    "baseManifestChecksum", "baseRecoveryToken", "candidateSourceRevision",
    "candidateProjectionRevision", "candidateManifestChecksum",
    "changedFieldIds", "createdAt", "updatedAt",
  ], [
    "updateId", "decision", "baseSourceRevision", "baseProjectionRevision",
    "baseManifestChecksum", "candidateSourceRevision",
    "candidateProjectionRevision", "candidateManifestChecksum",
    "changedFieldIds", "createdAt", "updatedAt",
  ]);
  return record !== undefined && typeof record.updateId === "string" &&
    (record.decision === "pending" || record.decision === "deferred") &&
    typeof record.baseSourceRevision === "string" &&
    typeof record.baseProjectionRevision === "string" &&
    typeof record.baseManifestChecksum === "string" &&
    (record.baseRecoveryToken === undefined ||
      typeof record.baseRecoveryToken === "string") &&
    typeof record.candidateSourceRevision === "string" &&
    typeof record.candidateProjectionRevision === "string" &&
    typeof record.candidateManifestChecksum === "string" &&
    isStringArray(record.changedFieldIds) &&
    typeof record.createdAt === "string" && typeof record.updatedAt === "string";
}

function stateInvariantHolds(record: Readonly<Record<string, unknown>>): boolean {
  if (record.status === "pending" && record.pending === undefined) return false;
  if (record.status === "ready" && record.pending !== undefined) return false;
  if (record.conflicts !== undefined && record.status !== "conflicted") return false;
  return true;
}

function isLastDecision(
  value: unknown,
): value is NonNullable<IdentityEvolutionState["lastDecision"]> {
  const record = exactRecord(
    value,
    ["updateId", "decision", "decidedAt"],
    ["updateId", "decision", "decidedAt"],
  );
  return record !== undefined && typeof record.updateId === "string" &&
    (record.decision === "accepted" || record.decision === "rejected" ||
      record.decision === "deferred") && typeof record.decidedAt === "string";
}

function isStoredConflicts(value: unknown): value is readonly FitnessIdentityConflict[] {
  return Array.isArray(value) && value.every((conflict) => {
    const record = exactRecord(
      conflict,
      ["id", "sourceReferenceIds"],
      ["id", "sourceReferenceIds"],
    );
    return record !== undefined && typeof record.id === "string" &&
      isStringArray(record.sourceReferenceIds);
  });
}

function isStoredRetractions(value: unknown): value is readonly FitnessIdentityRetraction[] {
  return Array.isArray(value) && value.every((retraction) => {
    const record = exactRecord(
      retraction,
      ["id", "sourceReferenceId", "retractedRevision"],
      ["id", "sourceReferenceId", "retractedRevision"],
    );
    return record !== undefined && typeof record.id === "string" &&
      typeof record.sourceReferenceId === "string" &&
      typeof record.retractedRevision === "string";
  });
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function exactRecord(
  value: unknown,
  allowedKeys: readonly string[],
  requiredKeys: readonly string[],
): Readonly<Record<string, unknown>> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Readonly<Record<string, unknown>>;
  const keys = Object.keys(record);
  return keys.every((key) => allowedKeys.includes(key)) &&
      requiredKeys.every((key) => Object.hasOwn(record, key))
    ? record
    : undefined;
}

function now(options: { readonly now?: () => Date }): string {
  return (options.now?.() ?? new Date()).toISOString();
}
