import { createHash } from "node:crypto";

import { rejectOnAbort } from "./extraction/cancellation.js";
import {
  parseWorkoutLogCandidate,
  type WorkoutLogCandidate,
} from "./extraction/candidate.js";
import type {
  ExtractionExecutionMetadata,
  ExtractionRequest,
  ExtractionRuntime,
} from "./extraction/runtime.js";

export type PluginExtractionOutput = {
  status: "candidate";
  candidate: WorkoutLogCandidate;
  execution: ExtractionExecutionMetadata;
};

export type StellaFitnessRuntime = {
  extractWorkoutLog(request: ExtractionRequest): Promise<PluginExtractionOutput>;
};

const MAX_CACHED_RUNS = 256;

type RunEntry = {
  fingerprint: string;
  promise: Promise<PluginExtractionOutput>;
  settled: boolean;
};

export function createStellaFitnessRuntime(options: {
  extractionRuntime: ExtractionRuntime;
}): StellaFitnessRuntime {
  const runs = new Map<string, RunEntry>();

  return {
    extractWorkoutLog(request) {
      if (request.runId.trim().length === 0) {
        return Promise.reject(new Error("Extraction run ID must not be blank"));
      }

      const fingerprint = fingerprintRequest(request);
      const existing = runs.get(request.runId);
      if (existing !== undefined) {
        if (existing.fingerprint !== fingerprint) {
          return Promise.reject(
            new Error("Extraction run ID was reused for different media"),
          );
        }
        return rejectOnAbort(existing.promise, request.signal);
      }

      const entry: RunEntry = {
        fingerprint,
        promise: executeExtraction(options.extractionRuntime, request),
        settled: false,
      };
      runs.set(request.runId, entry);
      void entry.promise.then(
        () => markSettledAndTrim(runs, entry),
        () => markSettledAndTrim(runs, entry),
      );
      return rejectOnAbort(entry.promise, request.signal);
    },
  };
}

function fingerprintRequest(request: ExtractionRequest): string {
  return createHash("sha256")
    .update(request.media.mime)
    .update("\0")
    .update(request.media.fileName)
    .update("\0")
    .update(request.media.bytes)
    .digest("hex");
}

function markSettledAndTrim(
  runs: Map<string, RunEntry>,
  settledEntry: RunEntry,
): void {
  settledEntry.settled = true;
  while (runs.size > MAX_CACHED_RUNS) {
    const oldestSettled = [...runs].find(([, entry]) => entry.settled);
    if (oldestSettled === undefined) {
      return;
    }
    runs.delete(oldestSettled[0]);
  }
}

async function executeExtraction(
  extractionRuntime: ExtractionRuntime,
  request: ExtractionRequest,
): Promise<PluginExtractionOutput> {
  const result = await extractionRuntime.extract(request);
  const candidate = parseWorkoutLogCandidate(result.parsed);

  return {
    status: "candidate",
    candidate,
    execution: result.metadata,
  };
}
