import { randomUUID } from "node:crypto";
import {
  mkdir,
  open,
  readFile,
  rename,
  rm,
} from "node:fs/promises";
import { dirname, join } from "node:path";

import { canonicalizeJcs } from "./runtime-contract.js";

const CONTEXT_SYNC_STATE_SCHEMA = "stella-fitness/context-sync-state/v1";

export type FitnessContextSyncStatus =
  | "uninitialized"
  | "ready"
  | "degraded"
  | "stale"
  | "conflicted"
  | "standalone-degraded";

export type FitnessContextSyncPublication = {
  readonly sourceRevision: string;
  readonly projectionRevision: string;
  readonly manifestChecksum: string;
  readonly asOf: string;
};

export type FitnessContextSyncSource = {
  readonly sourceRevision: string;
  readonly asOf: string;
};

export type FitnessProjectionPointerSnapshot =
  | {
      readonly status: "active" | "stale";
      readonly sourceRevision: string;
      readonly projectionRevision: string;
      readonly manifestChecksum: string;
      readonly asOf: string;
    }
  | {
      readonly status: "blocked" | "revoked";
      readonly sourceRevision: string;
    };

export type FitnessContextSyncState = {
  readonly schema_version: typeof CONTEXT_SYNC_STATE_SCHEMA;
  readonly status: FitnessContextSyncStatus;
  readonly source_category: "fitness-canonical" | "runtime-identity" | "workspace";
  readonly source_revision?: string;
  readonly projection_revision?: string;
  readonly manifest_checksum?: string;
  readonly as_of?: string;
  readonly reason_code?: string;
  readonly recovery_action?: string;
  readonly attempt_count: number;
  readonly updated_at: string;
};

export type FitnessContextSyncResult = {
  readonly status: FitnessContextSyncStatus;
  readonly attempts: number;
  readonly sourceRevision?: string;
  readonly projectionRevision?: string;
  readonly manifestChecksum?: string;
  readonly asOf?: string;
  readonly reasonCode?: string;
};

export type FitnessContextSyncTrigger =
  | "startup"
  | "canonical-write"
  | "explicit"
  | "external-revision"
  | "retraction-recovery";

type FitnessProjectionPointerStatus = "blocked" | "revoked" | "stale";

type CoordinatorOptions = {
  readonly runtimeDirectory: string;
  readonly publish: (input: {
    readonly trigger: FitnessContextSyncTrigger;
    readonly signal: AbortSignal;
  }) => Promise<FitnessContextSyncPublication>;
  readonly inspectSource: () => Promise<FitnessContextSyncSource>;
  readonly readPointer?: () => Promise<FitnessProjectionPointerSnapshot | undefined>;
  readonly publishPointerStatus: (input: {
    readonly status: FitnessProjectionPointerStatus;
    readonly reasonCode: string;
    readonly sourceRevision: string;
    readonly changedAt: string;
  }) => Promise<void>;
  readonly restorePointer?: (input: {
    readonly pointer: FitnessProjectionPointerSnapshot | undefined;
    readonly expectedSourceRevision: string;
    readonly changedAt: string;
  }) => Promise<void>;
  readonly maxAttempts?: number;
  readonly now?: () => Date;
};

export type FitnessContextSyncCoordinator = {
  resync(input: {
    readonly trigger: FitnessContextSyncTrigger;
    readonly signal?: AbortSignal;
  }): Promise<FitnessContextSyncResult>;
  afterCanonicalWrite<Result>(
    result: Result,
    input?: { readonly signal?: AbortSignal },
  ): Promise<Result>;
  withRetraction<Result>(
    input: {
      readonly kind: "correction" | "deletion" | "retraction";
      readonly signal?: AbortSignal;
      readonly testHooks?: {
        readonly crashAfterPhase?: FitnessContextSyncJournalPhase;
      };
    },
    mutate: () => Promise<Result>,
  ): Promise<Result>;
  recover(input?: { readonly signal?: AbortSignal }): Promise<FitnessContextSyncResult>;
  checkForExternalRevision(input?: {
    readonly signal?: AbortSignal;
  }): Promise<FitnessContextSyncResult>;
  diagnostics(): Promise<FitnessContextSyncState>;
};

