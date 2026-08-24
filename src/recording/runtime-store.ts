import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type {
  NaturalRecordingReceipt,
  NaturalRecordingReceiptStore,
} from "./coordinator.js";
import type { FitnessWriteCandidate } from "./openclaw.js";

const DIRECTORY = "natural-recording-receipts";
const KEY_PATTERN = /^[a-f0-9]{64}$/u;

export function createRuntimeNaturalRecordingReceiptStore(options: {
  readonly runtimeDirectory: () => string;
}): NaturalRecordingReceiptStore {
  const pathFor = (key: string): string => {
    if (!KEY_PATTERN.test(key)) throw new Error("Invalid natural recording receipt key");
    return join(options.runtimeDirectory(), DIRECTORY, `${key}.json`);
  };
  return {
    async read(key) {
      try {
        return parseReceipt(JSON.parse(await readFile(pathFor(key), "utf8")) as unknown);
      } catch (error) {
        if (isMissingFileError(error)) return undefined;
        throw error;
      }
    },
    async write(key, value) {
      const directory = join(options.runtimeDirectory(), DIRECTORY);
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const path = pathFor(key);
      const temporaryPath = `${path}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
          encoding: "utf8",
          flag: "wx",
          mode: 0o600,
        });
        await rename(temporaryPath, path);
      } finally {
        await unlink(temporaryPath).catch(() => undefined);
      }
    },
    async delete(key) {
      try {
        await unlink(pathFor(key));
        return true;
      } catch (error) {
        if (isMissingFileError(error)) return false;
        throw error;
      }
    },
  };
}

function parseReceipt(value: unknown): NaturalRecordingReceipt {
  if (!isRecord(value) || !isRecord(value.source)) {
    throw new Error("Invalid natural recording receipt");
  }
  const candidate = parseCandidate(value.candidate);
  if (
    value.schemaVersion !== "stella-fitness/natural-recording-receipt/v0.1" ||
    typeof value.candidateId !== "string" ||
    candidate === undefined ||
    typeof value.sourceMessage !== "string" ||
    typeof value.issuedAt !== "string" ||
    typeof value.canonicalBase !== "string" ||
    (value.source.channel !== undefined && typeof value.source.channel !== "string") ||
    (value.source.messageId !== undefined && typeof value.source.messageId !== "string") ||
    (value.source.runId !== undefined && typeof value.source.runId !== "string")
  ) throw new Error("Invalid natural recording receipt");
  return {
    schemaVersion: value.schemaVersion,
    candidateId: value.candidateId,
    candidate,
    sourceMessage: value.sourceMessage,
    source: {
      ...(value.source.channel === undefined ? {} : { channel: value.source.channel }),
      ...(value.source.messageId === undefined ? {} : { messageId: value.source.messageId }),
      ...(value.source.runId === undefined ? {} : { runId: value.source.runId }),
    },
    issuedAt: value.issuedAt,
    canonicalBase: value.canonicalBase,
  };
}

function parseCandidate(value: unknown): FitnessWriteCandidate | undefined {
  if (!isRecord(value) || typeof value.occurredAt !== "string") return undefined;
  if (
    value.kind === "body-weight" &&
    typeof value.amount === "number" &&
    Number.isFinite(value.amount) &&
    value.amount > 0 &&
    (value.unit === "kg" || value.unit === "lb")
  ) {
    return {
      kind: value.kind,
      amount: value.amount,
      unit: value.unit,
      occurredAt: value.occurredAt,
    };
  }
  if (
    value.kind === "initial-12rm" &&
    (value.exerciseId === "goblet-squat" ||
      value.exerciseId === "dumbbell-bench-press" ||
      value.exerciseId === "dumbbell-deadlift") &&
    typeof value.valueKg === "number" &&
    Number.isFinite(value.valueKg) &&
    value.valueKg > 0
  ) {
    return {
      kind: value.kind,
      exerciseId: value.exerciseId,
      valueKg: value.valueKg,
      occurredAt: value.occurredAt,
    };
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMissingFileError(error: unknown): boolean {
  return isRecord(error) && error.code === "ENOENT";
}
