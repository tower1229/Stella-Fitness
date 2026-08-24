import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type {
  NaturalRecordingReceipt,
  NaturalRecordingReceiptStore,
} from "./coordinator.js";
import {
  fitnessWriteCandidateFields,
  parseFitnessWriteCandidate,
} from "./candidate.js";

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
  const candidate = parseFitnessWriteCandidate(value.candidate);
  if (
    value.schemaVersion !== "stella-fitness/natural-recording-receipt/v0.1" ||
    typeof value.candidateId !== "string" ||
    candidate === undefined ||
    typeof value.sourceMessage !== "string" ||
    typeof value.issuedAt !== "string" ||
    typeof value.expiresAt !== "string" ||
    Number.isNaN(Date.parse(value.expiresAt)) ||
    typeof value.canonicalFitnessStateDigest !== "string" ||
    !sameFields(value.fields, fitnessWriteCandidateFields(candidate)) ||
    (value.source.channel !== undefined && typeof value.source.channel !== "string") ||
    (value.source.messageId !== undefined && typeof value.source.messageId !== "string") ||
    (value.source.runId !== undefined && typeof value.source.runId !== "string")
  ) throw new Error("Invalid natural recording receipt");
  return {
    schemaVersion: value.schemaVersion,
    candidateId: value.candidateId,
    candidate,
    fields: fitnessWriteCandidateFields(candidate),
    sourceMessage: value.sourceMessage,
    source: {
      ...(value.source.channel === undefined ? {} : { channel: value.source.channel }),
      ...(value.source.messageId === undefined ? {} : { messageId: value.source.messageId }),
      ...(value.source.runId === undefined ? {} : { runId: value.source.runId }),
    },
    issuedAt: value.issuedAt,
    expiresAt: value.expiresAt,
    canonicalFitnessStateDigest: value.canonicalFitnessStateDigest,
  };
}

function sameFields(
  value: unknown,
  expected: Readonly<Record<string, string | number>>,
): boolean {
  if (!isRecord(value)) return false;
  return JSON.stringify(value) === JSON.stringify(expected);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMissingFileError(error: unknown): boolean {
  return isRecord(error) && error.code === "ENOENT";
}
