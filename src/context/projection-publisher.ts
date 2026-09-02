import { createHash, randomUUID } from "node:crypto";
import {
  lstatSync,
  realpathSync,
} from "node:fs";
import {
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
} from "node:fs/promises";
import { basename, dirname, join, relative, sep } from "node:path";

import type { BodyWeightObservation } from "../domain/observation.js";
import type {
  StrengthTestResult,
  WorkoutExerciseActual,
  WorkoutLogObservation,
} from "../domain/observation.js";
import { rebuildCourseStart12RMHistory } from "../program/journey.js";
import { readActiveProgramIfPresent } from "../program/state.js";
import { rebuildBodyWeightView } from "../storage/body-weight.js";
import { rebuildTrainingRecordView } from "../storage/training-record.js";
import {
  canonicalizeJcs,
  canonicalTextBytes,
  readPersonalDataRepositoryInitialization,
  resolveStellaPersonalDataPaths,
} from "./runtime-contract.js";
import type {
  PersonalDataRepositoryInitialization,
  StellaPersonalDataPaths,
} from "./runtime-contract.js";
import type { FitnessProjectionPointerSnapshot } from "./sync-coordinator.js";

const PRODUCER_ID = "stella-fitness" as const;
const CONSUMER_ID = "stella-runtime" as const;
const DESIRED_SET_SCHEMA = "stella-fitness/fitness-history-context/v1";
const SOURCE_SNAPSHOT_SCHEMA = "stella-fitness/projection-source-snapshot/v1";
const MANIFEST_FILE = "manifest.json";
const PAYLOAD_SHARD_COUNT = 32;
const EMPTY_PAYLOAD_STABLE_ID = "fitness-history-empty";
const PUBLISH_PHASES = [
  "locked",
  "candidate-written",
  "revision-renamed",
  "pointer-replaced",
  "committed",
] as const;

export type FitnessProjectionPublishPhase = typeof PUBLISH_PHASES[number];

type ProjectionSourceReference = {
  readonly id: string;
  readonly path: string;
  readonly revision: string;
  readonly checksum: string;
};

type ProjectionManifest = {
  readonly schema_version: "stella.context-projection-manifest/v1";
  readonly instance_id: string;
  readonly producer_id: typeof PRODUCER_ID;
  readonly consumer_id: typeof CONSUMER_ID;
  readonly projection_revision: string;
  readonly source: { readonly revision: string; readonly as_of: string };
  readonly categories: readonly ["fitness_history"];
  readonly source_references: readonly ProjectionSourceReference[];
  readonly conflicts: readonly [];
  readonly retractions: readonly [];
  readonly capabilities: readonly {
    readonly id: "current_fitness_state" | "fitness_history_context";
    readonly state: "available" | "unavailable";
  }[];
  readonly payloads: readonly {
    readonly stable_id: string;
    readonly path: string;
    readonly media_type: "application/json" | "text/markdown";
    readonly byte_length: number;
    readonly checksum: string;
  }[];
  readonly generated_at: string;
};

type ProjectionPublication = {
  readonly projectionRevision: string;
  readonly manifest: ProjectionManifest;
  readonly manifestBytes: Buffer;
  readonly manifestChecksum: string;
  readonly payloads: readonly {
    readonly path: string;
    readonly bytes: Buffer;
    readonly checksum: string;
  }[];
};

type ProjectionRevisionSeed = Omit<
  ProjectionManifest,
  "schema_version" | "projection_revision" | "generated_at"
>;

type FitnessHistoryDocument = {
  readonly id: string;
  readonly category: "body-weight" | "program" | "strength-test" | "workout";
  readonly source_reference_ids: readonly string[];
  readonly facts: Readonly<Record<string, unknown>>;
};

type FitnessProjectionSnapshot = {
  readonly sourceRevision: string;
  readonly sourceAsOf: string;
  readonly sourceInventory: readonly {
    readonly path: string;
    readonly checksum: string;
    readonly asOf?: string;
  }[];
  readonly sourceReferences: readonly ProjectionSourceReference[];
  readonly desiredSet: {
    readonly schema_version: typeof DESIRED_SET_SCHEMA;
    readonly authoritative: false;
    readonly source_revision: string;
    readonly source_as_of: string;
    readonly documents: readonly FitnessHistoryDocument[];
  };
};

export type FitnessProjectionPublishResult = {
  readonly status: "published";
  readonly sourceRevision: string;
  readonly projectionRevision: string;
  readonly manifestChecksum: string;
  readonly asOf: string;
  readonly reusedRevision: boolean;
};

export async function inspectFitnessContextProjectionSource(options: {
  readonly openclawConfig: unknown;
}): Promise<{ readonly sourceRevision: string; readonly asOf: string }> {
  const paths = resolveStellaPersonalDataPaths(options.openclawConfig);
  const snapshot = await buildFitnessProjectionSnapshot(
    paths.fitnessData,
    readPersonalDataRepositoryInitialization(paths).initializedAt,
  );
  return {
    sourceRevision: snapshot.sourceRevision,
    asOf: snapshot.sourceAsOf,
  };
}

export async function readFitnessContextProjectionPointer(options: {
  readonly openclawConfig: unknown;
}): Promise<FitnessProjectionPointerSnapshot | undefined> {
  const paths = resolveStellaPersonalDataPaths(options.openclawConfig);
  if (!pathExists(paths.fitnessToRuntime)) return undefined;
  const publicationRoot = validatePublicationRoot(paths.repository, paths.fitnessToRuntime);
  const bytes = await readOptionalSafePublishedFile(
    join(publicationRoot, "active.json"),
    publicationRoot,
  );
  return bytes === undefined ? undefined : parseProjectionPointer(bytes);
}

export async function publishFitnessContextProjectionPointerStatus(options: {
  readonly openclawConfig: unknown;
  readonly status: "blocked" | "revoked" | "stale";
  readonly reasonCode: string;
  readonly sourceRevision: string;
  readonly changedAt?: string;
}): Promise<void> {
  const paths = resolveStellaPersonalDataPaths(options.openclawConfig);
  if (!pathExists(paths.fitnessToRuntime)) return;
  const publicationRoot = validatePublicationRoot(paths.repository, paths.fitnessToRuntime);
  const activePath = join(publicationRoot, "active.json");
  const currentBytes = await readOptionalSafePublishedFile(activePath, publicationRoot);
  const current = currentBytes === undefined
    ? undefined
    : parseProjectionPointer(currentBytes);
  const changedAt = canonicalTimestamp(options.changedAt ?? new Date().toISOString());
  const pointer = options.status === "stale"
    ? buildStalePointer({
        instanceId: paths.instanceId,
        previous: requireVerifiedPointer(current),
        reasonCode: options.reasonCode,
        changedAt,
      })
    : buildUnavailablePointer({
        instanceId: paths.instanceId,
        status: options.status,
        sourceRevision: options.sourceRevision,
        reasonCode: options.reasonCode,
        changedAt,
      });
  if (currentBytes === undefined || !currentBytes.equals(pointer)) {
    await atomicWriteFile(activePath, pointer);
  }
}