export type FitnessContextSyncJournalPhase =
  | "prepared"
  | "pointer-blocked"
  | "mutation-started"
  | "mutation-committed";

type FitnessContextSyncJournal = {
  readonly schema_version: "stella-fitness/context-sync-journal/v1";
  readonly operation_id: string;
  readonly kind: "correction" | "deletion" | "retraction";
  readonly phase: FitnessContextSyncJournalPhase;
  readonly before_source_revision: string;
  readonly before_as_of: string;
  readonly previous_pointer?: FitnessProjectionPointerSnapshot;
  readonly started_at: string;
  readonly updated_at: string;
};

export function createFitnessContextSyncCoordinator(
  options: CoordinatorOptions,
): FitnessContextSyncCoordinator {
  const maximumAttempts = options.maxAttempts ?? 3;
  if (!Number.isSafeInteger(maximumAttempts) || maximumAttempts < 1) {
    throw new Error("Context sync maxAttempts must be a positive integer");
  }
  let tail: Promise<void> = Promise.resolve();
  const enqueue = <Result>(operation: () => Promise<Result>): Promise<Result> => {
    const queued = tail.then(operation, operation);
    tail = queued.then(
      () => undefined,
      () => undefined,
    );
    return queued;
  };
  const refresh = async (input: {
    readonly trigger: FitnessContextSyncTrigger;
    readonly signal?: AbortSignal;
    readonly failedStatus?: "stale" | "degraded";
  }): Promise<FitnessContextSyncResult> => {
    const signal = input.signal ?? new AbortController().signal;
    let attempt = 0;
    let lastError: unknown;
    while (attempt < maximumAttempts) {
      throwIfAborted(signal);
      attempt += 1;
      try {
        const publication = await options.publish({
          trigger: input.trigger,
          signal,
        });
        const state: FitnessContextSyncState = {
          schema_version: CONTEXT_SYNC_STATE_SCHEMA,
          status: "ready",
          source_category: "fitness-canonical",
          source_revision: publication.sourceRevision,
          projection_revision: publication.projectionRevision,
          manifest_checksum: publication.manifestChecksum,
          as_of: publication.asOf,
          attempt_count: attempt,
          updated_at: now(options),
        };
        await persistState(options.runtimeDirectory, state);
        return resultFromState(state);
      } catch (error) {
        if (signal.aborted) throw abortError();
        lastError = error;
      }
    }
    let verifiedPointer: FitnessProjectionPointerSnapshot | undefined;
    try {
      verifiedPointer = await options.readPointer?.();
    } catch {
      const state: FitnessContextSyncState = {
        schema_version: CONTEXT_SYNC_STATE_SCHEMA,
        status: "conflicted",
        source_category: "fitness-canonical",
        reason_code: "PROJECTION_POINTER_INVALID",
        recovery_action: "inspect-projection-pointer-and-resync",
        attempt_count: attempt,
        updated_at: now(options),
      };
      await persistState(options.runtimeDirectory, state);
      return resultFromState(state);
    }
    let source: FitnessContextSyncSource;
    try {
      source = await options.inspectSource();
    } catch (error) {
      const invalidSource = isInvalidCanonicalSourceError(error);
      if (
        invalidSource &&
        (verifiedPointer?.status === "active" || verifiedPointer?.status === "stale")
      ) {
        try {
          await options.publishPointerStatus({
            status: "blocked",
            reasonCode: "CANONICAL_SOURCE_INVALID",
            sourceRevision: verifiedPointer.sourceRevision,
            changedAt: now(options),
          });
        } catch {
          // The local conflicted state still prevents this tuple being reported as fresh.
        }
      }
      const state: FitnessContextSyncState = {
        schema_version: CONTEXT_SYNC_STATE_SCHEMA,
        status: invalidSource ? "conflicted" : "degraded",
        source_category: "fitness-canonical",
        ...(verifiedPointer?.status === "active" || verifiedPointer?.status === "stale"
          ? {
              source_revision: verifiedPointer.sourceRevision,
              projection_revision: verifiedPointer.projectionRevision,
              manifest_checksum: verifiedPointer.manifestChecksum,
              as_of: verifiedPointer.asOf,
            }
          : {}),
        reason_code: invalidSource
          ? "CANONICAL_SOURCE_INVALID"
          : "CANONICAL_SOURCE_UNAVAILABLE",
        recovery_action: invalidSource
          ? "repair-canonical-source-and-resync"
          : "retry-on-startup-write-or-resync",
        attempt_count: attempt,
        updated_at: now(options),
      };
      await persistState(options.runtimeDirectory, state);
      return resultFromState(state);
    }
    if (verifiedPointer?.status === "active" || verifiedPointer?.status === "stale") {
      try {
        await options.publishPointerStatus({
          status: "stale",
          reasonCode: "PROJECTION_REFRESH_FAILED",
          sourceRevision: verifiedPointer.sourceRevision,
          changedAt: now(options),
        });
      } catch {
        // The persisted Context Sync State remains the local recovery authority.
      }
    }
    const lastVerified = verifiedPointer?.status === "active" ||
        verifiedPointer?.status === "stale"
      ? verifiedPointer
      : undefined;
    const pointerIsVerified = lastVerified !== undefined;
    const pointerIsBlocked = verifiedPointer?.status === "blocked";
    const state: FitnessContextSyncState = {
      schema_version: CONTEXT_SYNC_STATE_SCHEMA,
      status: input.failedStatus ??
        (pointerIsVerified ? "stale" : pointerIsBlocked ? "conflicted" : "degraded"),
      source_category: "fitness-canonical",
      source_revision: pointerIsVerified
        ? lastVerified.sourceRevision
        : source.sourceRevision,
      ...(pointerIsVerified
        ? {
            projection_revision: lastVerified.projectionRevision,
            manifest_checksum: lastVerified.manifestChecksum,
          }
        : {}),
      as_of: pointerIsVerified ? lastVerified.asOf : source.asOf,
      reason_code: pointerIsBlocked
        ? "PROJECTION_POINTER_BLOCKED"
        : verifiedPointer?.status === "revoked"
        ? "PROJECTION_POINTER_REVOKED"
        : "PROJECTION_REFRESH_FAILED",
      recovery_action: pointerIsBlocked || verifiedPointer?.status === "revoked"
        ? "inspect-projection-pointer-and-resync"
        : "retry-on-startup-write-or-resync",
      attempt_count: attempt,
      updated_at: now(options),
    };
    await persistState(options.runtimeDirectory, state);
    void lastError;
    return resultFromState(state);
  };
  const recoverJournal = async (
    signal: AbortSignal,
  ): Promise<FitnessContextSyncResult> => {
    const journal = await readJournal(options.runtimeDirectory);
    if (journal === undefined) {
      return {
        status: "uninitialized",
        attempts: 0,
      };
    }
    throwIfAborted(signal);
    if (journal.phase === "mutation-started") {
      return await persistBlockedRecoveryState(
        options,
        journal,
        "CANONICAL_MUTATION_RESULT_UNKNOWN",
      );
    }
    if (journal.phase === "mutation-committed") {
      if (journal.previous_pointer?.status === "revoked") {
        const result = await persistUnavailablePointerState(
          options,
          "revoked",
        );
        await clearJournal(options.runtimeDirectory);
        return result;
      }
      const result = await refresh({
        trigger: "retraction-recovery",
        signal,
        failedStatus: "degraded",
      });
      if (result.status === "ready") await clearJournal(options.runtimeDirectory);
      return result;
    }
    if (journal.previous_pointer?.status === "revoked") {
      const result = await persistUnavailablePointerState(options, "revoked");
      await clearJournal(options.runtimeDirectory);
      return result;
    }
    const source = await options.inspectSource();
    if (source.sourceRevision !== journal.before_source_revision) {
      return await persistBlockedRecoveryState(
        options,
        journal,
        "CANONICAL_SOURCE_CHANGED_DURING_RECOVERY",
      );
    }
    if (journal.phase === "pointer-blocked") {
      await requiredRestorePointer(options)({
        pointer: journal.previous_pointer,
        expectedSourceRevision: journal.before_source_revision,
        changedAt: now(options),
      });
    }
    await clearJournal(options.runtimeDirectory);
    return stateResultForPointer(journal.previous_pointer);
  };
  const runResync = async (input: {
    readonly trigger: FitnessContextSyncTrigger;
    readonly signal?: AbortSignal;
  }): Promise<FitnessContextSyncResult> => {
    const signal = input.signal ?? new AbortController().signal;
    return (await readJournal(options.runtimeDirectory)) === undefined
      ? await refresh(input)
      : await recoverJournal(signal);
  };
  const resync = (input: {
    readonly trigger: FitnessContextSyncTrigger;
    readonly signal?: AbortSignal;
  }): Promise<FitnessContextSyncResult> => enqueue(() => runResync(input));
  return {
    resync,
    async afterCanonicalWrite<Result>(
      result: Result,
      input: { readonly signal?: AbortSignal } = {},
    ): Promise<Result> {
      try {
        await resync({ trigger: "canonical-write", ...input });
      } catch {
        await persistUnexpectedFailureState(options).catch(() => undefined);
      }
      return result;
    },
    withRetraction<Result>(input: {
      readonly kind: "correction" | "deletion" | "retraction";
      readonly signal?: AbortSignal;
      readonly testHooks?: {
        readonly crashAfterPhase?: FitnessContextSyncJournalPhase;
      };
    }, mutate: () => Promise<Result>): Promise<Result> {
      return enqueue(async () => {
        const signal = input.signal ?? new AbortController().signal;
        throwIfAborted(signal);
        const before = await options.inspectSource();
        const previousPointer = await options.readPointer?.();
        if (previousPointer?.status === "blocked") {
          await persistUnavailablePointerState(options, "blocked");
          throw new Error("FITNESS_PROJECTION_POINTER_BLOCKED");
        }
        let journal: FitnessContextSyncJournal = {
          schema_version: "stella-fitness/context-sync-journal/v1",
          operation_id: randomUUID(),
          kind: input.kind,
          phase: "prepared",
          before_source_revision: before.sourceRevision,
          before_as_of: before.asOf,
          ...(previousPointer === undefined ? {} : { previous_pointer: previousPointer }),
          started_at: now(options),
          updated_at: now(options),
        };
        await persistJournal(options.runtimeDirectory, journal);
        crashAtPhase(input.testHooks?.crashAfterPhase, "prepared");
        if (previousPointer?.status !== "revoked") {
          await options.publishPointerStatus({
            status: "blocked",
            reasonCode: "CANONICAL_RETRACTION_IN_PROGRESS",
            sourceRevision: before.sourceRevision,
            changedAt: now(options),
          });
        }
        journal = await advanceJournal(options, journal, "pointer-blocked");
        crashAtPhase(input.testHooks?.crashAfterPhase, "pointer-blocked");
        journal = await advanceJournal(options, journal, "mutation-started");
        crashAtPhase(input.testHooks?.crashAfterPhase, "mutation-started");
        let result: Result;
        try {
          result = await mutate();
        } catch (error) {
          const afterFailure = await options.inspectSource();
          if (afterFailure.sourceRevision === before.sourceRevision) {
            if (previousPointer?.status !== "revoked") {
              await requiredRestorePointer(options)({
                pointer: previousPointer,
                expectedSourceRevision: before.sourceRevision,
                changedAt: now(options),
              });
            }
            await clearJournal(options.runtimeDirectory);
          } else {
            await persistBlockedRecoveryState(
              options,
              journal,
              "CANONICAL_MUTATION_RESULT_UNKNOWN",
            );
          }
          throw error;
        }
        journal = await advanceJournal(options, journal, "mutation-committed");
        crashAtPhase(input.testHooks?.crashAfterPhase, "mutation-committed");
        if (previousPointer?.status === "revoked") {
          await persistUnavailablePointerState(options, "revoked");
          await clearJournal(options.runtimeDirectory);
          return result;
        }
        const publication = await refresh({
          trigger: "retraction-recovery",
          signal,
          failedStatus: "degraded",
        });
        if (publication.status === "ready") {
          await clearJournal(options.runtimeDirectory);
        }
        return result;
      });
    },
    recover(input: { readonly signal?: AbortSignal } = {}) {
      const signal = input.signal ?? new AbortController().signal;
      return enqueue(() => recoverJournal(signal));
    },
    checkForExternalRevision(
      input: { readonly signal?: AbortSignal } = {},
    ): Promise<FitnessContextSyncResult> {
      return enqueue(async () => {
        const signal = input.signal ?? new AbortController().signal;
        throwIfAborted(signal);
        const journal = await readJournal(options.runtimeDirectory);
        if (journal !== undefined) return await recoverJournal(signal);
        const state = await readState(options.runtimeDirectory);
        let source: FitnessContextSyncSource;
        try {
          source = await options.inspectSource();
        } catch {
          return await refresh({ trigger: "external-revision", signal });
        }
        if (
          state?.source_revision === source.sourceRevision &&
          (state.status === "ready" || state.status === "stale")
        ) {
          return resultFromState(state);
        }
        return await refresh({ trigger: "external-revision", signal });
      });
    },
    async diagnostics(): Promise<FitnessContextSyncState> {
      return await readState(options.runtimeDirectory) ?? {
        schema_version: CONTEXT_SYNC_STATE_SCHEMA,
        status: "uninitialized",
        source_category: "fitness-canonical",
        reason_code: "INITIAL_SYNC_REQUIRED",
        recovery_action: "run-context-resync",
        attempt_count: 0,
        updated_at: now(options),
      };
    },
  };
}

