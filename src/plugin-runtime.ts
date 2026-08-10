import { createHash } from "node:crypto";

import type {
  RawArtifactRecord,
  WorkoutLogIngestRequest,
  WorkoutLogProcessingRecord,
} from "./domain/media.js";
import type {
  BodyWeightObservation,
  BodyWeightView,
  ObservationSource,
} from "./domain/observation.js";
import type { PlannedSession } from "./domain/program.js";
import {
  parseBodyWeightInput,
  type BodyWeightClarification,
} from "./extraction/body-weight.js";
import { rejectOnAbort } from "./extraction/cancellation.js";
import {
  parseWorkoutLogCandidate,
  type WorkoutLogCandidate,
} from "./extraction/candidate.js";
import type {
  ExtractionExecutionMetadata,
  ExtractionRuntime,
} from "./extraction/runtime.js";
import {
  createBufferMediaSanitizer,
  InvalidWorkoutLogImageError,
  type MediaSanitizer,
  type SanitizedMediaLease,
} from "./media/sanitizer.js";
import type { ConfigurationPreflightResult } from "./preflight.js";
import {
  resolvePlannedSession,
  type ProgramResolutionInput,
} from "./program/engine.js";
import { validateProgramSpec } from "./program/validator.js";
import {
  confirmProgramSetup,
  selectProgramForSetup,
  type PendingProgramSelection,
  type ProgramState,
} from "./program/state.js";
import {
  persistBodyWeightCorrection,
  persistBodyWeightObservation,
  rebuildBodyWeightView,
} from "./storage/body-weight.js";
import {
  persistRawWorkoutLogArtifact,
  persistWorkoutLogProcessingRecord,
} from "./storage/media.js";

export type PluginExtractionOutput = {
  status: "candidate";
  candidate: WorkoutLogCandidate;
  execution: ExtractionExecutionMetadata;
  artifact: RawArtifactRecord;
  processing: WorkoutLogProcessingRecord;
};

export type StellaFitnessRuntime = {
  preflight(): ConfigurationPreflightResult;
  selectProgram(programSpec: unknown): Promise<PendingProgramSelection>;
  confirmCycleStart(cycleStart: string): Promise<ProgramState>;
  resolvePlannedSession(
    input: Omit<ProgramResolutionInput, "program"> & { programSpec: unknown },
  ): PlannedSession | null;
  ingestWorkoutLog(
    request: WorkoutLogIngestRequest,
  ): Promise<PluginExtractionOutput>;
  shutdown(): Promise<void>;
  recordBodyWeight(input: {
    text: string;
    receivedAt: string;
    source?: Omit<ObservationSource, "kind" | "text">;
  }): Promise<
    | BodyWeightClarification
    | {
        status: "recorded";
        observation: BodyWeightObservation;
        view: BodyWeightView;
      }
  >;
  correctBodyWeight(input: {
    replacesObservationId: string;
    text: string;
    receivedAt: string;
    source?: Omit<ObservationSource, "kind" | "text">;
  }): Promise<
    | BodyWeightClarification
    | {
        status: "recorded";
        observation: BodyWeightObservation;
        view: BodyWeightView;
      }
  >;
  bodyWeightTimeline(): Promise<BodyWeightView>;
};

const MAX_CACHED_RUNS = 256;

type RunEntry = {
  fingerprint: string;
  promise: Promise<PluginExtractionOutput>;
  settled: boolean;
  controller: AbortController;
};