export async function restoreFitnessContextProjectionPointer(options: {
  readonly openclawConfig: unknown;
  readonly pointer: FitnessProjectionPointerSnapshot | undefined;
  readonly expectedSourceRevision: string;
  readonly changedAt?: string;
}): Promise<void> {
  const source = await inspectFitnessContextProjectionSource(options);
  if (source.sourceRevision !== options.expectedSourceRevision) {
    throw new Error("FITNESS_PROJECTION_POINTER_RESTORE_SOURCE_CHANGED");
  }
  const paths = resolveStellaPersonalDataPaths(options.openclawConfig);
  if (!pathExists(paths.fitnessToRuntime) && options.pointer === undefined) return;
  const publicationRoot = validatePublicationRoot(paths.repository, paths.fitnessToRuntime);
  const activePath = join(publicationRoot, "active.json");
  const current = await readOptionalSafePublishedFile(activePath, publicationRoot);
  if (current === undefined && options.pointer === undefined) return;
  if (current === undefined) {
    throw new Error("FITNESS_PROJECTION_POINTER_RESTORE_NOT_BLOCKED");
  }
  const currentPointer = parseProjectionPointer(current);
  if (currentPointer.status !== "blocked") {
    throw new Error("FITNESS_PROJECTION_POINTER_RESTORE_NOT_BLOCKED");
  }
  if (options.pointer === undefined) {
    await rm(activePath);
    await syncDirectory(publicationRoot);
    return;
  }
  if (options.pointer.status !== "active" && options.pointer.status !== "stale") {
    throw new Error("FITNESS_PROJECTION_POINTER_RESTORE_INVALID");
  }
  const changedAt = canonicalTimestamp(options.changedAt ?? new Date().toISOString());
  const restored = options.pointer.status === "active"
    ? buildActivePointerFromSnapshot(paths.instanceId, options.pointer, changedAt)
    : buildStalePointer({
        instanceId: paths.instanceId,
        previous: options.pointer,
        reasonCode: "RESTORED_AFTER_FAILED_MUTATION",
        changedAt,
      });
  await atomicWriteFile(activePath, restored);
}

export async function publishFitnessContextProjection(options: {
  readonly openclawConfig: unknown;
  readonly generatedAt?: string;
  readonly allowBlockedReplacement?: boolean;
  readonly testHooks?: {
    readonly afterLock?: () => Promise<void> | void;
    readonly crashAfterPhase?: FitnessProjectionPublishPhase;
    readonly crashDuringCandidateWrite?: boolean;
    readonly now?: () => Date;
    readonly isProcessAlive?: (pid: number) => boolean;
    readonly afterSourceSnapshot?: () => Promise<void> | void;
  };
}): Promise<FitnessProjectionPublishResult> {
  const paths = resolveStellaPersonalDataPaths(options.openclawConfig);
  const publicationRoot = validatePublicationRoot(paths.repository, paths.fitnessToRuntime);
  const repositoryInitialization = readPersonalDataRepositoryInitialization(paths);
  const snapshot = await buildFitnessProjectionSnapshot(
    paths.fitnessData,
    repositoryInitialization.initializedAt,
    async () => {
      assertRepositoryInitializationUnchanged(paths, repositoryInitialization);
      await options.testHooks?.afterSourceSnapshot?.();
    },
  );
  const generatedAt = canonicalTimestamp(options.generatedAt ?? new Date().toISOString());
  const publication = buildProjectionPublication({
    instanceId: paths.instanceId,
    sourceRevision: snapshot.sourceRevision,
    sourceAsOf: snapshot.sourceAsOf,
    sourceReferences: snapshot.sourceReferences,
    desiredSet: snapshot.desiredSet,
    generatedAt,
  });
  const lock = await acquirePublishLock({
    publicationRoot,
    sourceRevision: snapshot.sourceRevision,
    projectionRevision: publication.projectionRevision,
    ...(options.testHooks?.now === undefined ? {} : { now: options.testHooks.now }),
    ...(options.testHooks?.isProcessAlive === undefined
      ? {}
      : { isProcessAlive: options.testHooks.isProcessAlive }),
  });
  let preserveLock = false;
  try {
    await options.testHooks?.afterLock?.();
    crashAtPhase(options.testHooks?.crashAfterPhase, "locked");
    await assertSourceInventoryUnchanged(paths.fitnessData, snapshot.sourceInventory);
    assertRepositoryInitializationUnchanged(paths, repositoryInitialization);
    const revisionsRoot = join(publicationRoot, "revisions");
    const revisionDirectory = join(revisionsRoot, publication.projectionRevision);
    await mkdir(revisionsRoot, { recursive: true, mode: 0o700 });

    const existing = await readExistingPublication(revisionDirectory, publication);
    const committed = existing ?? await writeImmutableRevision({
      revisionsRoot,
      revisionDirectory,
      publication,
      ownerToken: lock.ownerToken,
      crashDuringCandidateWrite: options.testHooks?.crashDuringCandidateWrite === true,
      async candidateWritten() {
        await setPublishLockPhase(lock, "candidate-written");
        crashAtPhase(options.testHooks?.crashAfterPhase, "candidate-written");
      },
    });
    await setPublishLockPhase(lock, "revision-renamed");
    crashAtPhase(options.testHooks?.crashAfterPhase, "revision-renamed");
    const activePath = join(publicationRoot, "active.json");
    const currentPointer = await readOptionalSafePublishedFile(
      activePath,
      publicationRoot,
    );
    const pointerBytes = buildActivePointer({
      instanceId: paths.instanceId,
      publication: committed,
      changedAt: generatedAt,
    });
    await assertSourceInventoryUnchanged(paths.fitnessData, snapshot.sourceInventory);
    assertRepositoryInitializationUnchanged(paths, repositoryInitialization);
    const currentStatus = currentPointer === undefined
      ? undefined
      : parseProjectionPointer(currentPointer);
    if (currentStatus?.status === "revoked") {
      throw new Error("FITNESS_PROJECTION_POINTER_REVOKED");
    }
    if (
      currentStatus?.status === "blocked" &&
      options.allowBlockedReplacement !== true
    ) {
      throw new Error("FITNESS_PROJECTION_POINTER_BLOCKED");
    }
    if (
      currentPointer === undefined || currentStatus?.status !== "active" ||
      !pointerTargets(currentPointer, committed)
    ) {
      await atomicWriteFile(activePath, pointerBytes);
    }
    await setPublishLockPhase(lock, "pointer-replaced");
    crashAtPhase(options.testHooks?.crashAfterPhase, "pointer-replaced");
    await setPublishLockPhase(lock, "committed");
    crashAtPhase(options.testHooks?.crashAfterPhase, "committed");
    return {
      status: "published",
      sourceRevision: snapshot.sourceRevision,
      projectionRevision: committed.projectionRevision,
      manifestChecksum: committed.manifestChecksum,
      asOf: snapshot.sourceAsOf,
      reusedRevision: existing !== undefined,
    };
  } catch (error) {
    preserveLock = error instanceof SimulatedProjectionCrash;
    throw error;
  } finally {
    if (!preserveLock) await releasePublishLock(lock);
  }
}

function assertRepositoryInitializationUnchanged(
  paths: StellaPersonalDataPaths,
  expected: PersonalDataRepositoryInitialization,
): void {
  const current = readPersonalDataRepositoryInitialization(paths);
  if (!canonicalizeJcs(current).equals(canonicalizeJcs(expected))) {
    throw new Error("FITNESS_PROJECTION_SOURCE_CHANGED");
  }
}

type HeldPublishLock = {
  readonly path: string;
  readonly ownerToken: string;
  readonly publicationRoot: string;
  phase: FitnessProjectionPublishPhase;
};

type PublishLockRecord = {
  readonly schema_version: "stella-fitness/projection-publish-lock/v1";
  readonly owner_token: string;
  readonly owner_pid: number;
  readonly lease_expires_at: string;
  readonly target_source_revision: string;
  readonly target_projection_revision: string;
  readonly phase: FitnessProjectionPublishPhase;
  readonly acquired_at: string;
};

