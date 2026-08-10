import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type {
  BodyWeightObservation,
  BodyWeightUnit,
  BodyWeightView,
  ObservationSource,
} from "../domain/observation.js";

const OBSERVATION_DIRECTORY = join("observations", "body-weight");

export async function persistBodyWeightObservation(options: {
  personalDataDirectory: string;
  amount: number;
  unit: BodyWeightUnit;
  occurredAt: string;
  source: ObservationSource;
  recordedAt: string;
}): Promise<BodyWeightObservation> {
  const observation: BodyWeightObservation = {
    schemaVersion: "stella-fitness/observation/body-weight/v0.1",
    id: randomUUID(),
    kind: "body-weight",
    value: { amount: options.amount, unit: options.unit },
    occurredAt: options.occurredAt,
    source: options.source,
    provenance: {
      kind: "body-weight-recording",
      recordedAt: options.recordedAt,
    },
  };
  const directory = join(options.personalDataDirectory, OBSERVATION_DIRECTORY);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(
    join(directory, `${observation.id}.json`),
    `${JSON.stringify(observation, null, 2)}\n`,
    { encoding: "utf8", flag: "wx", mode: 0o600 },
  );
  return observation;
}

export async function persistBodyWeightCorrection(options: {
  personalDataDirectory: string;
  replacesObservationId: string;
  amount: number;
  unit: BodyWeightUnit;
  source: ObservationSource;
  recordedAt: string;
}): Promise<BodyWeightObservation> {
  const directory = join(options.personalDataDirectory, OBSERVATION_DIRECTORY);
  const view = await rebuildBodyWeightView(options.personalDataDirectory);
  if (
    !view.points.some(
      ({ observationId }) => observationId === options.replacesObservationId,
    )
  ) {
    throw new Error(
      `Body-weight Observation ${options.replacesObservationId} is not an active fact`,
    );
  }
  const replaced = parseBodyWeightObservation(
    await readFile(
      join(directory, `${options.replacesObservationId}.json`),
      "utf8",
    ),
  );
  const correction: BodyWeightObservation = {
    schemaVersion: "stella-fitness/observation/body-weight/v0.1",
    id: randomUUID(),
    kind: "body-weight",
    value: { amount: options.amount, unit: options.unit },
    occurredAt: replaced.occurredAt,
    source: options.source,
    provenance: {
      kind: "body-weight-correction",
      recordedAt: options.recordedAt,
      replacesObservationId: replaced.id,
    },
  };
  await writeFile(
    join(directory, `${correction.id}.json`),
    `${JSON.stringify(correction, null, 2)}\n`,
    { encoding: "utf8", flag: "wx", mode: 0o600 },
  );
  return correction;
}

export async function rebuildBodyWeightView(
  personalDataDirectory: string,
): Promise<BodyWeightView> {
  const directory = join(personalDataDirectory, OBSERVATION_DIRECTORY);
  const files = await readdir(directory).catch((error: unknown) => {
    if (isMissing(error)) {
      return [];
    }
    throw error;
  });
  const observations: BodyWeightObservation[] = [];
  const errors: Array<{ file: string; message: string }> = [];
  for (const file of files.filter((name) => name.endsWith(".json")).sort()) {
    try {
      observations.push(
        parseBodyWeightObservation(await readFile(join(directory, file), "utf8")),
      );
    } catch (error) {
      errors.push({
        file: join(OBSERVATION_DIRECTORY, file),
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  const replacedIds = new Set(
    observations.flatMap(({ provenance }) =>
      provenance.kind === "body-weight-correction"
        ? [provenance.replacesObservationId]
        : [],
    ),
  );
  return {
    schemaVersion: "stella-fitness/view/body-weight/v0.1",
    points: observations
      .filter(({ id }) => !replacedIds.has(id))
      .sort(
        (left, right) =>
          left.occurredAt.localeCompare(right.occurredAt) ||
          left.id.localeCompare(right.id),
      )
      .map((observation) => ({
        observationId: observation.id,
        amount: observation.value.amount,
        unit: observation.value.unit,
        occurredAt: observation.occurredAt,
      })),
    errors,
  };
}

function parseBodyWeightObservation(source: string): BodyWeightObservation {
  const value: unknown = JSON.parse(source);
  if (
    !isRecord(value) ||
    value.schemaVersion !== "stella-fitness/observation/body-weight/v0.1" ||
    typeof value.id !== "string" ||
    value.kind !== "body-weight" ||
    !isRecord(value.value) ||
    typeof value.value.amount !== "number" ||
    !Number.isFinite(value.value.amount) ||
    (value.value.unit !== "kg" && value.value.unit !== "lb") ||
    typeof value.occurredAt !== "string" ||
    !isRecord(value.source) ||
    value.source.kind !== "user-text" ||
    typeof value.source.text !== "string" ||
    !isRecord(value.provenance) ||
    typeof value.provenance.recordedAt !== "string" ||
    (value.provenance.kind !== "body-weight-recording" &&
      value.provenance.kind !== "body-weight-correction") ||
    (value.provenance.kind === "body-weight-correction" &&
      typeof value.provenance.replacesObservationId !== "string")
  ) {
    throw new Error("Body-weight Observation is schema-invalid");
  }
  return value as BodyWeightObservation;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMissing(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}
