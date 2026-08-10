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
  occurredAt?: string;
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
    occurredAt: options.occurredAt ?? replaced.occurredAt,
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
  const entries: Array<{
    file: string;
    observation: BodyWeightObservation;
  }> = [];
  const errors: Array<{ file: string; message: string }> = [];
  for (const file of files.filter((name) => name.endsWith(".json")).sort()) {
    try {
      const observation = parseBodyWeightObservation(
        await readFile(join(directory, file), "utf8"),
      );
      if (file !== `${observation.id}.json`) {
        throw new Error("Body-weight Observation is schema-invalid");
      }
      entries.push({ file, observation });
    } catch (error) {
      errors.push({
        file: join(OBSERVATION_DIRECTORY, file),
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  const entriesById = new Map(
    entries.map((entry) => [entry.observation.id, entry] as const),
  );
  const validEntries = entries.filter((entry) => {
    if (hasValidCorrectionLineage(entry.observation, entriesById, new Set())) {
      return true;
    }
    errors.push({
      file: join(OBSERVATION_DIRECTORY, entry.file),
      message: "Body-weight Observation has invalid correction lineage",
    });
    return false;
  });
  const observations = validEntries.map(({ observation }) => observation);
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
    !isUuid(value.id) ||
    value.kind !== "body-weight" ||
    !isRecord(value.value) ||
    typeof value.value.amount !== "number" ||
    !Number.isFinite(value.value.amount) ||
    value.value.amount <= 0 ||
    (value.value.unit !== "kg" && value.value.unit !== "lb") ||
    typeof value.occurredAt !== "string" ||
    !isCanonicalTimestamp(value.occurredAt) ||
    !isRecord(value.source) ||
    value.source.kind !== "user-text" ||
    typeof value.source.text !== "string" ||
    value.source.text.trim().length === 0 ||
    (value.source.channel !== undefined &&
      (typeof value.source.channel !== "string" ||
        value.source.channel.trim().length === 0)) ||
    (value.source.messageId !== undefined &&
      (typeof value.source.messageId !== "string" ||
        value.source.messageId.trim().length === 0)) ||
    !isRecord(value.provenance) ||
    typeof value.provenance.recordedAt !== "string" ||
    !isCanonicalTimestamp(value.provenance.recordedAt) ||
    (value.provenance.kind !== "body-weight-recording" &&
      value.provenance.kind !== "body-weight-correction") ||
    (value.provenance.kind === "body-weight-correction" &&
      (typeof value.provenance.replacesObservationId !== "string" ||
        !isUuid(value.provenance.replacesObservationId) ||
        value.provenance.replacesObservationId === value.id))
  ) {
    throw new Error("Body-weight Observation is schema-invalid");
  }
  return value as BodyWeightObservation;
}

function hasValidCorrectionLineage(
  observation: BodyWeightObservation,
  entriesById: ReadonlyMap<
    string,
    { file: string; observation: BodyWeightObservation }
  >,
  visited: Set<string>,
): boolean {
  if (observation.provenance.kind === "body-weight-recording") {
    return true;
  }
  if (visited.has(observation.id)) {
    return false;
  }
  visited.add(observation.id);
  const replaced = entriesById.get(
    observation.provenance.replacesObservationId,
  );
  return (
    replaced !== undefined &&
    hasValidCorrectionLineage(replaced.observation, entriesById, visited)
  );
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