class SimulatedProjectionCrash extends Error {
  constructor(phase: FitnessProjectionPublishPhase) {
    super(`SIMULATED_FITNESS_PROJECTION_CRASH:${phase}`);
    this.name = "SimulatedProjectionCrash";
  }
}

async function acquirePublishLock(options: {
  readonly publicationRoot: string;
  readonly sourceRevision: string;
  readonly projectionRevision: string;
  readonly now?: () => Date;
  readonly isProcessAlive?: (pid: number) => boolean;
}): Promise<HeldPublishLock> {
  const path = join(options.publicationRoot, ".publish.lock");
  const ownerToken = randomUUID();
  const now = options.now?.() ?? new Date();
  const acquiredAt = now.toISOString();
  const record: PublishLockRecord = {
    schema_version: "stella-fitness/projection-publish-lock/v1",
    owner_token: ownerToken,
    owner_pid: process.pid,
    lease_expires_at: new Date(now.getTime() + 30_000).toISOString(),
    target_source_revision: options.sourceRevision,
    target_projection_revision: options.projectionRevision,
    phase: "locked",
    acquired_at: acquiredAt,
  };
  try {
    await durableWrite(path, canonicalizeJcs(record));
    await syncDirectory(options.publicationRoot);
  } catch (error) {
    if (isAlreadyExists(error)) {
      await recoverPublishLock({
        path,
        publicationRoot: options.publicationRoot,
        now,
        isProcessAlive: options.isProcessAlive ?? processIsAlive,
      });
      return await acquirePublishLock(options);
    }
    throw error;
  }
  return {
    path,
    ownerToken,
    publicationRoot: options.publicationRoot,
    phase: "locked",
  };
}

async function setPublishLockPhase(
  lock: HeldPublishLock,
  phase: FitnessProjectionPublishPhase,
): Promise<void> {
  const bytes = await readSafePublishedFile(lock.path, lock.publicationRoot);
  const record = parsePublishLock(bytes);
  if (record.owner_token !== lock.ownerToken || record.phase !== lock.phase) {
    throw new Error("FITNESS_PROJECTION_LOCK_OWNERSHIP_LOST");
  }
  await atomicWriteFile(lock.path, canonicalizeJcs({ ...record, phase }));
  lock.phase = phase;
}

async function releasePublishLock(lock: HeldPublishLock): Promise<void> {
  const bytes = await readSafePublishedFile(lock.path, lock.publicationRoot);
  const value = JSON.parse(bytes.toString("utf8")) as Readonly<Record<string, unknown>>;
  if (value.owner_token !== lock.ownerToken) {
    throw new Error("FITNESS_PROJECTION_LOCK_OWNERSHIP_LOST");
  }
  await rm(lock.path);
  await syncDirectory(lock.publicationRoot);
}

async function recoverPublishLock(options: {
  readonly path: string;
  readonly publicationRoot: string;
  readonly now: Date;
  readonly isProcessAlive: (pid: number) => boolean;
}): Promise<void> {
  const bytes = await readSafePublishedFile(options.path, options.publicationRoot);
  const record = parsePublishLock(bytes);
  const lease = new Date(record.lease_expires_at);
  if (lease.getTime() > options.now.getTime() || options.isProcessAlive(record.owner_pid)) {
    throw new Error("FITNESS_PROJECTION_LOCKED");
  }
  const revisionsRoot = join(options.publicationRoot, "revisions");
  const revisionDirectory = join(revisionsRoot, record.target_projection_revision);
  const candidate = join(
    revisionsRoot,
    `.tmp-${record.target_projection_revision}-${record.owner_token}`,
  );
  const candidateExists = pathExists(candidate);
  if (candidateExists && record.phase === "candidate-written") {
    await readStoredPublication(
      candidate,
      record.target_projection_revision,
      record.target_source_revision,
    ).catch(() => {
      throw new Error("FITNESS_PROJECTION_RECOVERY_BLOCKED");
    });
  }
  if (candidateExists) {
    await removeRecoveryCandidate(candidate, revisionsRoot);
  }
  if (
    record.phase === "revision-renamed" ||
    record.phase === "pointer-replaced" ||
    record.phase === "committed"
  ) {
    const existing = await readStoredPublication(
      revisionDirectory,
      record.target_projection_revision,
      record.target_source_revision,
    ).catch(() => {
      throw new Error("FITNESS_PROJECTION_RECOVERY_BLOCKED");
    });
    if (record.phase === "pointer-replaced" || record.phase === "committed") {
      const pointer = await readSafePublishedFile(
        join(options.publicationRoot, "active.json"),
        options.publicationRoot,
      );
      if (!pointerTargets(pointer, existing)) {
        throw new Error("FITNESS_PROJECTION_RECOVERY_BLOCKED");
      }
    }
  }
  const current = parsePublishLock(
    await readSafePublishedFile(options.path, options.publicationRoot),
  );
  if (current.owner_token !== record.owner_token || current.phase !== record.phase) {
    throw new Error("FITNESS_PROJECTION_RECOVERY_BLOCKED");
  }
  await rm(options.path);
  await syncDirectory(options.publicationRoot);
}

function pathExists(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
}

async function removeRecoveryCandidate(path: string, revisionsRoot: string): Promise<void> {
  const metadata = lstatSync(path);
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    throw new Error("FITNESS_PROJECTION_RECOVERY_BLOCKED");
  }
  if (!realpathSync(path).startsWith(`${realpathSync(revisionsRoot)}${sep}`)) {
    throw new Error("FITNESS_PROJECTION_RECOVERY_BLOCKED");
  }
  await rm(path, { recursive: true });
  await syncDirectory(revisionsRoot);
}

function parsePublishLock(bytes: Buffer): PublishLockRecord {
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error("FITNESS_PROJECTION_RECOVERY_BLOCKED");
  }
  if (!isRecord(value)) throw new Error("FITNESS_PROJECTION_RECOVERY_BLOCKED");
  const keys = Object.keys(value).sort().join(",");
  if (
    keys !== [
      "acquired_at",
      "lease_expires_at",
      "owner_pid",
      "owner_token",
      "phase",
      "schema_version",
      "target_projection_revision",
      "target_source_revision",
    ].sort().join(",") ||
    value.schema_version !== "stella-fitness/projection-publish-lock/v1" ||
    typeof value.owner_token !== "string" ||
    !Number.isSafeInteger(value.owner_pid) ||
    typeof value.lease_expires_at !== "string" ||
    typeof value.target_source_revision !== "string" ||
    typeof value.target_projection_revision !== "string" ||
    !PUBLISH_PHASES.includes(value.phase as FitnessProjectionPublishPhase) ||
    typeof value.acquired_at !== "string"
  ) {
    throw new Error("FITNESS_PROJECTION_RECOVERY_BLOCKED");
  }
  if (!canonicalizeJcs(value).equals(bytes)) {
    throw new Error("FITNESS_PROJECTION_RECOVERY_BLOCKED");
  }
  return value as PublishLockRecord;
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "EPERM";
  }
}

function crashAtPhase(
  requested: FitnessProjectionPublishPhase | undefined,
  phase: FitnessProjectionPublishPhase,
): void {
  if (requested === phase) throw new SimulatedProjectionCrash(phase);
}

