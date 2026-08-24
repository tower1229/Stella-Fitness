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
import { readActiveProgramIfPresent } from "../program/state.js";
import { rebuildBodyWeightView } from "../storage/body-weight.js";
import { rebuildTrainingRecordView } from "../storage/training-record.js";
import {
  canonicalizeJcs,
  canonicalTextBytes,
  resolveStellaPersonalDataPaths,
} from "./runtime-contract.js";

const PRODUCER_ID = "stella-fitness" as const;
const CONSUMER_ID = "stella-runtime" as const;
const DESIRED_SET_SCHEMA = "stella-fitness/fitness-history-context/v1";
const SOURCE_SNAPSHOT_SCHEMA = "stella-fitness/projection-source-snapshot/v1";
const MANIFEST_FILE = "manifest.json";
const PAYLOAD_PATH = "payloads/fitness-history.json";
const SEARCH_PAYLOAD_PATH = "payloads/fitness-history.md";
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

type FitnessHistoryDocument = {
  readonly id: string;
  readonly category: "body-weight" | "program" | "strength-test" | "workout";
  readonly source_reference_ids: readonly string[];
  readonly facts: Readonly<Record<string, unknown>>;
};

type FitnessProjectionSnapshot = {
  readonly sourceRevision: string;
  readonly sourceAsOf: string;
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
  readonly reusedRevision: boolean;
};

