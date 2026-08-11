import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import type {
  TrainingRecordView,
  WorkoutLogObservation,
  WorkoutProgramContext,
} from "../domain/observation.js";
import type { WorkoutLogCandidate } from "../extraction/candidate.js";
import { parseWorkoutLogCandidate } from "../extraction/candidate.js";

const WORKOUT_LOG_OBSERVATION_DIRECTORY = join(
  "observations",
  "workout-log",
);

export async function rebuildTrainingRecordView(
  personalDataDirectory: string,
): Promise<TrainingRecordView> {
  const directory = join(personalDataDirectory, WORKOUT_LOG_OBSERVATION_DIRECTORY);
  const files = await readdir(directory).catch((error: unknown) => {
    if (isMissing(error)) return [];
    throw error;
  });
  const entries: Array<{
    file: string;
    observation: WorkoutLogObservation;
    sourceStatus: "available" | "source_missing";
  }> = [];
  const errors: Array<{ file: string; message: string }> = [];
  for (const file of files.filter((name) => name.endsWith(".json")).sort()) {
    try {
      const observation = parseWorkoutLogObservation(
        await readFile(join(directory, file), "utf8"),
      );
      if (file !== `${observation.id}.json`) {
        throw new Error("Workout-log Observation is schema-invalid");
      }
      entries.push({
        file,
        observation,
        sourceStatus: await validateArtifactReference(
          personalDataDirectory,
          observation,
        ),
      });
    } catch (error) {
      errors.push({
        file: join(WORKOUT_LOG_OBSERVATION_DIRECTORY, file),
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  const entriesById = new Map(
    entries.map((entry) => [entry.observation.id, entry.observation] as const),
  );
  const valid = entries.filter(({ file, observation }) => {
    if (hasValidLineage(observation, entriesById, new Set())) return true;
    errors.push({
      file: join(WORKOUT_LOG_OBSERVATION_DIRECTORY, file),
      message: "Workout-log Observation has invalid correction lineage",
    });
    return false;
  });
  const replacedIds = new Set(
    valid.flatMap(({ observation }) =>
      observation.provenance.kind === "workout-log-correction"
        ? [observation.provenance.replacesObservationId]
        : [],
    ),
  );
  const active = valid
    .map(({ observation }) => observation)
    .filter(({ id }) => !replacedIds.has(id))
    .sort(compareObservations);
  const seenArtifacts = new Set<string>();
  const seenLogicalWorkouts = new Set<string>();
  const records: TrainingRecordView["records"][number][] = [];
  for (const observation of active) {
    const logicalIdentity = logicalWorkoutIdentity(
      observation,
      observation.programContext,
    );
    if (
      seenArtifacts.has(observation.source.sha256) ||
      seenLogicalWorkouts.has(logicalIdentity)
    ) {
      continue;
    }
    seenArtifacts.add(observation.source.sha256);
    seenLogicalWorkouts.add(logicalIdentity);
    records.push({
      observation,
      sourceStatus: entries.find(
        (entry) => entry.observation.id === observation.id,
      )!.sourceStatus,
    });
  }
  return {
    schemaVersion: "stella-fitness/view/training-record/v0.1",
    records,
    errors,
  };
}

export async function activeTrainingRecordWithArtifactSha(
  personalDataDirectory: string,
  sha256: string,
): Promise<TrainingRecordView["records"][number] | undefined> {
  return (await rebuildTrainingRecordView(personalDataDirectory)).records.find(
    ({ observation }) => observation.source.sha256 === sha256,
  );
}

export async function activeWorkoutLogWithLogicalIdentity(
  personalDataDirectory: string,
  candidate: WorkoutLogCandidate,
  programContext?: WorkoutProgramContext,
): Promise<WorkoutLogObservation | undefined> {
  const identity = logicalWorkoutIdentity(candidate, programContext);
  return (await rebuildTrainingRecordView(personalDataDirectory)).records.find(
    ({ observation }) =>
      logicalWorkoutIdentity(observation, observation.programContext) === identity,
  )?.observation;
}

export async function activeWorkoutLogById(
  personalDataDirectory: string,
  observationId: string,
): Promise<WorkoutLogObservation | undefined> {
  return (await rebuildTrainingRecordView(personalDataDirectory)).records.find(
    ({ observation }) => observation.id === observationId,
  )?.observation;
}

export async function activeWorkoutLogCorrectionByRunId(
  personalDataDirectory: string,
  runId: string,
): Promise<WorkoutLogObservation | undefined> {
  return (await rebuildTrainingRecordView(personalDataDirectory)).records.find(
    ({ observation }) =>
      observation.provenance.kind === "workout-log-correction" &&
      observation.provenance.runId === runId,
  )?.observation;
}
function parseWorkoutLogObservation(source: string): WorkoutLogObservation {
  const value: unknown = JSON.parse(source);
  if (!isRecord(value)) return invalidObservation();
  const candidate = observationCandidate(value);
  try {
    parseWorkoutLogCandidate(candidate);
  } catch {
    return invalidObservation();
  }
  if (
    typeof value.id !== "string" ||
    !isUuid(value.id) ||
    typeof value.occurredAt !== "string" ||
    !isCanonicalTimestamp(value.occurredAt) ||
    !isArtifactSource(value.source) ||
    (value.sourceHistory !== undefined &&
      (!Array.isArray(value.sourceHistory) ||
        !value.sourceHistory.every(isHistoricalArtifactSource))) ||
    !isWorkoutProvenance(value.provenance, value.id) ||
    !Array.isArray(value.uncertainty) ||
    !value.uncertainty.every(isResolvedUncertainty) ||
    !isObservationKind(value)
  ) {
    return invalidObservation();
  }
  return value as WorkoutLogObservation;
}

function isArtifactSource(value: unknown): boolean {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["kind", "artifactId", "path", "sha256"]) ||
    value.kind !== "workout-log-image" ||
    typeof value.artifactId !== "string" ||
    !isUuid(value.artifactId) ||
    typeof value.path !== "string" ||
    typeof value.sha256 !== "string" ||
    !/^[0-9a-f]{64}$/u.test(value.sha256)
  ) {
    return false;
  }
  const match = /^raw-artifacts\/workout-log\/([0-9a-f-]{36})\/original\.(?:jpe?g|png|webp)$/iu.exec(
    value.path,
  );
  return match?.[1]?.toLowerCase() === value.artifactId.toLowerCase();
}

function isHistoricalArtifactSource(value: unknown): boolean {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      "kind",
      "artifactId",
      "path",
      "sha256",
      "replacedAt",
      "runId",
    ]) ||
    typeof value.replacedAt !== "string" ||
    !isCanonicalTimestamp(value.replacedAt) ||
    typeof value.runId !== "string" ||
    value.runId.trim().length === 0
  ) {
    return false;
  }
  const {
    replacedAt: _replacedAt,
    runId: _runId,
    ...source
  } = value;
  return isArtifactSource(source);
}

