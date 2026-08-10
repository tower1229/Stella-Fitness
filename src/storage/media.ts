import { createHash, randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";

import type {
  RawArtifactRecord,
  RawMediaUpload,
  WorkoutLogProcessingRecord,
} from "../domain/media.js";

const RAW_ARTIFACT_DIRECTORY = join("raw-artifacts", "workout-log");
const PROCESSING_DIRECTORY = join("processing", "workout-log");

export async function persistRawWorkoutLogArtifact(options: {
  personalDataDirectory: string;
  upload: RawMediaUpload;
}): Promise<RawArtifactRecord> {
  assertRawMediaUpload(options.upload);
  const id = randomUUID();
  const relativeDirectory = join(RAW_ARTIFACT_DIRECTORY, id);
  const directory = join(options.personalDataDirectory, relativeDirectory);
  const artifactPath = join(
    relativeDirectory,
    `original${safeExtension(options.upload)}`,
  );
  const record: RawArtifactRecord = {
    schemaVersion: "stella-fitness/raw-artifact/v0.1",
    id,
    kind: "workout-log-image",
    path: artifactPath,
    sha256: createHash("sha256").update(options.upload.bytes).digest("hex"),
    size: options.upload.bytes.length,
    originalFileName: options.upload.fileName,
    mime: options.upload.mime,
    provenance: {
      kind: "openclaw-media",
      receivedAt: new Date(options.upload.receivedAt).toISOString(),
      ...options.upload.provenance,
    },
  };

  await mkdir(directory, { recursive: true, mode: 0o700 });
  try {
    await writeFile(
      join(options.personalDataDirectory, artifactPath),
      options.upload.bytes,
      { flag: "wx", mode: 0o600 },
    );
    await writeFile(
      join(directory, "artifact.json"),
      `${JSON.stringify(record, null, 2)}\n`,
      { encoding: "utf8", flag: "wx", mode: 0o600 },
    );
    return record;
  } catch (error) {
    await rm(directory, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

export async function persistWorkoutLogProcessingRecord(options: {
  personalDataDirectory: string;
  record: Omit<WorkoutLogProcessingRecord, "id" | "path">;
}): Promise<WorkoutLogProcessingRecord> {
  const id = randomUUID();
  const path = join(PROCESSING_DIRECTORY, `${id}.json`);
  const record: WorkoutLogProcessingRecord = { ...options.record, id, path };
  await mkdir(join(options.personalDataDirectory, PROCESSING_DIRECTORY), {
    recursive: true,
    mode: 0o700,
  });
  await writeFile(
    join(options.personalDataDirectory, path),
    `${JSON.stringify(record, null, 2)}\n`,
    { encoding: "utf8", flag: "wx", mode: 0o600 },
  );
  return record;
}

function assertRawMediaUpload(upload: RawMediaUpload): void {
  if (
    upload.bytes.length === 0 ||
    upload.fileName.trim().length === 0 ||
    !["image/jpeg", "image/png", "image/webp"].includes(upload.mime) ||
    !isCanonicalTimestamp(upload.receivedAt) ||
    (upload.provenance.channel !== undefined &&
      upload.provenance.channel.trim().length === 0) ||
    (upload.provenance.messageId !== undefined &&
      upload.provenance.messageId.trim().length === 0)
  ) {
    throw new Error("Workout-log Raw Artifact upload is invalid");
  }
}

function safeExtension(upload: RawMediaUpload): string {
  const expected =
    upload.mime === "image/jpeg"
      ? ".jpg"
      : upload.mime === "image/png"
        ? ".png"
        : ".webp";
  const supplied = extname(upload.fileName).toLowerCase();
  return supplied === expected || (expected === ".jpg" && supplied === ".jpeg")
    ? supplied
    : expected;
}

function isCanonicalTimestamp(value: string): boolean {
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}