async function buildFitnessProjectionSnapshot(
  personalDataDirectory: string,
  repositoryInitializedAt: string,
  afterSourceSnapshot?: () => Promise<void> | void,
): Promise<FitnessProjectionSnapshot> {
  const initialInventory = await canonicalSourceInventory(personalDataDirectory);
  const activeProgram = await readActiveProgramIfPresent({ personalDataDirectory });
  const bodyWeight = await rebuildBodyWeightView(personalDataDirectory);
  const trainingRecord = await rebuildTrainingRecordView(personalDataDirectory);
  const strengthTests = await rebuildCourseStart12RMHistory(personalDataDirectory);
  if (
    bodyWeight.errors.length > 0 ||
    trainingRecord.errors.length > 0 ||
    strengthTests.errors.length > 0
  ) {
    throw new Error("FITNESS_PROJECTION_SOURCE_INVALID");
  }
  const references: Array<Omit<ProjectionSourceReference, "revision">> = [];
  const documents: FitnessHistoryDocument[] = [];
  const sourceTimes = initialInventory.flatMap(({ asOf }) =>
    asOf === undefined ? [] : [asOf]
  );
  if (activeProgram !== undefined) {
    const stateId = activeProgram.state.id;
    for (const [kind, relativeSourcePath] of [
      ["spec", join("program", "spec.json")],
      ["state", join("program", "state.json")],
    ] as const) {
      const bytes = await readSafeCanonicalFile(
        join(personalDataDirectory, relativeSourcePath),
        personalDataDirectory,
      );
      references.push({
        id: `program-${kind}-${stateId}`,
        path: `fitness/${relativeSourcePath.split(sep).join("/")}`,
        checksum: checksum(bytes),
      });
    }
    documents.push({
      id: `program:${stateId}`,
      category: "program",
      source_reference_ids: [
        `program-spec-${stateId}`,
        `program-state-${stateId}`,
      ],
      facts: {
        cycle_start: activeProgram.state.cycle.startDate,
        program_id: activeProgram.program.id,
        program_version: activeProgram.program.version,
      },
    });
    sourceTimes.push(activeProgram.state.provenance.cycleStartConfirmedAt);
  }
  for (const { observation } of trainingRecord.records) {
    const relativeSourcePath = join(
      "observations",
      "workout-log",
      `${observation.id}.json`,
    );
    const bytes = await readSafeCanonicalFile(
      join(personalDataDirectory, relativeSourcePath),
      personalDataDirectory,
    );
    const referenceId = `workout-${observation.id}`;
    references.push({
      id: referenceId,
      path: `fitness/${relativeSourcePath.split(sep).join("/")}`,
      checksum: checksum(bytes),
    });
    documents.push({
      id: `workout:${observation.id}`,
      category: "workout",
      source_reference_ids: [referenceId],
      facts: workoutFacts(observation),
    });
    sourceTimes.push(observation.provenance.recordedAt);
  }
  for (const observation of strengthTests.active) {
    const relativeSourcePath = join(
      "observations",
      "special-session",
      `${observation.id}.json`,
    );
    const bytes = await readSafeCanonicalFile(
      join(personalDataDirectory, relativeSourcePath),
      personalDataDirectory,
    );
    const referenceId = `strength-test-${observation.id}`;
    references.push({
      id: referenceId,
      path: `fitness/${relativeSourcePath.split(sep).join("/")}`,
      checksum: checksum(bytes),
    });
    documents.push({
      id: `strength-test:${observation.id}`,
      category: "strength-test",
      source_reference_ids: [referenceId],
      facts: {
        exercise_id: observation.exerciseId,
        occurred_at: observation.occurredAt,
        result: observation.result,
      },
    });
  }
  sourceTimes.push(...strengthTests.recordedAt);
  for (const point of bodyWeight.points) {
    const relativeSourcePath = join(
      "observations",
      "body-weight",
      `${point.observationId}.json`,
    );
    const absoluteSourcePath = join(personalDataDirectory, relativeSourcePath);
    const bytes = await readSafeCanonicalFile(
      absoluteSourcePath,
      personalDataDirectory,
    );
    const observation = parseBodyWeightObservation(bytes, point.observationId);
    const referenceId = `body-weight-${point.observationId}`;
    references.push({
      id: referenceId,
      path: `fitness/${relativeSourcePath.split(sep).join("/")}`,
      checksum: checksum(bytes),
    });
    documents.push({
      id: `body-weight:${point.observationId}`,
      category: "body-weight",
      source_reference_ids: [referenceId],
      facts: {
        amount: point.amount,
        occurred_at: point.occurredAt,
        unit: point.unit,
      },
    });
    sourceTimes.push(observation.provenance.recordedAt);
  }
  if (sourceTimes.length === 0) {
    sourceTimes.push(repositoryInitializedAt);
  }
  documents.sort((left, right) => left.id.localeCompare(right.id));
  references.sort((left, right) => left.id.localeCompare(right.id));
  const sourceAsOf = sourceTimes.sort().at(-1)!;
  await afterSourceSnapshot?.();
  const finalInventory = await canonicalSourceInventory(personalDataDirectory);
  if (!canonicalizeJcs(initialInventory).equals(canonicalizeJcs(finalInventory))) {
    throw new Error("FITNESS_PROJECTION_SOURCE_CHANGED");
  }
  const sourceRevision = `source-${sha256Hex(canonicalizeJcs({
    schema_version: SOURCE_SNAPSHOT_SCHEMA,
    source_as_of: sourceAsOf,
    references,
    documents,
  }))}`;
  return {
    sourceRevision,
    sourceAsOf,
    sourceInventory: initialInventory,
    sourceReferences: references.map((reference) => ({
      ...reference,
      revision: sourceRevision,
    })),
    desiredSet: {
      schema_version: DESIRED_SET_SCHEMA,
      authoritative: false,
      source_revision: sourceRevision,
      source_as_of: sourceAsOf,
      documents,
    },
  };
}

async function assertSourceInventoryUnchanged(
  personalDataDirectory: string,
  expected: FitnessProjectionSnapshot["sourceInventory"],
): Promise<void> {
  const current = await canonicalSourceInventory(personalDataDirectory);
  if (!canonicalizeJcs(current).equals(canonicalizeJcs(expected))) {
    throw new Error("FITNESS_PROJECTION_SOURCE_CHANGED");
  }
}

async function canonicalSourceInventory(
  personalDataDirectory: string,
): Promise<readonly {
  readonly path: string;
  readonly checksum: string;
  readonly asOf?: string;
}[]> {
  const canonicalFiles = [
    join(personalDataDirectory, "program", "spec.json"),
    join(personalDataDirectory, "program", "state.json"),
  ].filter(pathExists);
  const observationRoots = [
    join(personalDataDirectory, "observations", "body-weight"),
    join(personalDataDirectory, "observations", "special-session"),
    join(personalDataDirectory, "observations", "workout-log"),
  ];
  for (const root of observationRoots) {
    await collectCanonicalJsonFiles(root, personalDataDirectory, canonicalFiles);
  }
  const inventory: Array<{ path: string; checksum: string; asOf?: string }> = [];
  for (const path of canonicalFiles.sort()) {
    const bytes = await readSafeCanonicalFile(path, personalDataDirectory);
    const asOf = sourceFileAsOf(bytes);
    inventory.push({
      path: relative(personalDataDirectory, path).split(sep).join("/"),
      checksum: checksum(bytes),
      ...(asOf === undefined ? {} : { asOf }),
    });
  }
  return inventory;
}