function resultFromState(state: FitnessContextSyncState): FitnessContextSyncResult {
  return {
    status: state.status,
    attempts: state.attempt_count,
    ...(state.source_revision === undefined
      ? {}
      : { sourceRevision: state.source_revision }),
    ...(state.projection_revision === undefined
      ? {}
      : { projectionRevision: state.projection_revision }),
    ...(state.manifest_checksum === undefined
      ? {}
      : { manifestChecksum: state.manifest_checksum }),
    ...(state.as_of === undefined ? {} : { asOf: state.as_of }),
    ...(state.reason_code === undefined ? {} : { reasonCode: state.reason_code }),
  };
}

async function persistState(
  runtimeDirectory: string,
  state: FitnessContextSyncState,
): Promise<void> {
  const path = join(runtimeDirectory, "context-sync", "state.json");
  await durableAtomicWrite(path, canonicalizeJcs(state));
}

async function readState(
  runtimeDirectory: string,
): Promise<FitnessContextSyncState | undefined> {
  let bytes: Buffer;
  try {
    bytes = await readFile(join(runtimeDirectory, "context-sync", "state.json"));
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw error;
  }
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error("CONTEXT_SYNC_STATE_INVALID");
  }
  if (!isState(value) || !canonicalizeJcs(value).equals(bytes)) {
    throw new Error("CONTEXT_SYNC_STATE_INVALID");
  }
  return value;
}