export async function publishFitnessContextProjection(options: {
  readonly openclawConfig: unknown;
  readonly generatedAt?: string;
  readonly testHooks?: {
    readonly afterLock?: () => Promise<void> | void;
    readonly crashAfterPhase?: FitnessProjectionPublishPhase;
    readonly now?: () => Date;
    readonly isProcessAlive?: (pid: number) => boolean;
    readonly afterSourceSnapshot?: () => Promise<void> | void;
  };
}): Promise<FitnessProjectionPublishResult> {
  const paths = resolveStellaPersonalDataPaths(options.openclawConfig);
  const publicationRoot = validatePublicationRoot(paths.repository, paths.fitnessToRuntime);
  const snapshot = await buildFitnessProjectionSnapshot(
    paths.fitnessData,
    options.testHooks?.afterSourceSnapshot,
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
    publication,
  });
  let preserveLock = false;
  try {
    await options.testHooks?.afterLock?.();
    crashAtPhase(options.testHooks?.crashAfterPhase, "locked");
    const revisionsRoot = join(publicationRoot, "revisions");
    const revisionDirectory = join(revisionsRoot, publication.projectionRevision);
    await mkdir(revisionsRoot, { recursive: true, mode: 0o700 });

    const existing = await readExistingPublication(revisionDirectory, publication);
    const committed = existing ?? await writeImmutableRevision({
      revisionsRoot,
      revisionDirectory,
      publication,
      ownerToken: lock.ownerToken,
      async candidateWritten() {
        await setPublishLockPhase(lock, "candidate-written");
        crashAtPhase(options.testHooks?.crashAfterPhase, "candidate-written");
      },
    });
    await setPublishLockPhase(lock, "revision-renamed");
    crashAtPhase(options.testHooks?.crashAfterPhase, "revision-renamed");
    const activePath = join(publicationRoot, "active.json");
    const currentPointer = await readFile(activePath).catch((error: unknown) => {
      if (isMissing(error)) return undefined;
      throw error;
    });
    const pointerBytes = buildActivePointer({
      instanceId: paths.instanceId,
      publication: committed,
      changedAt: generatedAt,
    });
    if (currentPointer !== undefined) parseActivePointer(currentPointer);
    if (currentPointer === undefined || !pointerTargets(currentPointer, committed)) {
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
      reusedRevision: existing !== undefined,
    };
  } catch (error) {
    preserveLock = error instanceof SimulatedProjectionCrash;
    throw error;
  } finally {
    if (!preserveLock) await releasePublishLock(lock);
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
  readonly publication: ProjectionPublication;
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
        publication: options.publication,
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
  readonly publication: ProjectionPublication;
  readonly now: Date;
  readonly isProcessAlive: (pid: number) => boolean;
}): Promise<void> {
  const bytes = await readSafePublishedFile(options.path, options.publicationRoot);
  const record = parsePublishLock(bytes);
  const lease = new Date(record.lease_expires_at);
  if (lease.getTime() > options.now.getTime() || options.isProcessAlive(record.owner_pid)) {
    throw new Error("FITNESS_PROJECTION_LOCKED");
  }
  if (
    record.target_source_revision !== options.publication.manifest.source.revision ||
    record.target_projection_revision !== options.publication.projectionRevision
  ) {
    throw new Error("FITNESS_PROJECTION_RECOVERY_BLOCKED");
  }
  const revisionsRoot = join(options.publicationRoot, "revisions");
  const revisionDirectory = join(revisionsRoot, record.target_projection_revision);
  const candidate = join(
    revisionsRoot,
    `.tmp-${record.target_projection_revision}-${record.owner_token}`,
  );
  if (record.phase === "candidate-written") {
    await removeRecoveryCandidate(candidate, revisionsRoot);
  }
  if (
    record.phase === "revision-renamed" ||
    record.phase === "pointer-replaced" ||
    record.phase === "committed"
  ) {
    const existing = await readExistingPublication(
      revisionDirectory,
      options.publication,
    );
    if (existing === undefined) throw new Error("FITNESS_PROJECTION_RECOVERY_BLOCKED");
    if (record.phase === "pointer-replaced" || record.phase === "committed") {
      const pointer = await readFile(join(options.publicationRoot, "active.json"));
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
  afterSourceSnapshot?: () => Promise<void> | void,
): Promise<FitnessProjectionSnapshot> {
  const initialInventory = await canonicalSourceInventory(personalDataDirectory);
  const activeProgram = await readActiveProgramIfPresent({ personalDataDirectory });
  const bodyWeight = await rebuildBodyWeightView(personalDataDirectory);
  const trainingRecord = await rebuildTrainingRecordView(personalDataDirectory);
  const strengthTests = await rebuildStrengthTestHistory(personalDataDirectory);
  if (
    bodyWeight.errors.length > 0 ||
    trainingRecord.errors.length > 0 ||
    strengthTests.errors.length > 0
  ) {
    throw new Error("FITNESS_PROJECTION_SOURCE_INVALID");
  }
  const references: Array<Omit<ProjectionSourceReference, "revision">> = [];
  const documents: FitnessHistoryDocument[] = [];
  const sourceTimes: string[] = [];
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
    throw new Error("FITNESS_PROJECTION_SOURCE_EMPTY");
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

async function canonicalSourceInventory(
  personalDataDirectory: string,
): Promise<readonly { readonly path: string; readonly checksum: string }[]> {
  const roots = [
    join(personalDataDirectory, "program"),
    join(personalDataDirectory, "observations", "body-weight"),
    join(personalDataDirectory, "observations", "special-session"),
    join(personalDataDirectory, "observations", "workout-log"),
  ];
  const files: string[] = [];
  for (const root of roots) {
    await collectCanonicalJsonFiles(root, personalDataDirectory, files);
  }
  const inventory: Array<{ path: string; checksum: string }> = [];
  for (const path of files.sort()) {
    inventory.push({
      path: relative(personalDataDirectory, path).split(sep).join("/"),
      checksum: checksum(await readSafeCanonicalFile(path, personalDataDirectory)),
    });
  }
  return inventory;
}

type StrengthTestHistoryObservation = {
  readonly id: string;
  readonly exerciseId: string;
  readonly occurredAt: string;
  readonly result: {
    readonly test: "12RM";
    readonly unit: "kg";
    readonly value: number;
  };
  readonly provenance: {
    readonly kind:
      | "course-start-12rm-recording"
      | "course-start-12rm-correction"
      | "course-start-12rm-deletion";
    readonly recordedAt: string;
    readonly replacesObservationId?: string;
  };
};

async function rebuildStrengthTestHistory(personalDataDirectory: string): Promise<{
  readonly active: readonly StrengthTestHistoryObservation[];
  readonly recordedAt: readonly string[];
  readonly errors: readonly string[];
}> {
  const directory = join(personalDataDirectory, "observations", "special-session");
  const entries = await readdir(directory, { withFileTypes: true }).catch(
    (error: unknown) => {
      if (isMissing(error)) return [];
      throw error;
    },
  );
  const observations: StrengthTestHistoryObservation[] = [];
  const errors: string[] = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    try {
      const bytes = await readSafeCanonicalFile(
        join(directory, entry.name),
        personalDataDirectory,
      );
      const observation = parseStrengthTestObservation(bytes);
      if (entry.name !== `${observation.id}.json`) {
        throw new Error("FITNESS_PROJECTION_SOURCE_INVALID");
      }
      observations.push(observation);
    } catch {
      errors.push(entry.name);
    }
  }
  const replacements = new Map<string, StrengthTestHistoryObservation>();
  for (const observation of observations) {
    const replacedId = observation.provenance.replacesObservationId;
    if (replacedId === undefined) continue;
    if (replacements.has(replacedId)) {
      errors.push(`${replacedId}:multiple-replacements`);
    }
    replacements.set(replacedId, observation);
  }
  const replacedIds = new Set(replacements.keys());
  const validIds = new Set(observations.filter((observation) =>
    validStrengthTestLineage(observation, observations, new Set())
  ).map(({ id }) => id));
  if (validIds.size !== observations.length) errors.push("invalid-lineage");
  const active = observations.filter((observation) =>
    !replacedIds.has(observation.id) &&
    observation.provenance.kind !== "course-start-12rm-deletion" &&
    validIds.has(observation.id)
  );
  return {
    active: active.sort((left, right) => left.id.localeCompare(right.id)),
    recordedAt: observations.map(({ provenance }) => provenance.recordedAt),
    errors,
  };
}

function validStrengthTestLineage(
  observation: StrengthTestHistoryObservation,
  observations: readonly StrengthTestHistoryObservation[],
  visited: Set<string>,
): boolean {
  if (visited.has(observation.id)) return false;
  visited.add(observation.id);
  const replacedId = observation.provenance.replacesObservationId;
  if (replacedId === undefined) {
    return observation.provenance.kind === "course-start-12rm-recording";
  }
  const replaced = observations.find(({ id }) => id === replacedId);
  return replaced !== undefined &&
    replaced.exerciseId === observation.exerciseId &&
    validStrengthTestLineage(replaced, observations, visited);
}

function parseStrengthTestObservation(bytes: Buffer): StrengthTestHistoryObservation {
  const value: unknown = JSON.parse(bytes.toString("utf8"));
  if (
    !isRecord(value) ||
    value.schemaVersion !== "stella-fitness/observation/course-start-12rm/v0.1" ||
    typeof value.id !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value.id) ||
    value.kind !== "course-start-12rm" ||
    typeof value.exerciseId !== "string" ||
    typeof value.occurredAt !== "string" ||
    !isRecord(value.result) ||
    value.result.test !== "12RM" ||
    value.result.unit !== "kg" ||
    typeof value.result.value !== "number" ||
    !Number.isFinite(value.result.value) ||
    value.result.value <= 0 ||
    !isRecord(value.provenance) ||
    ![
      "course-start-12rm-recording",
      "course-start-12rm-correction",
      "course-start-12rm-deletion",
    ].includes(String(value.provenance.kind)) ||
    typeof value.provenance.recordedAt !== "string" ||
    (value.provenance.kind !== "course-start-12rm-recording" &&
      typeof value.provenance.replacesObservationId !== "string")
  ) {
    throw new Error("FITNESS_PROJECTION_SOURCE_INVALID");
  }
  canonicalTimestamp(value.occurredAt);
  canonicalTimestamp(value.provenance.recordedAt);
  return value as unknown as StrengthTestHistoryObservation;
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
  const payloadBytes = canonicalizeJcs(options.desiredSet);
  const searchBytes = canonicalTextBytes(renderSearchableDesiredSet(options.desiredSet));
  if (
    payloadBytes.byteLength < 1 ||
    payloadBytes.byteLength > 1_048_576 ||
    searchBytes.byteLength < 1 ||
    searchBytes.byteLength > 1_048_576
  ) {
    throw new Error("FITNESS_PROJECTION_PAYLOAD_OVERSIZE");
  }
  const payloadChecksum = checksum(payloadBytes);
  const searchChecksum = checksum(searchBytes);
  const payloads = [{
    path: PAYLOAD_PATH,
    media_type: "application/json" as const,
    byte_length: payloadBytes.byteLength,
    checksum: payloadChecksum,
  }, {
    path: SEARCH_PAYLOAD_PATH,
    media_type: "text/markdown" as const,
    byte_length: searchBytes.byteLength,
    checksum: searchChecksum,
  }];
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
  const revisionSeed = {
    schema_version: "stella.context-projection-revision-seed/v1",
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
  const projectionRevision = `projection-${sha256Hex(canonicalizeJcs(revisionSeed))}`;
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
    payloads: [{
      path: PAYLOAD_PATH,
      bytes: payloadBytes,
      checksum: payloadChecksum,
    }, {
      path: SEARCH_PAYLOAD_PATH,
      bytes: searchBytes,
      checksum: searchChecksum,
    }],
  };
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
  readonly candidateWritten: () => Promise<void>;
}): Promise<ProjectionPublication> {
  const candidate = join(
    options.revisionsRoot,
    `.tmp-${options.publication.projectionRevision}-${options.ownerToken}`,
  );
  try {
    await mkdir(join(candidate, "payloads"), { recursive: true, mode: 0o700 });
    for (const payload of options.publication.payloads) {
      await durableWrite(join(candidate, payload.path), payload.bytes);
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
  const manifestBytes = await readFile(join(revisionDirectory, MANIFEST_FILE)).catch(
    (error: unknown) => {
      if (isMissing(error)) return undefined;
      throw error;
    },
  );
  if (manifestBytes === undefined) return undefined;
  const manifest = JSON.parse(manifestBytes.toString("utf8")) as ProjectionManifest;
  if (!canonicalizeJcs(manifest).equals(manifestBytes)) {
    throw new Error("FITNESS_PROJECTION_REVISION_TAMPERED");
  }
  const { generated_at: _storedGeneratedAt, ...storedSemantic } = manifest;
  const { generated_at: _expectedGeneratedAt, ...expectedSemantic } = expected.manifest;
  if (
    !canonicalizeJcs(storedSemantic).equals(canonicalizeJcs(expectedSemantic)) ||
    canonicalTimestamp(manifest.generated_at) !== manifest.generated_at
  ) {
    throw new Error("FITNESS_PROJECTION_REVISION_TAMPERED");
  }
  for (const payload of expected.payloads) {
    const bytes = await readSafePublishedFile(
      join(revisionDirectory, payload.path),
      revisionDirectory,
    );
    if (checksum(bytes) !== payload.checksum) {
      throw new Error("FITNESS_PROJECTION_REVISION_TAMPERED");
    }
  }
  const activePath = join(dirname(dirname(revisionDirectory)), "active.json");
  const active = await readFile(activePath).catch((error: unknown) => {
    if (isMissing(error)) return undefined;
    throw error;
  });
  if (active !== undefined) {
    const pointer = parseActivePointer(active);
    if (
      pointer.projection_revision === expected.projectionRevision &&
      pointer.manifest_checksum !== checksum(manifestBytes)
    ) {
      throw new Error("FITNESS_PROJECTION_REVISION_TAMPERED");
    }
  }
  return {
    ...expected,
    manifest,
    manifestBytes,
    manifestChecksum: checksum(manifestBytes),
  };
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

function parseActivePointer(bytes: Buffer): {
  readonly projection_revision: string;
  readonly manifest_checksum: string;
  readonly source_revision: string;
} {
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error("FITNESS_PROJECTION_POINTER_INVALID");
  }
  if (
    !isRecord(value) ||
    Object.keys(value).sort().join(",") !== [
      "as_of",
      "changed_at",
      "consumer_id",
      "instance_id",
      "manifest_checksum",
      "pointer_revision",
      "producer_id",
      "projection_revision",
      "schema_version",
      "source_revision",
      "status",
    ].sort().join(",") ||
    value.schema_version !== "stella.context-projection-pointer/v1" ||
    value.producer_id !== PRODUCER_ID ||
    value.consumer_id !== CONSUMER_ID ||
    value.status !== "active" ||
    typeof value.instance_id !== "string" ||
    typeof value.pointer_revision !== "string" ||
    !/^pointer-[a-f0-9]{64}$/u.test(value.pointer_revision) ||
    typeof value.projection_revision !== "string" ||
    !/^projection-[a-f0-9]{64}$/u.test(value.projection_revision) ||
    typeof value.manifest_checksum !== "string" ||
    !/^sha256:[a-f0-9]{64}$/u.test(value.manifest_checksum) ||
    typeof value.source_revision !== "string" ||
    typeof value.as_of !== "string" ||
    typeof value.changed_at !== "string" ||
    !canonicalizeJcs(value).equals(bytes)
  ) {
    throw new Error("FITNESS_PROJECTION_POINTER_INVALID");
  }
  canonicalTimestamp(value.as_of);
  canonicalTimestamp(value.changed_at);
  const { pointer_revision: _pointerRevision, changed_at: _changedAt, ...seed } = value;
  const expectedRevision = `pointer-${sha256Hex(canonicalizeJcs({
    schema_version: "stella.context-projection-pointer-revision-seed/v1",
    instance_id: seed.instance_id,
    producer_id: seed.producer_id,
    consumer_id: seed.consumer_id,
    status: seed.status,
    projection_revision: seed.projection_revision,
    manifest_checksum: seed.manifest_checksum,
    source_revision: seed.source_revision,
    as_of: seed.as_of,
  }))}`;
  if (value.pointer_revision !== expectedRevision) {
    throw new Error("FITNESS_PROJECTION_POINTER_INVALID");
  }
  return value as unknown as {
    readonly projection_revision: string;
    readonly manifest_checksum: string;
    readonly source_revision: string;
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