function observationCandidate(value: Record<string, unknown>): unknown {
  const fields = {
    layout: value.layout,
    stage: value.stage,
    week: value.week,
    weekday: value.weekday,
    sessionType: value.sessionType,
    uncertainFields: [],
  };
  if (value.kind === "workout-special-session") {
    return { ...fields, testResults: value.testResults };
  }
  return {
    ...fields,
    exercises: Array.isArray(value.exercises)
      ? value.exercises.map((exercise) => {
          if (!isRecord(exercise)) return exercise;
          return {
            ...exercise,
            sets: Array.isArray(exercise.sets)
              ? exercise.sets.map((set) => {
                  if (!isRecord(set)) return set;
                  const { semantic: _semantic, ...candidateSet } = set;
                  return candidateSet;
                })
              : exercise.sets,
          };
        })
      : value.exercises,
  };
}

function isObservationKind(value: Record<string, unknown>): boolean {
  const envelopeKeys = [
    "schemaVersion",
    "id",
    "kind",
    "occurredAt",
    "source",
    "provenance",
    "uncertainty",
    "layout",
    "stage",
    "week",
    "weekday",
    "sessionType",
    ...(value.programContext === undefined ? [] : ["programContext"]),
    ...(value.sourceHistory === undefined ? [] : ["sourceHistory"]),
  ];
  if (
    value.programContext !== undefined &&
    !isWorkoutProgramContext(value.programContext)
  ) {
    return false;
  }
  if (
    value.kind === "workout-log" &&
    value.schemaVersion === "stella-fitness/observation/workout-log/v0.1"
  ) {
    return hasOnlyKeys(value, [...envelopeKeys, "exercises"]) &&
      hasValidSetSemantics(value.exercises);
  }
  if (
    value.kind === "workout-recovery-session" &&
    value.schemaVersion ===
      "stella-fitness/observation/workout-recovery-session/v0.1"
  ) {
    return hasOnlyKeys(value, [...envelopeKeys, "exercises", "plannedSession"]) &&
      hasValidSetSemantics(value.exercises) &&
      isRecord(value.plannedSession) &&
      value.plannedSession.recovery === true &&
      isResolvedWorkoutSession(value.plannedSession, value);
  }
  return value.kind === "workout-special-session" &&
    value.schemaVersion ===
      "stella-fitness/observation/workout-special-session/v0.1" &&
    hasOnlyKeys(value, [...envelopeKeys, "testResults", "plannedSession"]) &&
    isRecord(value.plannedSession) &&
    Array.isArray(value.testResults) &&
    isResolvedWorkoutSession(value.plannedSession, value);
}