async function persistJournal(
  runtimeDirectory: string,
  journal: FitnessContextSyncJournal,
): Promise<void> {
  await durableAtomicWrite(
    journalPath(runtimeDirectory),
    canonicalizeJcs(journal),
  );
}

async function readJournal(
  runtimeDirectory: string,
): Promise<FitnessContextSyncJournal | undefined> {
  let bytes: Buffer;
  try {
    bytes = await readFile(journalPath(runtimeDirectory));
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw error;
  }
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error("CONTEXT_SYNC_JOURNAL_INVALID");
  }
  if (!isJournal(value) || !canonicalizeJcs(value).equals(bytes)) {
    throw new Error("CONTEXT_SYNC_JOURNAL_INVALID");
  }
  return value;
}

async function advanceJournal(
  options: CoordinatorOptions,
  journal: FitnessContextSyncJournal,
  phase: FitnessContextSyncJournalPhase,
): Promise<FitnessContextSyncJournal> {
  const next = { ...journal, phase, updated_at: now(options) };
  await persistJournal(options.runtimeDirectory, next);
  return next;
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

function journalPath(runtimeDirectory: string): string {
  return join(runtimeDirectory, "context-sync", "journal.json");
}

async function persistBlockedRecoveryState(
  options: CoordinatorOptions,
  journal: FitnessContextSyncJournal,
  reasonCode: string,
): Promise<FitnessContextSyncResult> {
  const state: FitnessContextSyncState = {
    schema_version: CONTEXT_SYNC_STATE_SCHEMA,
    status: "conflicted",
    source_category: "fitness-canonical",
    source_revision: journal.before_source_revision,
    as_of: journal.before_as_of,
    reason_code: reasonCode,
    recovery_action: "inspect-canonical-source-and-resync",
    attempt_count: 0,
    updated_at: now(options),
  };
  await persistState(options.runtimeDirectory, state);
  return resultFromState(state);
}

async function persistUnexpectedFailureState(
  options: CoordinatorOptions,
): Promise<void> {
  let source: FitnessContextSyncSource | undefined;
  try {
    source = await options.inspectSource();
  } catch {
    source = undefined;
  }
  await persistState(options.runtimeDirectory, {
    schema_version: CONTEXT_SYNC_STATE_SCHEMA,
    status: "degraded",
    source_category: "fitness-canonical",
    ...(source === undefined
      ? {}
      : { source_revision: source.sourceRevision, as_of: source.asOf }),
    reason_code: "CONTEXT_SYNC_INFRASTRUCTURE_UNAVAILABLE",
    recovery_action: "retry-on-startup-write-or-resync",
    attempt_count: 0,
    updated_at: now(options),
  });
}

async function persistUnavailablePointerState(
  options: CoordinatorOptions,
  status: "blocked" | "revoked",
): Promise<FitnessContextSyncResult> {
  let source: FitnessContextSyncSource | undefined;
  try {
    source = await options.inspectSource();
  } catch {
    source = undefined;
  }
  const state: FitnessContextSyncState = {
    schema_version: CONTEXT_SYNC_STATE_SCHEMA,
    status: status === "blocked" ? "conflicted" : "degraded",
    source_category: "fitness-canonical",
    ...(source === undefined
      ? {}
      : { source_revision: source.sourceRevision, as_of: source.asOf }),
    reason_code: status === "blocked"
      ? "PROJECTION_POINTER_BLOCKED"
      : "PROJECTION_POINTER_REVOKED",
    recovery_action: status === "blocked"
      ? "inspect-projection-pointer-and-resync"
      : "renew-authorization-before-resync",
    attempt_count: 0,
    updated_at: now(options),
  };
  await persistState(options.runtimeDirectory, state);
  return resultFromState(state);
}

function stateResultForPointer(
  pointer: FitnessProjectionPointerSnapshot | undefined,
): FitnessContextSyncResult {
  if (pointer?.status === "active" || pointer?.status === "stale") {
    return {
      status: pointer.status === "active" ? "ready" : "stale",
      attempts: 0,
      sourceRevision: pointer.sourceRevision,
      projectionRevision: pointer.projectionRevision,
      manifestChecksum: pointer.manifestChecksum,
      asOf: pointer.asOf,
    };
  }
  return { status: "uninitialized", attempts: 0 };
}

function requiredRestorePointer(
  options: CoordinatorOptions,
): NonNullable<CoordinatorOptions["restorePointer"]> {
  if (options.restorePointer === undefined) {
    throw new Error("Context sync pointer restoration is unavailable");
  }
  return options.restorePointer;
}

function isJournal(value: unknown): value is FitnessContextSyncJournal {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Readonly<Record<string, unknown>>;
  const requiredKeys = [
    "before_as_of",
    "before_source_revision",
    "kind",
    "operation_id",
    "phase",
    "schema_version",
    "started_at",
    "updated_at",
  ];
  const allowedKeys = record.previous_pointer === undefined
    ? requiredKeys
    : [...requiredKeys, "previous_pointer"];
  return hasExactKeys(record, allowedKeys) &&
    record.schema_version === "stella-fitness/context-sync-journal/v1" &&
    typeof record.operation_id === "string" &&
    (record.kind === "correction" || record.kind === "deletion" ||
      record.kind === "retraction") &&
    (record.phase === "prepared" || record.phase === "pointer-blocked" ||
      record.phase === "mutation-started" || record.phase === "mutation-committed") &&
    typeof record.before_source_revision === "string" &&
    typeof record.before_as_of === "string" &&
    typeof record.started_at === "string" &&
    typeof record.updated_at === "string" &&
    (record.previous_pointer === undefined || isPointerSnapshot(record.previous_pointer));
}

function isPointerSnapshot(value: unknown): value is FitnessProjectionPointerSnapshot {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Readonly<Record<string, unknown>>;
  if (record.status === "blocked" || record.status === "revoked") {
    return hasExactKeys(record, ["sourceRevision", "status"]) &&
      typeof record.sourceRevision === "string";
  }
  if (record.status !== "active" && record.status !== "stale") return false;
  return hasExactKeys(record, [
    "asOf",
    "manifestChecksum",
    "projectionRevision",
    "sourceRevision",
    "status",
  ]) &&
    typeof record.sourceRevision === "string" &&
    typeof record.projectionRevision === "string" &&
    typeof record.manifestChecksum === "string" &&
    typeof record.asOf === "string";
}

function hasExactKeys(
  record: Readonly<Record<string, unknown>>,
  expected: readonly string[],
): boolean {
  const keys = Object.keys(record).sort();
  const sortedExpected = [...expected].sort();
  return keys.length === sortedExpected.length &&
    keys.every((key, index) => key === sortedExpected[index]);
}

function isState(value: unknown): value is FitnessContextSyncState {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Readonly<Record<string, unknown>>;
  return record.schema_version === CONTEXT_SYNC_STATE_SCHEMA &&
    (record.status === "uninitialized" || record.status === "ready" ||
      record.status === "degraded" || record.status === "stale" ||
      record.status === "conflicted" || record.status === "standalone-degraded") &&
    (record.source_category === "fitness-canonical" ||
      record.source_category === "runtime-identity" ||
      record.source_category === "workspace") &&
    Number.isSafeInteger(record.attempt_count) &&
    typeof record.updated_at === "string";
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function isInvalidCanonicalSourceError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.message === "FITNESS_PROJECTION_SOURCE_INVALID" ||
    error.message === "FITNESS_PROJECTION_SOURCE_PATH_INVALID" ||
    error.message === "FITNESS_PROJECTION_SOURCE_OVERSIZE" ||
    error.message === "FITNESS_PROJECTION_SOURCE_CHANGED" ||
    error.message === "FITNESS_PROJECTION_TIMESTAMP_INVALID";
}

function crashAtPhase(
  requested: FitnessContextSyncJournalPhase | undefined,
  phase: FitnessContextSyncJournalPhase,
): void {
  if (requested === phase) {
    throw new Error(`SIMULATED_CONTEXT_SYNC_CRASH:${phase}`);
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

function now(options: CoordinatorOptions): string {
  return (options.now?.() ?? new Date()).toISOString();
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortError();
}

function abortError(): Error {
  const error = new Error("Fitness Context Sync was cancelled");
  error.name = "AbortError";
  return error;
}
