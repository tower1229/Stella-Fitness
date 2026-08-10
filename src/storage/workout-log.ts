import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { RawArtifactRecord } from "../domain/media.js";
import type { WorkoutLogObservation } from "../domain/observation.js";
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
  const observation: WorkoutLogObservation = {
    ...facts,
    schemaVersion: "stella-fitness/observation/workout-log/v0.1",
    id,
    kind: "workout-log",
    occurredAt: options.artifact.provenance.receivedAt,
    source: {
      kind: "workout-log-image",
      artifactId: options.artifact.id,
      path: options.artifact.path,
      sha256: options.artifact.sha256,
    },
    provenance: {
      kind: "workout-log-recording",
      runId: options.runId,
      recordedAt: options.recordedAt,
      confirmedFields: options.confirmedFields ?? [],
    },
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