function isResolvedWorkoutSession(
  session: Record<string, unknown>,
  observation: Record<string, unknown>,
): boolean {
  if (!isProgramReference(session.program, observation.programContext)) {
    return false;
  }
  if (session.kind === "planned-session") {
    return hasOnlyKeys(session, [
      "kind",
      "program",
      "cycle",
      "date",
      "day",
      "type",
      "recovery",
      "exercises",
      "tests",
    ]) &&
      isRecord(session.cycle) &&
      hasOnlyKeys(session.cycle, ["startDate", "week", "phase"]) &&
      typeof session.cycle.startDate === "string" &&
      isDate(session.cycle.startDate) &&
      candidateValue(observation.week) === session.cycle.week &&
      typeof session.cycle.phase === "string" &&
      session.cycle.phase.trim().length > 0 &&
      typeof session.date === "string" &&
      isDate(session.date) &&
      candidateValue(observation.weekday) === session.day &&
      typeof session.type === "string" &&
      session.type.trim().length > 0 &&
      typeof session.recovery === "boolean" &&
      Array.isArray(session.exercises) &&
      session.exercises.every(isPlannedExercise) &&
      Array.isArray(session.tests) &&
      session.tests.every(isPlannedTest) &&
      matchesProgramCycle(session.cycle.startDate, observation.programContext);
  }
  return session.kind === "cycle-completion-retest" &&
    hasOnlyKeys(session, [
      "kind",
      "program",
      "cycle",
      "type",
      "tests",
      "restartFromWeek",
    ]) &&
    isRecord(session.cycle) &&
    hasOnlyKeys(session.cycle, ["startDate", "completedWeek"]) &&
    typeof session.cycle.startDate === "string" &&
    isDate(session.cycle.startDate) &&
    session.cycle.completedWeek === 12 &&
    session.type === "end-of-cycle-retest" &&
    Array.isArray(session.tests) &&
    session.tests.every(isPlannedTest) &&
    session.restartFromWeek === 1 &&
    matchesProgramCycle(session.cycle.startDate, observation.programContext);
}

function isProgramReference(value: unknown, context: unknown): boolean {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["id", "version", "schemaVersion"]) ||
    typeof value.id !== "string" ||
    value.id.trim().length === 0 ||
    typeof value.version !== "string" ||
    value.version.trim().length === 0 ||
    typeof value.schemaVersion !== "string" ||
    value.schemaVersion.trim().length === 0
  ) {
    return false;
  }
  return !isWorkoutProgramContext(context) ||
    (context.programId === value.id &&
      context.programVersion === value.version);
}