function sourceFileAsOf(bytes: Buffer): string | undefined {
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error("FITNESS_PROJECTION_SOURCE_INVALID");
  }
  if (!isRecord(value) || !isRecord(value.provenance)) return undefined;
  const timestamps = [
    value.provenance.recordedAt,
    value.provenance.cycleStartConfirmedAt,
  ].filter((timestamp): timestamp is string => typeof timestamp === "string")
    .map(canonicalTimestamp);
  return timestamps.sort().at(-1);
}

async function collectCanonicalJsonFiles(
  root: string,
  personalDataDirectory: string,
  files: string[],
): Promise<void> {
  const entries = await readdir(root, { withFileTypes: true }).catch(
    (error: unknown) => {
      if (isMissing(error)) return [];
      throw error;
    },
  );
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const path = join(root, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error("FITNESS_PROJECTION_SOURCE_PATH_INVALID");
    }
    if (entry.isDirectory()) {
      const canonical = realpathSync(path);
      if (!canonical.startsWith(`${realpathSync(personalDataDirectory)}${sep}`)) {
        throw new Error("FITNESS_PROJECTION_SOURCE_PATH_INVALID");
      }
      await collectCanonicalJsonFiles(path, personalDataDirectory, files);
    } else if (entry.isFile() && entry.name.endsWith(".json")) {
      files.push(path);
    }
  }
}

function workoutFacts(
  observation: WorkoutLogObservation,
): Readonly<Record<string, unknown>> {
  const common = {
    occurred_at: observation.occurredAt,
    session_type: observation.sessionType.value,
    stage: observation.stage.value,
    week: observation.week.value,
    weekday: observation.weekday.value,
  };
  if ("testResults" in observation) {
    return {
      ...common,
      test_results: observation.testResults.map((result) => ({
        exercise_id: result.exerciseId.value,
        result: result.result.value === null
          ? null
          : stripRawStrengthResult(result.result.value),
        test: result.test,
      })),
    };
  }
  return {
    exercises: observation.exercises.map(projectWorkoutExercise),
    ...common,
  };
}

function projectWorkoutExercise(
  exercise: WorkoutExerciseActual,
): Readonly<Record<string, unknown>> {
  return {
    exercise_id: exercise.exerciseId.value,
    load: exercise.load.value === null ? null : stripRawLoad(exercise.load.value),
    sets: exercise.sets.map((set) => ({
      semantic: set.semantic,
      value: set.value,
    })),
  };
}

function stripRawLoad(
  load: NonNullable<WorkoutExerciseActual["load"]["value"]>,
): Readonly<Record<string, unknown>> {
  if (load.kind === "kg") {
    return { kind: load.kind, unit: load.unit, value: load.value };
  }
  if (load.kind === "assistance") {
    return { kind: load.kind, mode: load.mode };
  }
  if (load.kind === "variant") {
    return { kind: load.kind, variant: load.variant };
  }
  return { kind: load.kind };
}

function stripRawStrengthResult(
  result: StrengthTestResult,
): Readonly<Record<string, unknown>> {
  return result.kind === "kg"
    ? { kind: result.kind, unit: result.unit, value: result.value }
    : { kind: result.kind, value: result.value };
}

function buildProjectionPublication(options: {
  readonly instanceId: string;
  readonly sourceRevision: string;
  readonly sourceAsOf: string;
  readonly sourceReferences: readonly ProjectionSourceReference[];
  readonly desiredSet: FitnessProjectionSnapshot["desiredSet"];
  readonly generatedAt: string;
}): ProjectionPublication {
  const publicationPayloads = buildProjectionPayloads(options.desiredSet);
  const payloads = publicationPayloads.map((payload) => ({
    stable_id: payload.stableId,
    path: payload.path,
    media_type: "text/markdown" as const,
    byte_length: payload.bytes.byteLength,
    checksum: payload.checksum,
  }));
  const sourceReferences = [...options.sourceReferences].sort((left, right) =>
    left.id.localeCompare(right.id) || left.path.localeCompare(right.path)
  );
  if (sourceReferences.length > 512) {
    throw new Error("FITNESS_PROJECTION_SOURCE_OVERSIZE");
  }
  const capabilities = [
    { id: "current_fitness_state" as const, state: "unavailable" as const },
    { id: "fitness_history_context" as const, state: "available" as const },
  ];
  const revisionSeed: ProjectionRevisionSeed = {
    instance_id: options.instanceId,
    producer_id: PRODUCER_ID,
    consumer_id: CONSUMER_ID,
    source: {
      revision: options.sourceRevision,
      as_of: options.sourceAsOf,
    },
    categories: ["fitness_history"] as const,
    source_references: sourceReferences,
    conflicts: [] as const,
    retractions: [] as const,
    capabilities,
    payloads,
  };
  const projectionRevision = projectionRevisionFor(revisionSeed);
  const manifest: ProjectionManifest = {
    schema_version: "stella.context-projection-manifest/v1",
    instance_id: options.instanceId,
    producer_id: PRODUCER_ID,
    consumer_id: CONSUMER_ID,
    projection_revision: projectionRevision,
    source: revisionSeed.source,
    categories: revisionSeed.categories,
    source_references: sourceReferences,
    conflicts: [],
    retractions: [],
    capabilities,
    payloads,
    generated_at: options.generatedAt,
  };
  const manifestBytes = canonicalizeJcs(manifest);
  return {
    projectionRevision,
    manifest,
    manifestBytes,
    manifestChecksum: checksum(manifestBytes),
    payloads: publicationPayloads.map(({ path, bytes, checksum: value }) => ({
      path,
      bytes,
      checksum: value,
    })),
  };
}

function buildProjectionPayloads(
  desiredSet: FitnessProjectionSnapshot["desiredSet"],
): readonly {
  readonly stableId: string;
  readonly path: string;
  readonly bytes: Buffer;
  readonly checksum: string;
}[] {
  const buckets = new Map<number, FitnessHistoryDocument[]>();
  for (const document of desiredSet.documents) {
    const shard = Number.parseInt(sha256Hex(Buffer.from(document.id, "utf8")).slice(0, 8), 16)
      % PAYLOAD_SHARD_COUNT;
    const documents = buckets.get(shard) ?? [];
    documents.push(document);
    buckets.set(shard, documents);
  }
  const shards = buckets.size === 0
    ? [{ stableId: EMPTY_PAYLOAD_STABLE_ID, documents: [] as FitnessHistoryDocument[] }]
    : [...buckets.entries()]
      .sort(([left], [right]) => left - right)
      .map(([shard, documents]) => ({
        stableId: `fitness-history-${String(shard).padStart(2, "0")}`,
        documents,
      }));
  return shards.map(({ stableId, documents }) => {
    const bytes = canonicalTextBytes(renderSearchableDesiredSet({
      ...desiredSet,
      documents,
    }));
    if (bytes.byteLength < 1 || bytes.byteLength > 1_048_576) {
      throw new Error("FITNESS_PROJECTION_PAYLOAD_OVERSIZE");
    }
    return {
      stableId,
      path: `payloads/${stableId}.md`,
      bytes,
      checksum: checksum(bytes),
    };
  });
}

function renderSearchableDesiredSet(
  desiredSet: FitnessProjectionSnapshot["desiredSet"],
): string {
  return [
    "# Stella Fitness history context",
    "",
    "authoritative: false",
    `source_revision: ${desiredSet.source_revision}`,
    `source_as_of: ${desiredSet.source_as_of}`,
    ...desiredSet.documents.flatMap((document) => [
      "",
      `## ${document.id}`,
      `category: ${document.category}`,
      `source_reference_ids: ${document.source_reference_ids.join(",")}`,
      `facts: ${canonicalizeJcs(document.facts).toString("utf8")}`,
    ]),
  ].join("\n");
}