export function createStellaFitnessRuntime(options: {
  extractionRuntime: ExtractionRuntime;
  personalDataDirectory?: () => string | undefined;
  runtimeDirectory?: () => string | undefined;
  mediaSanitizer?: MediaSanitizer;
  preflight: () => ConfigurationPreflightResult;
}): StellaFitnessRuntime {
  const runs = new Map<string, RunEntry>();
  const preflight = options.preflight;
  const mediaSanitizer = options.mediaSanitizer ?? createBufferMediaSanitizer();
  let stopped = false;

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
    async recordBodyWeight(input) {
      assertPersonalDataPreflight(preflight());
      const personalDataDirectory = requiredPersonalDataDirectory(options);
      const candidate = parseBodyWeightInput(input);
      if ("status" in candidate) {
        return candidate;
      }
      const observation = await persistBodyWeightObservation({
        personalDataDirectory,
        amount: candidate.amount,
        unit: candidate.unit,
        occurredAt: candidate.occurredAt,
        source: {
          kind: "user-text",
          text: input.text,
          ...input.source,
        },
        recordedAt: new Date(input.receivedAt).toISOString(),
      });
      return {
        status: "recorded",
        observation,
        view: await rebuildBodyWeightView(personalDataDirectory),
      };
    },
    async correctBodyWeight(input) {
      assertPersonalDataPreflight(preflight());
      const personalDataDirectory = requiredPersonalDataDirectory(options);
      const candidate = parseBodyWeightInput(input);
      if ("status" in candidate) {
        return candidate;
      }
      const observation = await persistBodyWeightCorrection({
        personalDataDirectory,
        replacesObservationId: input.replacesObservationId,
        amount: candidate.amount,
        unit: candidate.unit,
        ...(candidate.occurrenceTimeSource === "explicit"
          ? { occurredAt: candidate.occurredAt }
          : {}),
        source: {
          kind: "user-text",
          text: input.text,
          ...input.source,
        },
        recordedAt: new Date(input.receivedAt).toISOString(),
      });
      return {
        status: "recorded",
        observation,
        view: await rebuildBodyWeightView(personalDataDirectory),
      };
    },
    async bodyWeightTimeline() {
      assertPersonalDataPreflight(preflight());
      return await rebuildBodyWeightView(requiredPersonalDataDirectory(options));
    },
    ingestWorkoutLog(request) {
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
      if (!Number.isSafeInteger(request.timeoutMs) || request.timeoutMs <= 0) {
        return Promise.reject(
          new Error("Extraction timeout must be a positive integer"),
        );
      }
      if (stopped) {
        return Promise.reject(new Error("Stella Fitness runtime is shut down"));
      }
      requiredRuntimeDirectory(options);

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

      const controller = new AbortController();
      const entry: RunEntry = {
        fingerprint,
        promise: executeWorkoutLogIngest({
          extractionRuntime: options.extractionRuntime,
          mediaSanitizer,
          personalDataDirectory: requiredPersonalDataDirectory(options),
          request,
          controller,
        }),
        settled: false,
        controller,
      };
      runs.set(request.runId, entry);
      void entry.promise.then(
        () => markSettledAndTrim(runs, entry),
        () => markSettledAndTrim(runs, entry),
      );
      return entry.promise;
    },
    async shutdown() {
      stopped = true;
      for (const entry of runs.values()) {
        if (!entry.settled) {
          entry.controller.abort(
            processingAbortError("shutdown", "Extraction stopped on shutdown"),
          );
        }
      }
      await Promise.allSettled([...runs.values()].map(({ promise }) => promise));
    },
  };
}

function requiredPersonalDataDirectory(options: {
  personalDataDirectory?: () => string | undefined;
}): string {
  const personalDataDirectory = options.personalDataDirectory?.();
  if (personalDataDirectory === undefined) {
    throw new Error("Personal Data Directory is unavailable after preflight");
  }
  return personalDataDirectory;
}

function requiredRuntimeDirectory(options: {
  runtimeDirectory?: () => string | undefined;
}): string {
  const runtimeDirectory = options.runtimeDirectory?.();
  if (runtimeDirectory === undefined) {
    throw new Error("Runtime Directory is unavailable after preflight");
  }
  return runtimeDirectory;
}