function matchesProgramCycle(startDate: string, context: unknown): boolean {
  return !isWorkoutProgramContext(context) || context.cycleStart === startDate;
}

function isPlannedExercise(value: unknown): boolean {
  if (
    !isRecord(value) ||
    !hasOnlyAllowedKeys(value, [
      "exerciseId",
      "displayName",
      "load",
      "prescription",
      "sets",
      "rest",
      "restSeconds",
      "effort",
      "progression",
      "assistance",
    ]) ||
    typeof value.exerciseId !== "string" ||
    value.exerciseId.trim().length === 0 ||
    !isPlannedPrescription(value.prescription)
  ) {
    return false;
  }
  return (value.displayName === undefined || typeof value.displayName === "string") &&
    (value.load === undefined || isPlannedLoad(value.load)) &&
    (value.sets === undefined || value.sets === "self_selected") &&
    (value.rest === undefined || value.rest === "self_selected") &&
    (value.restSeconds === undefined ||
      (Array.isArray(value.restSeconds) &&
        value.restSeconds.every(isNonNegativeNumber))) &&
    (value.effort === undefined || typeof value.effort === "string") &&
    (value.progression === undefined ||
      (isRecord(value.progression) &&
        hasOnlyKeys(value.progression, ["trigger", "action", "amount"]) &&
        [value.progression.trigger, value.progression.action, value.progression.amount]
          .every((item) => typeof item === "string"))) &&
    (value.assistance === undefined || isPlannedAssistance(value.assistance));
}

function isPlannedLoad(value: unknown): boolean {
  if (!isRecord(value) || typeof value.mode !== "string") return false;
  if (value.mode === "symbolic") {
    return hasOnlyKeys(value, ["mode", "symbol", "scope"]) &&
      typeof value.symbol === "string" &&
      value.symbol.trim().length > 0 &&
      value.scope === "per_exercise";
  }
  if (value.mode === "historical_reference") {
    return hasOnlyKeys(value, ["mode", "week"]) &&
      Number.isInteger(value.week) &&
      typeof value.week === "number" &&
      value.week > 0;
  }
  return (value.mode === "self_selected" || value.mode === "none") &&
    hasOnlyKeys(value, ["mode"]);
}

function isPlannedPrescription(value: unknown): boolean {
  if (!isRecord(value) || typeof value.type !== "string") return false;
  if (value.type === "sets_reps") {
    return hasOnlyKeys(value, ["type", "sets", "reps"]) &&
      isPositiveInteger(value.sets) && isNonNegativeNumber(value.reps);
  }
  if (value.type === "rep_range") {
    return hasOnlyKeys(value, ["type", "sets", "minReps", "maxReps"]) &&
      isPositiveInteger(value.sets) &&
      isNonNegativeNumber(value.minReps) &&
      isNonNegativeNumber(value.maxReps) &&
      value.minReps <= value.maxReps;
  }
  if (value.type === "total_reps") {
    return hasOnlyKeys(value, ["type", "reps"]) &&
      isNonNegativeNumber(value.reps);
  }
  if (value.type === "duration") {
    return hasOnlyKeys(value, ["type", "sets", "seconds"]) &&
      isPositiveInteger(value.sets) && isPositiveInteger(value.seconds);
  }
  return value.type === "to_failure" &&
    hasOnlyKeys(value, ["type", "sets"]) &&
    isPositiveInteger(value.sets);
}

function isPlannedTest(value: unknown): boolean {
  return isRecord(value) &&
    hasOnlyKeys(value, [
      "exerciseId",
      "test",
      "protocolRef",
      "resultBinding",
      "bindingScope",
    ]) &&
    [value.exerciseId, value.test, value.protocolRef, value.resultBinding]
      .every((item) => typeof item === "string" && item.trim().length > 0) &&
    value.bindingScope === "per_exercise";
}