async function writeImmutableRevision(options: {
  readonly revisionsRoot: string;
  readonly revisionDirectory: string;
  readonly publication: ProjectionPublication;
  readonly ownerToken: string;
  readonly crashDuringCandidateWrite: boolean;
  readonly candidateWritten: () => Promise<void>;
}): Promise<ProjectionPublication> {
  const candidate = join(
    options.revisionsRoot,
    `.tmp-${options.publication.projectionRevision}-${options.ownerToken}`,
  );
  try {
    await mkdir(join(candidate, "payloads"), { recursive: true, mode: 0o700 });
    for (const [index, payload] of options.publication.payloads.entries()) {
      await durableWrite(join(candidate, payload.path), payload.bytes);
      if (index === 0 && options.crashDuringCandidateWrite) {
        throw new SimulatedProjectionCrash("locked");
      }
    }
    await durableWrite(join(candidate, MANIFEST_FILE), options.publication.manifestBytes);
    await syncDirectory(join(candidate, "payloads"));
    await syncDirectory(candidate);
    if (await readExistingPublication(candidate, options.publication) === undefined) {
      throw new Error("FITNESS_PROJECTION_CANDIDATE_INVALID");
    }
    await options.candidateWritten();
    await rename(candidate, options.revisionDirectory);
    await syncDirectory(options.revisionsRoot);
    return options.publication;
  } catch (error) {
    if (error instanceof SimulatedProjectionCrash) throw error;
    await rm(candidate, { recursive: true, force: true });
    if (isAlreadyExists(error)) {
      const existing = await readExistingPublication(
        options.revisionDirectory,
        options.publication,
      );
      if (existing !== undefined) return existing;
    }
    throw error;
  }
}

async function readExistingPublication(
  revisionDirectory: string,
  expected: ProjectionPublication,
): Promise<ProjectionPublication | undefined> {
  if (!pathExists(join(revisionDirectory, MANIFEST_FILE))) return undefined;
  const stored = await readStoredPublication(
    revisionDirectory,
    expected.projectionRevision,
    expected.manifest.source.revision,
  );
  const manifest = stored.manifest;
  const { generated_at: _storedGeneratedAt, ...storedSemantic } = manifest;
  const { generated_at: _expectedGeneratedAt, ...expectedSemantic } = expected.manifest;
  if (
    !canonicalizeJcs(storedSemantic).equals(canonicalizeJcs(expectedSemantic))
  ) {
    throw new Error("FITNESS_PROJECTION_REVISION_TAMPERED");
  }
  return stored;
}

async function readStoredPublication(
  revisionDirectory: string,
  expectedProjectionRevision: string,
  expectedSourceRevision: string,
): Promise<ProjectionPublication> {
  assertStoredRevisionDirectory(revisionDirectory, expectedProjectionRevision);
  const manifestBytes = await readSafePublishedFile(
    join(revisionDirectory, MANIFEST_FILE),
    revisionDirectory,
  );
  const manifest = parseStoredManifest(manifestBytes);
  await assertStoredRevisionTree(revisionDirectory, manifest);
  if (
    manifest.projection_revision !== expectedProjectionRevision ||
    manifest.source.revision !== expectedSourceRevision
  ) {
    throw new Error("FITNESS_PROJECTION_REVISION_TAMPERED");
  }
  const projectionRevision = projectionRevisionFor({
    instance_id: manifest.instance_id,
    producer_id: manifest.producer_id,
    consumer_id: manifest.consumer_id,
    source: manifest.source,
    categories: manifest.categories,
    source_references: manifest.source_references,
    conflicts: manifest.conflicts,
    retractions: manifest.retractions,
    capabilities: manifest.capabilities,
    payloads: manifest.payloads,
  });
  if (projectionRevision !== manifest.projection_revision) {
    throw new Error("FITNESS_PROJECTION_REVISION_TAMPERED");
  }
  const payloads: ProjectionPublication["payloads"][number][] = [];
  for (const metadata of manifest.payloads) {
    const stored = await readSafePublishedFile(
      join(revisionDirectory, metadata.path),
      revisionDirectory,
    );
    if (
      stored.byteLength !== metadata.byte_length ||
      checksum(stored) !== metadata.checksum ||
      !canonicalTextBytes(decodeUtf8(stored)).equals(stored)
    ) {
      throw new Error("FITNESS_PROJECTION_REVISION_TAMPERED");
    }
    payloads.push({ path: metadata.path, bytes: stored, checksum: metadata.checksum });
  }
  const rebuilt: ProjectionPublication = {
    projectionRevision,
    manifest,
    manifestBytes,
    manifestChecksum: checksum(manifestBytes),
    payloads,
  };
  const activePath = join(dirname(dirname(revisionDirectory)), "active.json");
  const active = await readOptionalSafePublishedFile(
    activePath,
    dirname(dirname(revisionDirectory)),
  );
  if (active !== undefined) {
    const pointer = parseProjectionPointer(active);
    if (
      (pointer.status === "active" || pointer.status === "stale") &&
      pointer.projectionRevision === rebuilt.projectionRevision &&
      !verifiedPointerTargets(pointer, rebuilt)
    ) {
      throw new Error("FITNESS_PROJECTION_REVISION_TAMPERED");
    }
  }
  return rebuilt;
}

function verifiedPointerTargets(
  pointer: Extract<
    FitnessProjectionPointerSnapshot,
    { readonly status: "active" | "stale" }
  >,
  publication: ProjectionPublication,
): boolean {
  return pointer.projectionRevision === publication.projectionRevision &&
    pointer.manifestChecksum === publication.manifestChecksum &&
    pointer.sourceRevision === publication.manifest.source.revision &&
    pointer.asOf === publication.manifest.source.as_of;
}

function assertStoredRevisionDirectory(
  revisionDirectory: string,
  expectedProjectionRevision: string,
): void {
  const revisionsRoot = dirname(revisionDirectory);
  const rootMetadata = lstatSync(revisionsRoot);
  const revisionMetadata = lstatSync(revisionDirectory);
  if (
    rootMetadata.isSymbolicLink() || !rootMetadata.isDirectory() ||
    revisionMetadata.isSymbolicLink() || !revisionMetadata.isDirectory()
  ) {
    throw new Error("FITNESS_PROJECTION_REVISION_TAMPERED");
  }
  const name = basename(revisionDirectory);
  if (
    name !== expectedProjectionRevision &&
    !name.startsWith(`.tmp-${expectedProjectionRevision}-`)
  ) {
    throw new Error("FITNESS_PROJECTION_REVISION_TAMPERED");
  }
  if (!realpathSync(revisionDirectory).startsWith(`${realpathSync(revisionsRoot)}${sep}`)) {
    throw new Error("FITNESS_PROJECTION_REVISION_TAMPERED");
  }
}