function assertPersonalDataPreflight(
  preflight: ConfigurationPreflightResult,
): void {
  if (preflight.readiness === "BLOCKED_CONFIGURATION") {
    throw new Error(
      `Stella Fitness cannot accept body-weight input in ${preflight.readiness}: ${preflight.reasons
        .map(({ code }) => code)
        .join(", ")}`,
    );
  }
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

function fingerprintRequest(request: WorkoutLogIngestRequest): string {
  return createHash("sha256")
    .update(request.upload.mime)
    .update("\0")
    .update(request.upload.fileName)
    .update("\0")
    .update(request.upload.receivedAt)
    .update("\0")
    .update(request.upload.bytes)
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

async function executeWorkoutLogIngest(options: {
  extractionRuntime: ExtractionRuntime;
  mediaSanitizer: MediaSanitizer;
  personalDataDirectory: string;
  request: WorkoutLogIngestRequest;
  controller: AbortController;
}): Promise<PluginExtractionOutput> {
  const startedAt = new Date().toISOString();
  const artifact = await persistRawWorkoutLogArtifact({
    personalDataDirectory: options.personalDataDirectory,
    upload: options.request.upload,
  });
  let lease: SanitizedMediaLease | undefined;
  const onCallerAbort = () => {
    options.controller.abort(
      processingAbortError("cancelled", "Extraction cancelled"),
    );
  };
  options.request.signal.addEventListener("abort", onCallerAbort, { once: true });
  if (options.request.signal.aborted) {
    onCallerAbort();
  }
  const timeout = setTimeout(() => {
    options.controller.abort(
      processingAbortError("timeout", "Workout-log extraction timed out"),
    );
  }, options.request.timeoutMs);

  try {
    lease = await rejectOnAbort(
      options.mediaSanitizer.sanitize(options.request.upload, artifact.id),
      options.controller.signal,
    );
    const result = await rejectOnAbort(
      options.extractionRuntime.extract({
        runId: options.request.runId,
        media: lease.media,
        timeoutMs: options.request.timeoutMs,
        signal: options.controller.signal,
      }),
      options.controller.signal,
    );
    let candidate: WorkoutLogCandidate;
    try {
      candidate = parseWorkoutLogCandidate(result.parsed);
    } catch (error) {
      throw new ProcessingFailureError("invalid-result", error);
    }
    const processing = await persistWorkoutLogProcessingRecord({
      personalDataDirectory: options.personalDataDirectory,
      record: {
        schemaVersion: "stella-fitness/processing/workout-log/v0.1",
        operation: "workout-log-extraction",
        runId: options.request.runId,
        startedAt,
        completedAt: new Date().toISOString(),
        status: "succeeded",
        artifact: artifactReference(artifact),
        payload: payloadReference(lease),
        execution: result.metadata,
      },
    });
    return {
      status: "candidate",
      candidate,
      execution: result.metadata,
      artifact,
      processing,
    };
  } catch (error) {
    const errorCategory = processingErrorCategory(error);
    await persistWorkoutLogProcessingRecord({
      personalDataDirectory: options.personalDataDirectory,
      record: {
        schemaVersion: "stella-fitness/processing/workout-log/v0.1",
        operation: "workout-log-extraction",
        runId: options.request.runId,
        startedAt,
        completedAt: new Date().toISOString(),
        status: "failed",
        artifact: artifactReference(artifact),
        ...(lease === undefined ? {} : { payload: payloadReference(lease) }),
        errorCategory,
      },
    });
    throw error instanceof ProcessingFailureError && error.cause !== undefined
      ? error.cause
      : error;
  } finally {
    clearTimeout(timeout);
    options.request.signal.removeEventListener("abort", onCallerAbort);
    await lease?.dispose();
  }
}

function artifactReference(artifact: RawArtifactRecord) {
  return { id: artifact.id, path: artifact.path, sha256: artifact.sha256 };
}

function payloadReference(lease: SanitizedMediaLease) {
  return {
    category: "sanitized-workout-log-image" as const,
    transport: lease.transport,
    mime: lease.media.mime,
    sha256: lease.sha256,
  };
}

type ProcessingErrorCategory = NonNullable<
  WorkoutLogProcessingRecord["errorCategory"]
>;

class ProcessingFailureError extends Error {
  constructor(
    readonly category: ProcessingErrorCategory,
    cause: unknown,
  ) {
    super("Workout-log processing failed", { cause });
  }
}

function processingAbortError(
  category: "cancelled" | "shutdown" | "timeout",
  message: string,
): Error {
  const error = new ProcessingFailureError(category, undefined);
  error.message = message;
  error.name = category === "timeout" ? "TimeoutError" : "AbortError";
  return error;
}

function processingErrorCategory(error: unknown): ProcessingErrorCategory {
  if (error instanceof ProcessingFailureError) {
    return error.category;
  }
  if (error instanceof InvalidWorkoutLogImageError) {
    return "invalid-image";
  }
  return "extraction-failed";
}