function isPlannedAssistance(value: unknown): boolean {
  return isRecord(value) &&
    hasOnlyKeys(value, [
      "sourceBaseline",
      "allowedModes",
      "targetMinRepsPerSet",
      "targetMode",
      "preserveProgrammedTotalReps",
    ]) &&
    typeof value.sourceBaseline === "string" &&
    Array.isArray(value.allowedModes) &&
    value.allowedModes.every((item) => typeof item === "string") &&
    isNonNegativeNumber(value.targetMinRepsPerSet) &&
    typeof value.targetMode === "string" &&
    value.preserveProgrammedTotalReps === true;
}

function candidateValue(value: unknown): unknown {
  return isRecord(value) ? value.value : undefined;
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && typeof value === "number" && value > 0;
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function hasValidSetSemantics(exercises: unknown): boolean {
  return Array.isArray(exercises) && exercises.every((exercise) => {
    if (!isRecord(exercise) || !Array.isArray(exercise.sets)) return false;
    const exerciseId = isRecord(exercise.exerciseId)
      ? exercise.exerciseId.value
      : undefined;
    const expectedSemantic = exerciseId === "plank"
      ? "duration-seconds"
      : "repetitions";
    return exercise.sets.every(
      (set) =>
        isRecord(set) &&
        hasOnlyKeys(set, ["value", "confidence", "semantic"]) &&
        set.semantic === expectedSemantic,
    );
  });
}

function isWorkoutProvenance(value: unknown, observationId: string): boolean {
  if (
    !isRecord(value) ||
    typeof value.runId !== "string" ||
    value.runId.trim().length === 0 ||
    typeof value.recordedAt !== "string" ||
    !isCanonicalTimestamp(value.recordedAt) ||
    !Array.isArray(value.confirmedFields) ||
    !value.confirmedFields.every((field) => typeof field === "string")
  ) {
    return false;
  }
  if (value.kind === "workout-log-recording") {
    return hasOnlyKeys(value, [
      "kind",
      "runId",
      "recordedAt",
      "confirmedFields",
    ]);
  }
  return value.kind === "workout-log-correction" &&
    hasOnlyKeys(value, [
      "kind",
      "runId",
      "recordedAt",
      "confirmedFields",
      "replacesObservationId",
    ]) &&
    typeof value.replacesObservationId === "string" &&
    isUuid(value.replacesObservationId) &&
    value.replacesObservationId !== observationId;
}

function isResolvedUncertainty(value: unknown): boolean {
  return isRecord(value) &&
    hasOnlyKeys(
      value,
      value.candidates === undefined
        ? ["path", "kind", "resolution"]
        : ["path", "kind", "candidates", "resolution"],
    ) &&
    typeof value.path === "string" &&
    value.path.trim().length > 0 &&
    ["unknown", "low-confidence", "conflict", "confirmation-required"].includes(
      String(value.kind),
    ) &&
    value.resolution === "user-confirmed" &&
    (value.candidates === undefined ||
      (Array.isArray(value.candidates) &&
        value.candidates.every(
          (candidate) => typeof candidate === "string" && candidate.length > 0,
        )));
}

function hasValidLineage(
  observation: WorkoutLogObservation,
  observationsById: ReadonlyMap<string, WorkoutLogObservation>,
  visited: Set<string>,
): boolean {
  if (observation.provenance.kind === "workout-log-recording") return true;
  if (visited.has(observation.id)) return false;
  visited.add(observation.id);
  const replaced = observationsById.get(
    observation.provenance.replacesObservationId,
  );
  return replaced !== undefined &&
    hasValidLineage(replaced, observationsById, visited);
}

function compareObservations(
  left: WorkoutLogObservation,
  right: WorkoutLogObservation,
): number {
  return left.occurredAt.localeCompare(right.occurredAt) ||
    left.provenance.recordedAt.localeCompare(right.provenance.recordedAt) ||
    left.id.localeCompare(right.id);
}

function logicalWorkoutIdentity(
  workout: Pick<
    WorkoutLogCandidate,
    "layout" | "stage" | "week" | "weekday" | "sessionType"
  >,
  programContext?: WorkoutProgramContext,
): string {
  return [
    programContext?.programId ?? "unbound",
    programContext?.programVersion ?? "unbound",
    programContext?.cycleStart ?? "unbound",
    workout.layout.value,
    workout.stage.value,
    workout.week.value,
    workout.weekday.value,
    workout.sessionType.value,
  ].join(":");
}

function isWorkoutProgramContext(value: unknown): value is WorkoutProgramContext {
  return isRecord(value) &&
    hasOnlyKeys(value, [
      "stateId",
      "programId",
      "programVersion",
      "cycleStart",
    ]) &&
    typeof value.stateId === "string" &&
    isUuid(value.stateId) &&
    typeof value.programId === "string" &&
    value.programId.trim().length > 0 &&
    typeof value.programVersion === "string" &&
    value.programVersion.trim().length > 0 &&
    typeof value.cycleStart === "string" &&
    isDate(value.cycleStart);
}

async function validateArtifactReference(
  personalDataDirectory: string,
  observation: WorkoutLogObservation,
): Promise<"available" | "source_missing"> {
  const sourcePath = join(personalDataDirectory, observation.source.path);
  let bytes: Buffer | undefined;
  try {
    bytes = await readFile(sourcePath);
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
  const metadataPath = join(
    personalDataDirectory,
    observation.source.path.replace(/\/original\.[^/]+$/u, "/artifact.json"),
  );
  let artifact: unknown;
  try {
    artifact = JSON.parse(await readFile(metadataPath, "utf8"));
  } catch (error) {
    if (isMissing(error)) {
      return bytes === undefined
        ? "source_missing"
        : invalidArtifactReference();
    }
    throw error;
  }
  if (
    !isRecord(artifact) ||
    !hasOnlyKeys(artifact, [
      "schemaVersion",
      "id",
      "kind",
      "path",
      "sha256",
      "size",
      "originalFileName",
      "mime",
      "provenance",
    ]) ||
    artifact.schemaVersion !== "stella-fitness/raw-artifact/v0.1" ||
    artifact.id !== observation.source.artifactId ||
    artifact.kind !== "workout-log-image" ||
    artifact.path !== observation.source.path ||
    artifact.sha256 !== observation.source.sha256 ||
    typeof artifact.size !== "number" ||
    !Number.isSafeInteger(artifact.size) ||
    artifact.size <= 0 ||
    (bytes !== undefined && artifact.size !== bytes.length) ||
    typeof artifact.originalFileName !== "string" ||
    artifact.originalFileName.trim().length === 0 ||
    !["image/jpeg", "image/png", "image/webp"].includes(String(artifact.mime)) ||
    !isArtifactProvenance(artifact.provenance) ||
    (bytes !== undefined &&
      createHash("sha256").update(bytes).digest("hex") !==
        observation.source.sha256)
  ) {
    return invalidArtifactReference();
  }
  return bytes === undefined ? "source_missing" : "available";
}

function isArtifactProvenance(value: unknown): boolean {
  return isRecord(value) &&
    hasOnlyAllowedKeys(value, [
      "kind",
      "receivedAt",
      "channel",
      "messageId",
    ]) &&
    value.kind === "openclaw-media" &&
    typeof value.receivedAt === "string" &&
    isCanonicalTimestamp(value.receivedAt) &&
    (value.channel === undefined ||
      (typeof value.channel === "string" && value.channel.trim().length > 0)) &&
    (value.messageId === undefined ||
      (typeof value.messageId === "string" &&
        value.messageId.trim().length > 0));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  return Object.keys(value).length === keys.length &&
    Object.keys(value).every((key) => keys.includes(key));
}

function hasOnlyAllowedKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
    value,
  );
}

function isCanonicalTimestamp(value: string): boolean {
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

function isDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value;
}

function isMissing(error: unknown): boolean {
  return isRecord(error) && error.code === "ENOENT";
}

function invalidObservation(): never {
  throw new Error("Workout-log Observation is schema-invalid");
}

function invalidArtifactReference(): never {
  throw new Error("Workout-log Observation has invalid Raw Artifact reference");
}