async function assertStoredRevisionTree(
  revisionDirectory: string,
  manifest: ProjectionManifest,
): Promise<void> {
  const rootEntries = await readdir(revisionDirectory, { withFileTypes: true });
  if (
    rootEntries.map(({ name }) => name).sort().join(",") !== "manifest.json,payloads" ||
    rootEntries.some((entry) =>
      entry.name === MANIFEST_FILE ? !entry.isFile() : !entry.isDirectory()
    )
  ) {
    throw new Error("FITNESS_PROJECTION_REVISION_TAMPERED");
  }
  const payloadDirectory = join(revisionDirectory, "payloads");
  const payloadMetadata = lstatSync(payloadDirectory);
  const payloadEntries = await readdir(payloadDirectory, { withFileTypes: true });
  const expectedNames = manifest.payloads.map(({ path }) => basename(path)).sort();
  if (
    payloadMetadata.isSymbolicLink() || !payloadMetadata.isDirectory() ||
    payloadEntries.map(({ name }) => name).sort().join(",") !== expectedNames.join(",") ||
    payloadEntries.some((entry) => !entry.isFile())
  ) {
    throw new Error("FITNESS_PROJECTION_REVISION_TAMPERED");
  }
}

function parseStoredManifest(bytes: Buffer): ProjectionManifest {
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error("FITNESS_PROJECTION_REVISION_TAMPERED");
  }
  if (
    !isRecord(value) || !canonicalizeJcs(value).equals(bytes) ||
    value.schema_version !== "stella.context-projection-manifest/v1" ||
    value.producer_id !== PRODUCER_ID || value.consumer_id !== CONSUMER_ID ||
    typeof value.instance_id !== "string" ||
    typeof value.projection_revision !== "string" ||
    !isRecord(value.source) || typeof value.source.revision !== "string" ||
    typeof value.source.as_of !== "string" ||
    !Array.isArray(value.source_references) ||
    value.source_references.some((reference) =>
      !isRecord(reference) || typeof reference.id !== "string" ||
      typeof reference.path !== "string" || typeof reference.revision !== "string" ||
      typeof reference.checksum !== "string"
    ) ||
    !Array.isArray(value.payloads) || value.payloads.length < 1 ||
    value.payloads.length > PAYLOAD_SHARD_COUNT ||
    value.payloads.some((payload) =>
      !isRecord(payload) ||
      typeof payload.stable_id !== "string" ||
      !/^fitness-history-(?:[0-9]{2}|empty)$/u.test(payload.stable_id) ||
      payload.path !== `payloads/${payload.stable_id}.md` ||
      payload.media_type !== "text/markdown" ||
      !Number.isSafeInteger(payload.byte_length) ||
      Number(payload.byte_length) < 1 || Number(payload.byte_length) > 1_048_576 ||
      typeof payload.checksum !== "string" ||
      !/^sha256:[a-f0-9]{64}$/u.test(payload.checksum)
    ) ||
    new Set(value.payloads.map((payload) =>
      isRecord(payload) ? payload.stable_id : undefined
    )).size !== value.payloads.length ||
    typeof value.generated_at !== "string"
  ) {
    throw new Error("FITNESS_PROJECTION_REVISION_TAMPERED");
  }
  canonicalTimestamp(value.source.as_of);
  canonicalTimestamp(value.generated_at);
  return value as unknown as ProjectionManifest;
}

function buildActivePointer(options: {
  readonly instanceId: string;
  readonly publication: ProjectionPublication;
  readonly changedAt: string;
}): Buffer {
  const seed = {
    schema_version: "stella.context-projection-pointer-revision-seed/v1",
    instance_id: options.instanceId,
    producer_id: PRODUCER_ID,
    consumer_id: CONSUMER_ID,
    status: "active",
    projection_revision: options.publication.projectionRevision,
    manifest_checksum: options.publication.manifestChecksum,
    source_revision: options.publication.manifest.source.revision,
    as_of: options.publication.manifest.source.as_of,
  };
  return canonicalizeJcs({
    schema_version: "stella.context-projection-pointer/v1",
    instance_id: options.instanceId,
    producer_id: PRODUCER_ID,
    consumer_id: CONSUMER_ID,
    status: "active",
    pointer_revision: `pointer-${sha256Hex(canonicalizeJcs(seed))}`,
    projection_revision: options.publication.projectionRevision,
    manifest_checksum: options.publication.manifestChecksum,
    source_revision: options.publication.manifest.source.revision,
    as_of: options.publication.manifest.source.as_of,
    changed_at: options.changedAt,
  });
}

function pointerTargets(bytes: Buffer, publication: ProjectionPublication): boolean {
  const pointer = parseActivePointer(bytes);
  return pointer.projection_revision === publication.projectionRevision &&
    pointer.manifest_checksum === publication.manifestChecksum &&
    pointer.source_revision === publication.manifest.source.revision;
}

function buildActivePointerFromSnapshot(
  instanceId: string,
  pointer: Extract<
    FitnessProjectionPointerSnapshot,
    { readonly status: "active" | "stale" }
  >,
  changedAt: string,
): Buffer {
  return buildPointer({
    schema_version: "stella.context-projection-pointer/v1",
    instance_id: instanceId,
    producer_id: PRODUCER_ID,
    consumer_id: CONSUMER_ID,
    status: "active",
    projection_revision: pointer.projectionRevision,
    manifest_checksum: pointer.manifestChecksum,
    source_revision: pointer.sourceRevision,
    as_of: pointer.asOf,
    changed_at: changedAt,
  });
}

function buildStalePointer(options: {
  readonly instanceId: string;
  readonly previous: Extract<
    FitnessProjectionPointerSnapshot,
    { readonly status: "active" | "stale" }
  >;
  readonly reasonCode: string;
  readonly changedAt: string;
}): Buffer {
  validateReasonCode(options.reasonCode);
  return buildPointer({
    schema_version: "stella.context-projection-pointer/v1",
    instance_id: options.instanceId,
    producer_id: PRODUCER_ID,
    consumer_id: CONSUMER_ID,
    status: "stale",
    last_verified_revision: options.previous.projectionRevision,
    manifest_checksum: options.previous.manifestChecksum,
    source_revision: options.previous.sourceRevision,
    as_of: options.previous.asOf,
    changed_at: options.changedAt,
    reason_codes: [options.reasonCode],
  });
}

function buildUnavailablePointer(options: {
  readonly instanceId: string;
  readonly status: "blocked" | "revoked";
  readonly sourceRevision: string;
  readonly reasonCode: string;
  readonly changedAt: string;
}): Buffer {
  validateReasonCode(options.reasonCode);
  return buildPointer({
    schema_version: "stella.context-projection-pointer/v1",
    instance_id: options.instanceId,
    producer_id: PRODUCER_ID,
    consumer_id: CONSUMER_ID,
    status: options.status,
    source_revision: options.sourceRevision,
    changed_at: options.changedAt,
    reason_codes: [options.reasonCode],
  });
}

function buildPointer(
  value: Readonly<Record<string, unknown>> & { readonly changed_at: string },
): Buffer {
  const {
    changed_at: _changedAt,
    schema_version: _pointerSchema,
    ...seed
  } = value;
  return canonicalizeJcs({
    ...value,
    pointer_revision: `pointer-${sha256Hex(canonicalizeJcs({
      schema_version: "stella.context-projection-pointer-revision-seed/v1",
      ...seed,
    }))}`,
  });
}

function requireVerifiedPointer(
  pointer: FitnessProjectionPointerSnapshot | undefined,
): Extract<
  FitnessProjectionPointerSnapshot,
  { readonly status: "active" | "stale" }
> {
  if (pointer?.status !== "active" && pointer?.status !== "stale") {
    throw new Error("FITNESS_PROJECTION_STALE_WITHOUT_VERIFIED_REVISION");
  }
  return pointer;
}

function validateReasonCode(reasonCode: string): void {
  if (!/^[A-Z][A-Z0-9_]{0,63}$/u.test(reasonCode)) {
    throw new Error("FITNESS_PROJECTION_POINTER_INVALID");
  }
}

