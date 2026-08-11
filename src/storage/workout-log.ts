import { randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { RawArtifactRecord } from "../domain/media.js";
import type { WorkoutLogObservation } from "../domain/observation.js";
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
    occurredAt: options.artifact.provenance.receivedAt,
    source: {
      kind: "workout-log-image" as const,
      artifactId: options.artifact.id,
      path: options.artifact.path,
      sha256: options.artifact.sha256,
    },
    provenance: {
      kind: "workout-log-recording" as const,
      runId: options.runId,
      recordedAt: options.recordedAt,
      confirmedFields: options.confirmedFields ?? [],
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

function missingPlannedSpecialSession(): never {
  throw new Error("Special-session Observation requires a planned session");
}
