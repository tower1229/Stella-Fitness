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
import type { ConfigurationPreflightResult } from "./preflight.js";
import type { PlannedSession } from "./domain/program.js";
import {
  resolvePlannedSession,
  type ProgramResolutionInput,
} from "./program/engine.js";
import { validateProgramSpec } from "./program/validator.js";
import {
  confirmProgramSetup,
  selectProgramForSetup,
  type ProgramSetup,
  type ProgramState,
} from "./program/state.js";

export type PluginExtractionOutput = {
  status: "candidate";
  candidate: WorkoutLogCandidate;
  execution: ExtractionExecutionMetadata;
};

export type StellaFitnessRuntime = {
  preflight(): ConfigurationPreflightResult;
  selectProgram(programSpec: unknown): Promise<ProgramSetup>;
  confirmCycleStart(cycleStart: string): Promise<ProgramState>;
  resolvePlannedSession(
    input: Omit<ProgramResolutionInput, "program"> & { programSpec: unknown },
  ): PlannedSession | null;
  extractWorkoutLog(
    request: ExtractionRequest,
  ): Promise<PluginExtractionOutput>;
};

const MAX_CACHED_RUNS = 256;

type RunEntry = {
  fingerprint: string;
  promise: Promise<PluginExtractionOutput>;
  settled: boolean;
};

export function createStellaFitnessRuntime(options: {
  extractionRuntime: ExtractionRuntime;
  personalDataDirectory?: () => string | undefined;
  preflight: () => ConfigurationPreflightResult;
}): StellaFitnessRuntime {
  const runs = new Map<string, RunEntry>();
  const preflight = options.preflight;

  return {
    preflight,
    async selectProgram(programSpec) {
      assertSetupPreflight(preflight());
      const personalDataDirectory = options.personalDataDirectory?.();
      if (personalDataDirectory === undefined) {
        throw new Error("Personal Data Directory is unavailable after preflight");
      }
      return await selectProgramForSetup({
        personalDataDirectory,
        programSpec,
      });
    },
    async confirmCycleStart(cycleStart) {
      assertSetupPreflight(preflight());
      const personalDataDirectory = options.personalDataDirectory?.();
      if (personalDataDirectory === undefined) {
        throw new Error("Personal Data Directory is unavailable after preflight");
      }
      return await confirmProgramSetup({ personalDataDirectory, cycleStart });
    },
    resolvePlannedSession(input) {
      return resolvePlannedSession({
        program: validateProgramSpec(input.programSpec),
        programVersion: input.programVersion,
        cycleStart: input.cycleStart,
        date: input.date,
      });
    },
    extractWorkoutLog(request) {
      const readiness = preflight();
      if (readiness.readiness !== "READY") {
        return Promise.reject(
          new Error(
            `Stella Fitness cannot accept workout media in ${readiness.readiness}: ${readiness.reasons
              .map(({ code }) => code)
              .join(", ")}`,
          ),
        );
      }
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

function assertSetupPreflight(preflight: ConfigurationPreflightResult): void {
  if (preflight.readiness === "BLOCKED_CONFIGURATION") {
    throw new Error(
      `Stella Fitness cannot start setup in ${preflight.readiness}: ${preflight.reasons
        .map(({ code }) => code)
        .join(", ")}`,
    );
  }
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