function parseProjectionPointer(bytes: Buffer): FitnessProjectionPointerSnapshot {
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error("FITNESS_PROJECTION_POINTER_INVALID");
  }
  if (!isRecord(value) || !canonicalizeJcs(value).equals(bytes)) {
    throw new Error("FITNESS_PROJECTION_POINTER_INVALID");
  }
  const status = value.status;
  if (
    value.schema_version !== "stella.context-projection-pointer/v1" ||
    value.producer_id !== PRODUCER_ID || value.consumer_id !== CONSUMER_ID ||
    typeof value.instance_id !== "string" ||
    typeof value.pointer_revision !== "string" ||
    !/^pointer-[a-f0-9]{64}$/u.test(value.pointer_revision) ||
    typeof value.source_revision !== "string" ||
    typeof value.changed_at !== "string" ||
    (status !== "active" && status !== "stale" &&
      status !== "blocked" && status !== "revoked")
  ) throw new Error("FITNESS_PROJECTION_POINTER_INVALID");
  canonicalTimestamp(value.changed_at);
  const {
    pointer_revision: pointerRevision,
    changed_at: _changedAt,
    schema_version: _pointerSchema,
    ...pointerSeed
  } = value;
  const expectedRevision = `pointer-${sha256Hex(canonicalizeJcs({
    schema_version: "stella.context-projection-pointer-revision-seed/v1",
    ...pointerSeed,
  }))}`;
  if (pointerRevision !== expectedRevision) {
    throw new Error("FITNESS_PROJECTION_POINTER_INVALID");
  }
  if (status === "blocked" || status === "revoked") {
    if (
      Object.keys(value).sort().join(",") !== [
        "schema_version", "instance_id", "producer_id", "consumer_id", "status",
        "pointer_revision", "source_revision", "changed_at", "reason_codes",
      ].sort().join(",") || !validReasonCodes(value.reason_codes)
    ) throw new Error("FITNESS_PROJECTION_POINTER_INVALID");
    return { status, sourceRevision: value.source_revision } as FitnessProjectionPointerSnapshot;
  }
  const revisionKey = status === "active"
    ? "projection_revision"
    : "last_verified_revision";
  if (
    Object.keys(value).sort().join(",") !== [
      "schema_version", "instance_id", "producer_id", "consumer_id", "status",
      "pointer_revision", revisionKey, "manifest_checksum", "source_revision",
      "as_of", "changed_at", ...(status === "stale" ? ["reason_codes"] : []),
    ].sort().join(",") ||
    typeof value[revisionKey] !== "string" ||
    !/^projection-[a-f0-9]{64}$/u.test(value[revisionKey]) ||
    typeof value.manifest_checksum !== "string" ||
    !/^sha256:[a-f0-9]{64}$/u.test(value.manifest_checksum) ||
    typeof value.as_of !== "string" ||
    (status === "stale" && !validReasonCodes(value.reason_codes))
  ) throw new Error("FITNESS_PROJECTION_POINTER_INVALID");
  canonicalTimestamp(value.as_of);
  return {
    status,
    sourceRevision: value.source_revision,
    projectionRevision: value[revisionKey],
    manifestChecksum: value.manifest_checksum,
    asOf: value.as_of,
  } as FitnessProjectionPointerSnapshot;
}

function validReasonCodes(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0 && value.length <= 16 &&
    value.every((reason) =>
      typeof reason === "string" && /^[A-Z][A-Z0-9_]{0,63}$/u.test(reason)
    ) && new Set(value).size === value.length;
}

function parseActivePointer(bytes: Buffer): {
  readonly projection_revision: string;
  readonly manifest_checksum: string;
  readonly source_revision: string;
} {
  const parsed = parseProjectionPointer(bytes);
  if (parsed.status !== "active") {
    throw new Error("FITNESS_PROJECTION_POINTER_INVALID");
  }
  return {
    projection_revision: parsed.projectionRevision,
    manifest_checksum: parsed.manifestChecksum,
    source_revision: parsed.sourceRevision,
  };
}

async function atomicWriteFile(path: string, bytes: Buffer): Promise<void> {
  const temporary = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
  try {
    await durableWrite(temporary, bytes);
    await rename(temporary, path);
    await syncDirectory(dirname(path));
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

async function durableWrite(path: string, bytes: Buffer): Promise<void> {
  const handle = await open(path, "wx", 0o600);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function validatePublicationRoot(repository: string, candidate: string): string {
  const metadata = lstatSync(candidate);
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    throw new Error("FITNESS_PROJECTION_PATH_INVALID");
  }
  const canonical = realpathSync(candidate);
  const child = relative(repository, canonical);
  if (child.length === 0 || child.startsWith(`..${sep}`) || child === "..") {
    throw new Error("FITNESS_PROJECTION_PATH_INVALID");
  }
  return canonical;
}

async function readSafeCanonicalFile(path: string, root: string): Promise<Buffer> {
  const child = relative(root, path);
  if (child.length === 0 || child.startsWith(`..${sep}`) || child === "..") {
    throw new Error("FITNESS_PROJECTION_SOURCE_PATH_INVALID");
  }
  const metadata = lstatSync(path);
  if (metadata.isSymbolicLink() || !metadata.isFile() || metadata.nlink !== 1) {
    throw new Error("FITNESS_PROJECTION_SOURCE_PATH_INVALID");
  }
  if (metadata.size < 1 || metadata.size > 1_048_576) {
    throw new Error("FITNESS_PROJECTION_SOURCE_OVERSIZE");
  }
  if (!realpathSync(path).startsWith(`${realpathSync(root)}${sep}`)) {
    throw new Error("FITNESS_PROJECTION_SOURCE_PATH_INVALID");
  }
  return await readFile(path);
}

async function readSafePublishedFile(path: string, root: string): Promise<Buffer> {
  const metadata = lstatSync(path);
  if (metadata.isSymbolicLink() || !metadata.isFile() || metadata.nlink !== 1) {
    throw new Error("FITNESS_PROJECTION_REVISION_TAMPERED");
  }
  if (!realpathSync(path).startsWith(`${realpathSync(root)}${sep}`)) {
    throw new Error("FITNESS_PROJECTION_REVISION_TAMPERED");
  }
  return await readFile(path);
}

async function readOptionalSafePublishedFile(
  path: string,
  root: string,
): Promise<Buffer | undefined> {
  try {
    return await readSafePublishedFile(path, root);
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw error;
  }
}

function parseBodyWeightObservation(
  bytes: Buffer,
  expectedId: string,
): BodyWeightObservation {
  const value = JSON.parse(bytes.toString("utf8")) as BodyWeightObservation;
  if (value.id !== expectedId || value.kind !== "body-weight") {
    throw new Error("FITNESS_PROJECTION_SOURCE_INVALID");
  }
  canonicalTimestamp(value.provenance.recordedAt);
  return value;
}

function canonicalTimestamp(value: string): string {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new Error("FITNESS_PROJECTION_TIMESTAMP_INVALID");
  }
  return value;
}

function decodeUtf8(bytes: Buffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("FITNESS_PROJECTION_REVISION_TAMPERED");
  }
}

function projectionRevisionFor(seed: ProjectionRevisionSeed): string {
  return `projection-${sha256Hex(canonicalizeJcs({
    schema_version: "stella.context-projection-revision-seed/v1",
    ...seed,
  }))}`;
}

function checksum(bytes: Uint8Array): string {
  return `sha256:${sha256Hex(bytes)}`;
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function isAlreadyExists(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "EEXIST";
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
