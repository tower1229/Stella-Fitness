import { randomUUID } from "node:crypto";
import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { RawArtifactRecord } from "../domain/media.js";
import type {
  WorkoutProgramContext,
  WorkoutLogObservation,
} from "../domain/observation.js";
import type {
  PlannedSession,
  ResolvedWorkoutSession,
} from "../domain/program.js";
import type { WorkoutLogCandidate } from "../extraction/candidate.js";

const WORKOUT_LOG_OBSERVATION_DIRECTORY = join(
  "observations",
  "workout-log",
);

export async function persistWorkoutLogObservation(options: {
  readonly personalDataDirectory: string;
  readonly candidate: WorkoutLogCandidate;
  readonly artifact: RawArtifactRecord;
  readonly runId: string;
  readonly recordedAt: string;
  readonly confirmedFields?: readonly string[];
  readonly resolvedUncertainty?: WorkoutLogObservation["uncertainty"];
  readonly plannedSession?: ResolvedWorkoutSession;
  readonly replacesObservationId?: string;
  readonly occurredAt?: string;
  readonly programContext?: WorkoutProgramContext;
}): Promise<{
  readonly observation: WorkoutLogObservation;
  readonly path: string;
}> {
  if (options.candidate.uncertainFields.length > 0) {
    throw new Error("Workout-log candidate still requires confirmation");
  }
  const id = randomUUID();
  const path = join(WORKOUT_LOG_OBSERVATION_DIRECTORY, `${id}.json`);
  const { uncertainFields: _uncertainFields, ...facts } = options.candidate;
  const envelope = {
    id,
    occurredAt: options.occurredAt ?? options.artifact.provenance.receivedAt,
    source: {
      kind: "workout-log-image" as const,
      artifactId: options.artifact.id,
      path: options.artifact.path,
      sha256: options.artifact.sha256,
    },
    ...(options.programContext === undefined
      ? {}
      : { programContext: options.programContext }),
    provenance: options.replacesObservationId === undefined
      ? {
          kind: "workout-log-recording" as const,
          runId: options.runId,
          recordedAt: options.recordedAt,
          confirmedFields: options.confirmedFields ?? [],
        }
      : {
          kind: "workout-log-correction" as const,
          runId: options.runId,
          recordedAt: options.recordedAt,
          confirmedFields: options.confirmedFields ?? [],
          replacesObservationId: options.replacesObservationId,
        },
    uncertainty: options.resolvedUncertainty ?? [],
  };
  const observation: WorkoutLogObservation = "testResults" in facts
    ? {
        ...facts,
        ...envelope,
        schemaVersion:
          "stella-fitness/observation/workout-special-session/v0.1",
        kind: "workout-special-session",
        plannedSession:
          options.plannedSession ?? missingPlannedSpecialSession(),
      }
    : options.plannedSession !== undefined &&
        "recovery" in options.plannedSession &&
        options.plannedSession.recovery
      ? {
          ...facts,
          ...envelope,
          schemaVersion:
            "stella-fitness/observation/workout-recovery-session/v0.1",
          kind: "workout-recovery-session",
          plannedSession: options.plannedSession as PlannedSession & {
            readonly recovery: true;
          },
        }
      : {
          ...facts,
          ...envelope,
          schemaVersion: "stella-fitness/observation/workout-log/v0.1",
          kind: "workout-log",
        };
  await mkdir(join(options.personalDataDirectory, WORKOUT_LOG_OBSERVATION_DIRECTORY), {
    recursive: true,
    mode: 0o700,
  });
  await writeFile(
    join(options.personalDataDirectory, path),
    `${JSON.stringify(observation, null, 2)}\n`,
    { encoding: "utf8", flag: "wx", mode: 0o600 },
  );
  return { observation, path };
}

export async function rollbackWorkoutLogObservation(options: {
  readonly personalDataDirectory: string;
  readonly path: string;
}): Promise<void> {
  await unlink(join(options.personalDataDirectory, options.path)).catch(
    (error: unknown) => {
      if (
        !(error instanceof Error && "code" in error && error.code === "ENOENT")
      ) {
        throw error;
      }
    },
  );
}

export async function relinkWorkoutLogArtifact(options: {
  readonly personalDataDirectory: string;
  readonly observation: WorkoutLogObservation;
  readonly artifact: RawArtifactRecord;
  readonly runId: string;
  readonly replacedAt: string;
}): Promise<WorkoutLogObservation> {
  if (options.observation.source.sha256 !== options.artifact.sha256) {
    throw new Error("Workout-log artifact relink must preserve the source hash");
  }
  const observation: WorkoutLogObservation = {
    ...options.observation,
    source: {
      kind: "workout-log-image",
      artifactId: options.artifact.id,
      path: options.artifact.path,
      sha256: options.artifact.sha256,
    },
    sourceHistory: [
      ...(options.observation.sourceHistory ?? []),
      {
        ...options.observation.source,
        replacedAt: options.replacedAt,
        runId: options.runId,
      },
    ],
  };
  const observationPath = join(
    options.personalDataDirectory,
    WORKOUT_LOG_OBSERVATION_DIRECTORY,
    `${observation.id}.json`,
  );
  const temporaryPath = `${observationPath}.${randomUUID()}.tmp`;
  try {
    await writeFile(
      temporaryPath,
      `${JSON.stringify(observation, null, 2)}\n`,
      { encoding: "utf8", flag: "wx", mode: 0o600 },
    );
    await rename(temporaryPath, observationPath);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
  return observation;
}

function missingPlannedSpecialSession(): never {
  throw new Error("Special-session Observation requires a planned session");
}
