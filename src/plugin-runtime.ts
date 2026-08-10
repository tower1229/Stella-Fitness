import { createHash, randomUUID } from "node:crypto";

import type {
  RawArtifactRecord,
  WorkoutLogIngestRequest,
  WorkoutLogProcessingRecord,
} from "./domain/media.js";
import type {
  BodyWeightObservation,
  BodyWeightView,
  ObservationSource,
  WorkoutLogObservation,
} from "./domain/observation.js";
import type { PlannedSession } from "./domain/program.js";
import {
  parseBodyWeightInput,
  type BodyWeightClarification,
} from "./extraction/body-weight.js";
import { rejectOnAbort } from "./extraction/cancellation.js";
import {
  parseWorkoutLogFieldPath,
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
import { persistWorkoutLogObservation } from "./storage/workout-log.js";

type PluginExtractionBase = {
  execution: ExtractionExecutionMetadata;
  artifact: RawArtifactRecord;
  processing: WorkoutLogProcessingRecord;
};

export type PluginExtractionOutput =
  | (PluginExtractionBase & {
      status: "recorded";
      observation: WorkoutLogObservation;
    })
  | (PluginExtractionBase & {
      status: "confirmation";
      confirmationId: string;
      fields: WorkoutLogCandidate["uncertainFields"];
    });

export type ConfirmedWorkoutLogOutput = PluginExtractionBase & {
  status: "recorded";
  observation: WorkoutLogObservation;
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
  confirmWorkoutLog(input: {
    readonly confirmationId: string;
    readonly values: Readonly<Record<string, unknown>>;
  }): Promise<ConfirmedWorkoutLogOutput>;
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

type PendingWorkoutLogConfirmation = {
  readonly candidate: WorkoutLogCandidate;
  readonly artifact: RawArtifactRecord;
  readonly runId: string;
  readonly execution: ExtractionExecutionMetadata;
  result?: {
    readonly fingerprint: string;
    readonly promise: Promise<ConfirmedWorkoutLogOutput>;
  };
};

export function createStellaFitnessRuntime(options: {
  extractionRuntime: ExtractionRuntime;
  personalDataDirectory?: () => string | undefined;
  runtimeDirectory?: () => string | undefined;
  mediaSanitizer?: MediaSanitizer;
  preflight: () => ConfigurationPreflightResult;
}): StellaFitnessRuntime {
  const runs = new Map<string, RunEntry>();
  const confirmations = new Map<string, PendingWorkoutLogConfirmation>();
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
          confirmations,
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
    confirmWorkoutLog(input) {
      assertPersonalDataPreflight(preflight());
      if (stopped) {
        return Promise.reject(new Error("Stella Fitness runtime is shut down"));
      }
      const pending = confirmations.get(input.confirmationId);
      if (pending === undefined) {
        return Promise.reject(new Error("Workout-log confirmation is unavailable"));
      }
      const fingerprint = createHash("sha256")
        .update(
          JSON.stringify(
            Object.fromEntries(
              Object.entries(input.values).sort(([left], [right]) =>
                left.localeCompare(right),
              ),
            ),
          ),
        )
        .digest("hex");
      if (pending.result !== undefined) {
        return pending.result.fingerprint === fingerprint
          ? pending.result.promise
          : Promise.reject(
              new Error("Workout-log confirmation was reused with different values"),
            );
      }
      const promise = recordConfirmedWorkoutLog({
        personalDataDirectory: requiredPersonalDataDirectory(options),
        pending,
        values: input.values,
      });
      pending.result = { fingerprint, promise };
      void promise.catch(() => {
        if (pending.result?.promise === promise) {
          delete pending.result;
        }
      });
      return promise;
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
  confirmations: Map<string, PendingWorkoutLogConfirmation>;
}): Promise<PluginExtractionOutput> {
  const startedAt = new Date().toISOString();
  const artifact = await persistRawWorkoutLogArtifact({
    personalDataDirectory: options.personalDataDirectory,
    upload: options.request.upload,
  });
  let lease: SanitizedMediaLease | undefined;
  let execution: ExtractionExecutionMetadata | undefined;
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
    lease = await acquireSanitizedMedia(
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
    execution = result.metadata;
    let candidate: WorkoutLogCandidate;
    try {
      candidate = parseWorkoutLogCandidate(result.parsed);
    } catch (error) {
      throw new ProcessingFailureError("invalid-result", error);
    }
    const recordedAt = new Date().toISOString();
    const confirmationId =
      candidate.uncertainFields.length === 0 ? undefined : randomUUID();
    const persistedObservation =
      candidate.uncertainFields.length === 0
        ? await persistWorkoutLogObservation({
            personalDataDirectory: options.personalDataDirectory,
            candidate,
            artifact,
            runId: options.request.runId,
            recordedAt,
          })
        : undefined;
    const processing = await persistWorkoutLogProcessingRecord({
      personalDataDirectory: options.personalDataDirectory,
      record: {
        schemaVersion: "stella-fitness/processing/workout-log/v0.1",
        operation: "workout-log-extraction",
        runId: options.request.runId,
        startedAt,
        completedAt: recordedAt,
        status:
          persistedObservation === undefined
            ? "awaiting-confirmation"
            : "succeeded",
        artifact: artifactReference(artifact),
        payload: payloadReference(lease),
        execution: result.metadata,
        ...(persistedObservation === undefined
          ? {
              result: {
                kind: "workout-log-confirmation" as const,
                confirmationId: confirmationId!,
              },
            }
          : {
              result: {
                kind: "workout-log-observation" as const,
                observationId: persistedObservation.observation.id,
                path: persistedObservation.path,
              },
            }),
      },
    });
    if (persistedObservation !== undefined) {
      return {
        status: "recorded",
        observation: persistedObservation.observation,
        execution: result.metadata,
        artifact,
        processing,
      };
    }
    if (confirmationId === undefined) {
      throw new Error("Workout-log confirmation identity was not created");
    }
    options.confirmations.set(confirmationId, {
      candidate,
      artifact,
      runId: options.request.runId,
      execution: result.metadata,
    });
    return {
      status: "confirmation",
      confirmationId,
      fields: candidate.uncertainFields,
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
        ...(execution === undefined ? {} : { execution }),
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

async function recordConfirmedWorkoutLog(options: {
  readonly personalDataDirectory: string;
  readonly pending: PendingWorkoutLogConfirmation;
  readonly values: Readonly<Record<string, unknown>>;
}): Promise<ConfirmedWorkoutLogOutput> {
  const requiredPaths = options.pending.candidate.uncertainFields.map(
    ({ path }) => path,
  );
  if (
    Object.keys(options.values).length !== requiredPaths.length ||
    !requiredPaths.every((path) => Object.hasOwn(options.values, path))
  ) {
    throw new Error("Confirm exactly the requested workout-log fields");
  }

  const corrected = candidateExtractionShape(options.pending.candidate);
  for (const path of requiredPaths) {
    setCandidateFieldValue(corrected, path, options.values[path]);
  }
  corrected.uncertainFields = [];
  const candidate = parseWorkoutLogCandidate(corrected);
  const recordedAt = new Date().toISOString();
  const persisted = await persistWorkoutLogObservation({
    personalDataDirectory: options.personalDataDirectory,
    candidate,
    artifact: options.pending.artifact,
    runId: options.pending.runId,
    recordedAt,
    confirmedFields: requiredPaths,
    resolvedUncertainty: options.pending.candidate.uncertainFields.map(
      (field) => ({ ...field, resolution: "user-confirmed" as const }),
    ),
  });
  const processing = await persistWorkoutLogProcessingRecord({
    personalDataDirectory: options.personalDataDirectory,
    record: {
      schemaVersion: "stella-fitness/processing/workout-log/v0.1",
      operation: "workout-log-confirmation",
      runId: options.pending.runId,
      startedAt: recordedAt,
      completedAt: new Date().toISOString(),
      status: "succeeded",
      artifact: artifactReference(options.pending.artifact),
      execution: options.pending.execution,
      result: {
        kind: "workout-log-observation",
        observationId: persisted.observation.id,
        path: persisted.path,
      },
    },
  });
  return {
    status: "recorded",
    observation: persisted.observation,
    execution: options.pending.execution,
    artifact: options.pending.artifact,
    processing,
  };
}

function candidateExtractionShape(candidate: WorkoutLogCandidate): Record<string, unknown> & {
  uncertainFields: unknown[];
} {
  return structuredClone({
    ...candidate,
    uncertainFields: [...candidate.uncertainFields],
    exercises: candidate.exercises.map((exercise) => ({
      ...exercise,
      sets: exercise.sets.map(({ value, confidence }) => ({ value, confidence })),
    })),
  });
}

function setCandidateFieldValue(
  candidate: Record<string, unknown>,
  path: string,
  value: unknown,
): void {
  const location = parseWorkoutLogFieldPath(path);
  if (location === undefined) {
    throw new Error(`Unsupported workout-log confirmation path: ${path}`);
  }
  if (location.kind === "top-level") {
    setFieldValue(candidate[location.key], value);
    return;
  }
  const exercise = candidateExercise(candidate, location.exerciseIndex);
  if (location.kind === "exercise") {
    setFieldValue(exercise[location.key], value);
    return;
  }
  if (!Array.isArray(exercise.sets)) throw new Error("Invalid confirmation path");
  setFieldValue(exercise.sets[location.setIndex], value);
}

function candidateExercise(
  candidate: Record<string, unknown>,
  index: number,
): Record<string, unknown> {
  if (!Array.isArray(candidate.exercises)) throw new Error("Invalid confirmation path");
  const exercise = candidate.exercises[index];
  if (typeof exercise !== "object" || exercise === null || Array.isArray(exercise)) {
    throw new Error("Invalid confirmation path");
  }
  return exercise as Record<string, unknown>;
}

function setFieldValue(field: unknown, value: unknown): void {
  if (typeof field !== "object" || field === null || Array.isArray(field)) {
    throw new Error("Invalid confirmation path");
  }
  const candidateField = field as Record<string, unknown>;
  candidateField.value = value;
  candidateField.confidence = "high";
}

async function acquireSanitizedMedia(
  pendingLease: Promise<SanitizedMediaLease>,
  signal: AbortSignal,
): Promise<SanitizedMediaLease> {
  try {
    return await rejectOnAbort(pendingLease, signal);
  } catch (error) {
    if (signal.aborted) {
      void pendingLease
        .then(async (lateLease) => {
          await lateLease.dispose();
        })
        .catch(() => undefined);
    }
    throw error;
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
