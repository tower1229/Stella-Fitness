import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type {
  ConfirmationSessionState,
  ConfirmationSessionStore,
} from "./coordinator.js";

const STORE_DIRECTORY = "workout-log-confirmation-sessions";
const KEY_PATTERN = /^[a-f0-9]{64}$/u;

export function createRuntimeDirectoryConfirmationSessionStore(options: {
  readonly runtimeDirectory: () => string;
}): ConfirmationSessionStore {
  const pathFor = (key: string): string => {
    if (!KEY_PATTERN.test(key)) throw new Error("Invalid confirmation session key");
    return join(options.runtimeDirectory(), STORE_DIRECTORY, `${key}.json`);
  };

  return {
    async register(key, value) {
      const path = pathFor(key);
      const directory = join(options.runtimeDirectory(), STORE_DIRECTORY);
      await mkdir(directory, { recursive: true, mode: 0o700 });
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
    async lookup(key) {
      try {
        return parseConfirmationSessionState(
          JSON.parse(await readFile(pathFor(key), "utf8")) as unknown,
        );
      } catch (error) {
        if (isMissingFileError(error)) return undefined;
        throw error;
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

function parseConfirmationSessionState(value: unknown): ConfirmationSessionState {
  if (!isRecord(value)) throw new Error("Invalid confirmation session state");
  if (
    value.schemaVersion !== "stella-fitness/workout-log-confirmation-session/v0.1" ||
    typeof value.confirmationId !== "string" ||
    typeof value.issuedAt !== "string" ||
    !isRecord(value.values) ||
    (value.messageId !== undefined && typeof value.messageId !== "string") ||
    (value.ambiguous !== undefined && value.ambiguous !== true)
  ) {
    throw new Error("Invalid confirmation session state");
  }
  return {
    schemaVersion: value.schemaVersion,
    confirmationId: value.confirmationId,
    issuedAt: value.issuedAt,
    ...(value.messageId === undefined ? {} : { messageId: value.messageId }),
    values: value.values,
    ...(value.ambiguous === true ? { ambiguous: true } : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMissingFileError(error: unknown): boolean {
  return isRecord(error) && error.code === "ENOENT";
}
