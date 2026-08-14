import { createHash, randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type {
  RawArtifactRecord,
  WorkoutLogIngestRequest,
  WorkoutLogProcessingRecord,
} from "./domain/media.js";
import type {
  BodyWeightObservation,
  BodyWeightView,
  ObservationSource,
  TrainingRecordView,
  WorkoutProgramContext,
  WorkoutLogObservation,
} from "./domain/observation.js";
import type {
  PlannedSession,
  ResolvedWorkoutSession,
} from "./domain/program.js";
import {
  parseBodyWeightInput,
  type BodyWeightClarification,
} from "./extraction/body-weight.js";
import { rejectOnAbort } from "./extraction/cancellation.js";
import {
  parseWorkoutLogFieldPath,
  parseWorkoutLogCandidate,
  type SpecialSessionCandidate,
  type WorkoutLogCandidate,
} from "./extraction/candidate.js";
import type {
  ExtractionExecutionMetadata,
  ExtractionRuntime,
} from "./extraction/runtime.js";
import {
  createRuntimeFileMediaSanitizer,
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
  readActiveProgram,
  readActiveProgramIfPresent,
  replaceProgramState,
  type ProgramState,
} from "./program/state.js";
import {
  createProgramJourney,
  type Initial12RMExerciseId,
  withProgramJourneyLock,
} from "./program/journey.js";
import {
  queryProgramFacts,
  type ProgramFactsQuery,
} from "./program/facts.js";
import {
  getPrintableLogWorkbook,
} from "./reporting/printable-log.js";
import {
  applyStrengthTestBindings,
  resolveOrdinarySession,
  resolveSpecialSession,
} from "./program/special-session.js";
import {
  persistBodyWeightCorrection,
  persistBodyWeightObservation,
  rebuildBodyWeightView,
} from "./storage/body-weight.js";
import {
  persistRawWorkoutLogArtifact,
  persistWorkoutLogProcessingRecord,
} from "./storage/media.js";
import {
  activeWorkoutLogById,
  activeWorkoutLogCorrectionByRunId,
  activeTrainingRecordWithArtifactSha,
  activeWorkoutLogWithLogicalIdentity,
  rebuildTrainingRecordView,
} from "./storage/training-record.js";
import {
  persistWorkoutLogObservation,
  relinkWorkoutLogArtifact,
  rollbackWorkoutLogObservation,
} from "./storage/workout-log.js";

type PluginExtractionBase = {
  execution: ExtractionExecutionMetadata;
  artifact: RawArtifactRecord;
  processing: WorkoutLogProcessingRecord;
  programState?: ProgramState;
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
  resolvePlannedSession(
    input: Omit<ProgramResolutionInput, "program"> & { programSpec: unknown },
  ): PlannedSession | null;
  ingestWorkoutLog(
    request: WorkoutLogIngestRequest,
  ): Promise<PluginExtractionOutput>;
  correctWorkoutLog(
    request: WorkoutLogIngestRequest & { readonly replacesObservationId: string },
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
  trainingRecordView(): Promise<TrainingRecordView>;
  programJourneyStatus(input?: { readonly date?: string }): ReturnType<
    ReturnType<typeof createProgramJourney>["status"]
  >;
  acknowledgePrerequisite(input: {
    readonly prerequisiteId: string;
    readonly acknowledgedAt: string;
    readonly source: ObservationSource;
  }): ReturnType<ReturnType<typeof createProgramJourney>["acknowledgePrerequisite"]>;
  recordJourneyBodyWeight(input: {
    readonly role: "baseline" | "checkpoint";
    readonly checkpointWeek?: 4 | 8 | 12;
    readonly text: string;
    readonly receivedAt: string;
    readonly source?: Omit<ObservationSource, "kind" | "text">;
  }): ReturnType<ReturnType<typeof createProgramJourney>["recordBodyWeight"]>;
  correctJourneyBodyWeight(input: Parameters<
    ReturnType<typeof createProgramJourney>["correctBodyWeight"]
  >[0]): ReturnType<ReturnType<typeof createProgramJourney>["correctBodyWeight"]>;
  deleteJourneyBodyWeight(input: Parameters<
    ReturnType<typeof createProgramJourney>["deleteBodyWeight"]
  >[0]): ReturnType<ReturnType<typeof createProgramJourney>["deleteBodyWeight"]>;
  recordInitial12RM(input: {
    readonly exerciseId: Initial12RMExerciseId;
    readonly valueKg: number;
    readonly confirmationId: string;
    readonly occurredAt: string;
    readonly recordedAt: string;
    readonly source: ObservationSource;
  }): ReturnType<ReturnType<typeof createProgramJourney>["recordInitial12RM"]>;
  correctInitial12RM(input: Parameters<
    ReturnType<typeof createProgramJourney>["correctInitial12RM"]
  >[0]): ReturnType<ReturnType<typeof createProgramJourney>["correctInitial12RM"]>;
  deleteInitial12RM(input: Parameters<
    ReturnType<typeof createProgramJourney>["deleteInitial12RM"]
  >[0]): ReturnType<ReturnType<typeof createProgramJourney>["deleteInitial12RM"]>;
  submitProgramJourneyText(input: Parameters<
    ReturnType<typeof createProgramJourney>["submitText"]
  >[0]): ReturnType<ReturnType<typeof createProgramJourney>["submitText"]>;
  confirmProgramJourneyCandidate(input: Parameters<
    ReturnType<typeof createProgramJourney>["confirmCandidate"]
  >[0]): ReturnType<ReturnType<typeof createProgramJourney>["confirmCandidate"]>;
  activateProgram(cycleStart: string): Promise<ProgramState>;
  programFacts(query: ProgramFactsQuery): ReturnType<typeof queryProgramFacts>;
  printableLog(): ReturnType<typeof getPrintableLogWorkbook>;
  weightFacts(): ReturnType<ReturnType<typeof createProgramJourney>["weightFacts"]>;
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
  readonly replacesObservationId?: string;
  result?: {
    readonly fingerprint: string;
    readonly promise: Promise<ConfirmedWorkoutLogOutput>;
  };
};

type CandidateSessionContext = {
  readonly candidate: WorkoutLogCandidate;
  readonly plannedSession?: ResolvedWorkoutSession;
  readonly programContext?: WorkoutProgramContext;
};

type UpdateSpecialSessionState = (
  personalDataDirectory: string,
  observation: Extract<
    WorkoutLogObservation,
    { kind: "workout-special-session" }
  >,
) => Promise<ProgramState>;

export function createStellaFitnessRuntime(options: {
  extractionRuntime: ExtractionRuntime;
  personalDataDirectory?: () => string | undefined;
  runtimeDirectory?: () => string | undefined;
  mediaSanitizer?: MediaSanitizer;
  preflight: () => ConfigurationPreflightResult;
}): StellaFitnessRuntime {
  const runs = new Map<string, RunEntry>();
  const confirmations = new Map<string, PendingWorkoutLogConfirmation>();
  const confirmationRestores = new Map<
    string,
    Promise<PendingWorkoutLogConfirmation | undefined>
  >();
  const preflight = options.preflight;
  const mediaSanitizer = options.mediaSanitizer ?? createRuntimeFileMediaSanitizer(
    () => requiredRuntimeDirectory(options),
  );
  const journey = () => createProgramJourney({
    personalDataDirectory: requiredPersonalDataDirectory(options),
    runtimeDirectory: requiredRuntimeDirectory(options),
    preflight,
  });
  let stopped = false;
  let programStateUpdateTail: Promise<void> = Promise.resolve();
  const enqueueSpecialSessionStateRebuild = (
    personalDataDirectory: string,
  ): Promise<ProgramState | undefined> => {
    const update = programStateUpdateTail.then(async () =>
      await withProgramJourneyLock(requiredRuntimeDirectory(options), async () => {
        const active = await readActiveProgramIfPresent({ personalDataDirectory });
        return active === undefined
          ? undefined
          : await rebuildSpecialSessionState({ personalDataDirectory });
      }),
    );
    programStateUpdateTail = update.then(
      () => undefined,
      () => undefined,
    );
    return update;
  };
  const updateSpecialSessionState: UpdateSpecialSessionState = (
    personalDataDirectory,
    observation,
  ) => {
    const update = programStateUpdateTail.then(async () => {
      await journey().migrateLegacyProgramStateReferences();
      return await withProgramJourneyLock(requiredRuntimeDirectory(options), async () => {
      if (
        observation.plannedSession.kind === "cycle-completion-retest" &&
        await hasProgramJourneySetup(personalDataDirectory)
      ) {
        const start = new Date(`${observation.plannedSession.cycle.startDate}T00:00:00.000Z`);
        const boundaryDate = new Date(start.getTime() + 12 * 604_800_000)
          .toISOString()
          .slice(0, 10);
        const status = await journey().status({ date: boundaryDate });
        if (status.state !== "ACTIVE") {
          throw new Error(`Cycle completion is unavailable in ${status.state}`);
        }
      }
        return await rebuildSpecialSessionState({ personalDataDirectory });
      });
    });
    programStateUpdateTail = update.then(
      () => undefined,
      () => undefined,
    );
    return update;
  };
  const startWorkoutLogIngest = (
    request: WorkoutLogIngestRequest,
    replacesObservationId?: string,
  ): Promise<PluginExtractionOutput> => {
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

    const fingerprint = fingerprintRequest(request, replacesObservationId);
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
        updateSpecialSessionState,
        ...(replacesObservationId === undefined
          ? {}
          : { replacesObservationId }),
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
  };

  return {
    preflight,
    async programJourneyStatus(input) {
      await journey().migrateLegacyProgramStateReferences();
      await enqueueSpecialSessionStateRebuild(requiredPersonalDataDirectory(options));
      return await journey().status(input);
    },
    acknowledgePrerequisite(input) {
      return journey().acknowledgePrerequisite(input);
    },
    async recordJourneyBodyWeight(input) {
      await journey().migrateLegacyProgramStateReferences();
      return await journey().recordBodyWeight(input);
    },
    async correctJourneyBodyWeight(input) {
      await journey().migrateLegacyProgramStateReferences();
      return await journey().correctBodyWeight(input);
    },
    async deleteJourneyBodyWeight(input) {
      await journey().migrateLegacyProgramStateReferences();
      return await journey().deleteBodyWeight(input);
    },
    recordInitial12RM(input) {
      return journey().recordInitial12RM(input);
    },
    correctInitial12RM(input) {
      return journey().correctInitial12RM(input);
    },
    deleteInitial12RM(input) {
      return journey().deleteInitial12RM(input);
    },
    async submitProgramJourneyText(input) {
      await journey().migrateLegacyProgramStateReferences();
      return await journey().submitText(input);
    },
    async confirmProgramJourneyCandidate(input) {
      await journey().migrateLegacyProgramStateReferences();
      return await journey().confirmCandidate(input);
    },
    activateProgram(cycleStart) {
      return journey().activate(cycleStart);
    },
    async programFacts(query) {
      await journey().migrateLegacyProgramStateReferences();
      await enqueueSpecialSessionStateRebuild(requiredPersonalDataDirectory(options));
      if (query.kind !== "unsupported") {
        const status = await journey().status(
          query.kind === "today" || query.kind === "next" ? { date: query.date } : {},
        );
        if (status.state !== "ACTIVE") {
          throw new Error(`Program Facts is unavailable in ${status.state}`);
        }
      }
      const result = await queryProgramFacts({
        personalDataDirectory: requiredPersonalDataDirectory(options),
        query,
      });
      if (query.kind === "next" && result.kind === "planned-session-facts") {
        const targetStatus = await journey().status({ date: result.session.date });
        if (targetStatus.state !== "ACTIVE") {
          throw new Error(`Program Facts is unavailable in ${targetStatus.state}`);
        }
      }
      return result;
    },
    async printableLog() {
      return await getPrintableLogWorkbook();
    },
    async weightFacts() {
      await journey().migrateLegacyProgramStateReferences();
      return await journey().weightFacts();
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
    async trainingRecordView() {
      assertPersonalDataPreflight(preflight());
      return await rebuildTrainingRecordView(
        requiredPersonalDataDirectory(options),
      );
    },
    ingestWorkoutLog(request) {
      return startWorkoutLogIngest(request);
    },
    correctWorkoutLog(request) {
      const { replacesObservationId, ...ingestRequest } = request;
      return startWorkoutLogIngest(ingestRequest, replacesObservationId);
    },
    async confirmWorkoutLog(input) {
      assertPersonalDataPreflight(preflight());
      if (stopped) {
        throw new Error("Stella Fitness runtime is shut down");
      }
      const personalDataDirectory = requiredPersonalDataDirectory(options);
      const pending =
        confirmations.get(input.confirmationId) ??
        await restorePendingWorkoutLogConfirmation({
          personalDataDirectory,
          confirmationId: input.confirmationId,
          confirmations,
          confirmationRestores,
        });
      if (pending === undefined) {
        throw new Error("Workout-log confirmation is unavailable");
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
        if (pending.result.fingerprint !== fingerprint) {
          throw new Error(
            "Workout-log confirmation was reused with different values",
          );
        }
        return pending.result.promise;
      }
      const promise = recordConfirmedWorkoutLog({
        personalDataDirectory,
        pending,
        values: input.values,
        updateSpecialSessionState,
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
      await programStateUpdateTail;
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

function fingerprintRequest(
  request: WorkoutLogIngestRequest,
  replacesObservationId?: string,
): string {
  return createHash("sha256")
    .update(request.upload.mime)
    .update("\0")
    .update(request.upload.fileName)
    .update("\0")
    .update(request.upload.receivedAt)
    .update("\0")
    .update(request.upload.bytes)
    .update("\0")
    .update(replacesObservationId ?? "")
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
  updateSpecialSessionState: UpdateSpecialSessionState;
  replacesObservationId?: string;
}): Promise<PluginExtractionOutput> {
  const startedAt = new Date().toISOString();
  const uploadSha256 = createHash("sha256")
    .update(options.request.upload.bytes)
    .digest("hex");
  const correctionRetry = options.replacesObservationId === undefined
    ? undefined
    : await activeWorkoutLogCorrectionByRunId(
        options.personalDataDirectory,
        options.request.runId,
      );
  if (correctionRetry !== undefined) {
    if (
      correctionRetry.provenance.kind !== "workout-log-correction" ||
      correctionRetry.provenance.replacesObservationId !==
        options.replacesObservationId ||
      correctionRetry.source.sha256 !== uploadSha256
    ) {
      throw new Error("Workout-log correction run ID was reused for different facts");
    }
    const activeCorrectionRecord = (
      await rebuildTrainingRecordView(options.personalDataDirectory)
    ).records.find(
      ({ observation }) => observation.id === correctionRetry.id,
    );
    const restored = await restoreMissingWorkoutLogSource({
      personalDataDirectory: options.personalDataDirectory,
      request: options.request,
      observation: correctionRetry,
      sourceStatus: activeCorrectionRecord?.sourceStatus ?? "source_missing",
    });
    return duplicateWorkoutLogOutput({
      personalDataDirectory: options.personalDataDirectory,
      request: options.request,
      observation: restored.observation,
      startedAt,
      artifact: restored.artifact,
      execution: { provider: "deduplicated" },
    });
  }
  const duplicate = options.replacesObservationId === undefined
    ? await activeTrainingRecordWithArtifactSha(
        options.personalDataDirectory,
        uploadSha256,
      )
    : undefined;
  if (duplicate !== undefined) {
    const restored = await restoreMissingWorkoutLogSource({
      personalDataDirectory: options.personalDataDirectory,
      request: options.request,
      observation: duplicate.observation,
      sourceStatus: duplicate.sourceStatus,
    });
    return duplicateWorkoutLogOutput({
      personalDataDirectory: options.personalDataDirectory,
      request: options.request,
      observation: restored.observation,
      startedAt,
      artifact: restored.artifact,
      execution: { provider: "deduplicated" },
    });
  }
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
    candidate = requireSpecialSessionConfirmation(candidate);
    let context: CandidateSessionContext;
    try {
      context = await resolveCandidateSessionContext({
        personalDataDirectory: options.personalDataDirectory,
        candidate,
      });
    } catch (error) {
      throw new ProcessingFailureError("invalid-result", error);
    }
    candidate = context.candidate;
    const { plannedSession } = context;
    const replaced = options.replacesObservationId === undefined
      ? undefined
      : await activeWorkoutLogById(
          options.personalDataDirectory,
          options.replacesObservationId,
        );
    if (
      options.replacesObservationId !== undefined &&
      replaced === undefined
    ) {
      throw new Error(
        `Workout-log Observation ${options.replacesObservationId} is not an active fact`,
      );
    }
    const logicalDuplicate = options.replacesObservationId === undefined
      ? await activeWorkoutLogWithLogicalIdentity(
          options.personalDataDirectory,
          candidate,
          context.programContext,
        )
      : undefined;
    if (logicalDuplicate !== undefined) {
      return await duplicateWorkoutLogOutput({
        personalDataDirectory: options.personalDataDirectory,
        request: options.request,
        observation: logicalDuplicate,
        startedAt,
        artifact,
        execution: result.metadata,
      });
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
            ...(plannedSession === undefined ? {} : { plannedSession }),
            ...(options.replacesObservationId === undefined
              ? {}
              : { replacesObservationId: options.replacesObservationId }),
            ...(replaced === undefined
              ? {}
              : { occurredAt: replaced.occurredAt }),
            ...((replaced?.programContext ?? context.programContext) === undefined
              ? {}
              : {
                  programContext:
                    replaced?.programContext ?? context.programContext!,
                }),
          })
        : undefined;
    const programState = persistedObservation === undefined
      ? undefined
      : await commitSpecialSessionState({
          personalDataDirectory: options.personalDataDirectory,
          persisted: persistedObservation,
          plannedSession,
          updateSpecialSessionState: options.updateSpecialSessionState,
        });
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
                candidate: candidateExtractionShape(candidate),
                ...(options.replacesObservationId === undefined
                  ? {}
                  : { replacesObservationId: options.replacesObservationId }),
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
        ...(programState === undefined ? {} : { programState }),
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
      ...(options.replacesObservationId === undefined
        ? {}
        : { replacesObservationId: options.replacesObservationId }),
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

async function restorePendingWorkoutLogConfirmation(options: {
  readonly personalDataDirectory: string;
  readonly confirmationId: string;
  readonly confirmations: Map<string, PendingWorkoutLogConfirmation>;
  readonly confirmationRestores: Map<
    string,
    Promise<PendingWorkoutLogConfirmation | undefined>
  >;
}): Promise<PendingWorkoutLogConfirmation | undefined> {
  const existingRestore = options.confirmationRestores.get(options.confirmationId);
  if (existingRestore !== undefined) {
    return await existingRestore;
  }
  const restore = readPendingWorkoutLogConfirmation(
    options.personalDataDirectory,
    options.confirmationId,
  ).then((pending) => {
    if (pending !== undefined) {
      options.confirmations.set(options.confirmationId, pending);
    }
    return pending;
  });
  options.confirmationRestores.set(options.confirmationId, restore);
  try {
    return await restore;
  } finally {
    if (options.confirmationRestores.get(options.confirmationId) === restore) {
      options.confirmationRestores.delete(options.confirmationId);
    }
  }
}

async function readPendingWorkoutLogConfirmation(
  personalDataDirectory: string,
  confirmationId: string,
): Promise<PendingWorkoutLogConfirmation | undefined> {
  const directory = join(personalDataDirectory, "processing", "workout-log");
  const files = await readdir(directory).catch((error: unknown) => {
    if (isMissingFile(error)) return [];
    throw error;
  });
  const records = await Promise.all(
    files
      .filter((file) => file.endsWith(".json"))
      .sort()
      .map(async (file) => {
        const value: unknown = JSON.parse(await readFile(join(directory, file), "utf8"));
        return value;
      }),
  );
  const awaiting = records.find((value) =>
    isRecord(value) &&
    value.schemaVersion === "stella-fitness/processing/workout-log/v0.1" &&
    value.operation === "workout-log-extraction" &&
    value.status === "awaiting-confirmation" &&
    isRecord(value.result) &&
    value.result.kind === "workout-log-confirmation" &&
    value.result.confirmationId === confirmationId,
  );
  if (!isRecord(awaiting) || !isRecord(awaiting.result)) {
    return undefined;
  }
  if (
    typeof awaiting.runId !== "string" ||
    !isRecord(awaiting.artifact) ||
    typeof awaiting.artifact.id !== "string" ||
    typeof awaiting.artifact.path !== "string" ||
    typeof awaiting.artifact.sha256 !== "string" ||
    !isExtractionExecutionMetadata(awaiting.execution)
  ) {
    throw new Error("Pending workout-log confirmation is schema-invalid");
  }
  const completed = records.some((value) =>
    isRecord(value) &&
    value.schemaVersion === "stella-fitness/processing/workout-log/v0.1" &&
    value.operation === "workout-log-confirmation" &&
    value.runId === awaiting.runId &&
    value.status === "succeeded",
  );
  if (completed) return undefined;
  const artifact = await readConfirmationArtifact(
    personalDataDirectory,
    awaiting.artifact,
  );
  const replacesObservationId = awaiting.result.replacesObservationId;
  if (
    replacesObservationId !== undefined &&
    typeof replacesObservationId !== "string"
  ) {
    throw new Error("Pending workout-log confirmation is schema-invalid");
  }
  return {
    candidate: parseWorkoutLogCandidate(awaiting.result.candidate),
    artifact,
    runId: awaiting.runId,
    execution: awaiting.execution,
    ...(replacesObservationId === undefined ? {} : { replacesObservationId }),
  };
}

async function readConfirmationArtifact(
  personalDataDirectory: string,
  reference: Record<string, unknown>,
): Promise<RawArtifactRecord> {
  const artifactPath = String(reference.path);
  const artifactMatch = /^raw-artifacts\/workout-log\/([0-9a-f-]{36})\/original\.(?:jpe?g|png|webp)$/iu.exec(
    artifactPath,
  );
  if (
    artifactMatch?.[1]?.toLowerCase() !== String(reference.id).toLowerCase() ||
    !/^[0-9a-f]{64}$/u.test(String(reference.sha256))
  ) {
    throw new Error("Pending workout-log artifact is schema-invalid");
  }
  const source: unknown = JSON.parse(
    await readFile(
      join(personalDataDirectory, dirname(artifactPath), "artifact.json"),
      "utf8",
    ),
  );
  if (
    !isRecord(source) ||
    source.schemaVersion !== "stella-fitness/raw-artifact/v0.1" ||
    source.kind !== "workout-log-image" ||
    source.id !== reference.id ||
    source.path !== reference.path ||
    source.sha256 !== reference.sha256 ||
    typeof source.size !== "number" ||
    typeof source.originalFileName !== "string" ||
    !["image/jpeg", "image/png", "image/webp"].includes(String(source.mime)) ||
    !isRecord(source.provenance) ||
    source.provenance.kind !== "openclaw-media" ||
    typeof source.provenance.receivedAt !== "string"
  ) {
    throw new Error("Pending workout-log artifact is schema-invalid");
  }
  return source as RawArtifactRecord;
}

function isExtractionExecutionMetadata(
  value: unknown,
): value is ExtractionExecutionMetadata {
  return isRecord(value) &&
    (value.provider === undefined || typeof value.provider === "string") &&
    (value.model === undefined || typeof value.model === "string") &&
    (value.contentType === undefined ||
      value.contentType === "json" ||
      value.contentType === "text");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

async function duplicateWorkoutLogOutput(options: {
  readonly personalDataDirectory: string;
  readonly request: WorkoutLogIngestRequest;
  readonly observation: WorkoutLogObservation;
  readonly startedAt: string;
  readonly artifact: RawArtifactRecord;
  readonly execution: ExtractionExecutionMetadata;
}): Promise<PluginExtractionOutput> {
  const processing = await persistWorkoutLogProcessingRecord({
    personalDataDirectory: options.personalDataDirectory,
    record: {
      schemaVersion: "stella-fitness/processing/workout-log/v0.1",
      operation: "workout-log-extraction",
      runId: options.request.runId,
      startedAt: options.startedAt,
      completedAt: new Date().toISOString(),
      status: "succeeded",
      artifact: artifactReference(options.artifact),
      execution: options.execution,
      result: {
        kind: "workout-log-observation",
        observationId: options.observation.id,
        path: joinObservationPath(options.observation.id),
      },
    },
  });
  return {
    status: "recorded",
    observation: options.observation,
    execution: options.execution,
    artifact: options.artifact,
    processing,
  };
}

async function readArtifactForObservation(
  personalDataDirectory: string,
  observation: WorkoutLogObservation,
): Promise<RawArtifactRecord> {
  const artifactRecordPath = join(
    personalDataDirectory,
    dirname(observation.source.path),
    "artifact.json",
  );
  return JSON.parse(
    await readFile(artifactRecordPath, "utf8"),
  ) as RawArtifactRecord;
}

async function restoreMissingWorkoutLogSource(options: {
  readonly personalDataDirectory: string;
  readonly request: WorkoutLogIngestRequest;
  readonly observation: WorkoutLogObservation;
  readonly sourceStatus: "available" | "source_missing";
}): Promise<{
  readonly observation: WorkoutLogObservation;
  readonly artifact: RawArtifactRecord;
}> {
  if (options.sourceStatus === "available") {
    return {
      observation: options.observation,
      artifact: await readArtifactForObservation(
        options.personalDataDirectory,
        options.observation,
      ),
    };
  }
  const artifact = await persistRawWorkoutLogArtifact({
    personalDataDirectory: options.personalDataDirectory,
    upload: options.request.upload,
  });
  return {
    observation: await relinkWorkoutLogArtifact({
      personalDataDirectory: options.personalDataDirectory,
      observation: options.observation,
      artifact,
      runId: options.request.runId,
      replacedAt: new Date().toISOString(),
    }),
    artifact,
  };
}

function joinObservationPath(observationId: string): string {
  return join("observations", "workout-log", `${observationId}.json`);
}

async function recordConfirmedWorkoutLog(options: {
  readonly personalDataDirectory: string;
  readonly pending: PendingWorkoutLogConfirmation;
  readonly values: Readonly<Record<string, unknown>>;
  readonly updateSpecialSessionState: UpdateSpecialSessionState;
}): Promise<ConfirmedWorkoutLogOutput> {
  const replaced = options.pending.replacesObservationId === undefined
    ? undefined
    : await activeWorkoutLogById(
        options.personalDataDirectory,
        options.pending.replacesObservationId,
      );
  if (
    options.pending.replacesObservationId !== undefined &&
    replaced === undefined
  ) {
    throw new Error(
      `Workout-log Observation ${options.pending.replacesObservationId} is not an active fact`,
    );
  }
  const requiredPaths = options.pending.candidate.uncertainFields.map(
    ({ path }) => path,
  );
  if (
    Object.keys(options.values).length !== requiredPaths.length ||
    !requiredPaths.every((path) => Object.hasOwn(options.values, path))
  ) {
    const receivedPaths = Object.keys(options.values).sort((left, right) =>
      left.localeCompare(right)
    );
    throw new Error(
      `Confirm exactly the requested workout-log fields; expected: ${
        requiredPaths.length === 0 ? "none" : requiredPaths.join(", ")
      }; received: ${receivedPaths.length === 0 ? "none" : receivedPaths.join(", ")}`,
    );
  }

  const corrected = candidateExtractionShape(options.pending.candidate);
  for (const path of requiredPaths) {
    setCandidateFieldValue(corrected, path, options.values[path]);
  }
  corrected.uncertainFields = [];
  let candidate = parseWorkoutLogCandidate(corrected);
  const attemptedAt = new Date().toISOString();
  let context: CandidateSessionContext;
  try {
    context = await resolveCandidateSessionContext({
      personalDataDirectory: options.personalDataDirectory,
      candidate,
    });
  } catch (error) {
    await persistWorkoutLogProcessingRecord({
      personalDataDirectory: options.personalDataDirectory,
      record: {
        schemaVersion: "stella-fitness/processing/workout-log/v0.1",
        operation: "workout-log-confirmation",
        runId: options.pending.runId,
        startedAt: attemptedAt,
        completedAt: new Date().toISOString(),
        status: "failed",
        artifact: artifactReference(options.pending.artifact),
        execution: options.pending.execution,
        errorCategory: "invalid-result",
      },
    });
    throw error;
  }
  candidate = context.candidate;
  const { plannedSession } = context;
  const recordedAt = attemptedAt;
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
    ...(plannedSession === undefined ? {} : { plannedSession }),
    ...(options.pending.replacesObservationId === undefined
      ? {}
      : { replacesObservationId: options.pending.replacesObservationId }),
    ...(replaced === undefined ? {} : { occurredAt: replaced.occurredAt }),
    ...((replaced?.programContext ?? context.programContext) === undefined
      ? {}
      : {
          programContext: replaced?.programContext ?? context.programContext!,
        }),
  });
  const programState = await commitSpecialSessionState({
    personalDataDirectory: options.personalDataDirectory,
    persisted,
    plannedSession,
    updateSpecialSessionState: options.updateSpecialSessionState,
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
    ...(programState === undefined ? {} : { programState }),
    execution: options.pending.execution,
    artifact: options.pending.artifact,
    processing,
  };
}

async function commitSpecialSessionState(options: {
  readonly personalDataDirectory: string;
  readonly persisted: Awaited<ReturnType<typeof persistWorkoutLogObservation>>;
  readonly plannedSession: ResolvedWorkoutSession | undefined;
  readonly updateSpecialSessionState: UpdateSpecialSessionState;
}): Promise<ProgramState | undefined> {
  if (
    options.persisted.observation.kind !== "workout-special-session" ||
    options.plannedSession === undefined
  ) {
    return undefined;
  }
  try {
    return await options.updateSpecialSessionState(
      options.personalDataDirectory,
      options.persisted.observation,
    );
  } catch (error) {
    await rollbackWorkoutLogObservation({
      personalDataDirectory: options.personalDataDirectory,
      path: options.persisted.path,
    });
    throw error;
  }
}

function candidateExtractionShape(candidate: WorkoutLogCandidate): Record<string, unknown> & {
  uncertainFields: unknown[];
} {
  return structuredClone(
    "exercises" in candidate
      ? {
          ...candidate,
          uncertainFields: [...candidate.uncertainFields],
          exercises: candidate.exercises.map((exercise) => ({
            ...exercise,
            sets: exercise.sets.map(({ value, confidence }) => ({
              value,
              confidence,
            })),
          })),
        }
      : {
          ...candidate,
          uncertainFields: [...candidate.uncertainFields],
          testResults: candidate.testResults.map((result) => ({ ...result })),
        },
  );
}

function requireSpecialSessionConfirmation(
  candidate: WorkoutLogCandidate,
): WorkoutLogCandidate {
  if (!("testResults" in candidate)) {
    return candidate;
  }
  const existingPaths = new Set(
    candidate.uncertainFields.map(({ path }) => path),
  );
  const required = candidate.testResults.flatMap((result, index) => {
    const path = `testResults[${index}].result.value`;
    if (existingPaths.has(path)) return [];
    const raw = result.result.value?.raw;
    return [{
      path,
      kind: "confirmation-required" as const,
      ...(raw === undefined ? {} : { candidates: [raw] }),
    }];
  });
  return {
    ...candidate,
    uncertainFields: [...candidate.uncertainFields, ...required],
  } satisfies SpecialSessionCandidate;
}

async function resolveCandidateSessionContext(options: {
  readonly personalDataDirectory: string;
  readonly candidate: WorkoutLogCandidate;
}): Promise<CandidateSessionContext> {
  const activeProgram = await readActiveProgramIfPresent({
    personalDataDirectory: options.personalDataDirectory,
  });
  if (activeProgram === undefined) {
    return { candidate: options.candidate };
  }
  const programContext: WorkoutProgramContext = {
    stateId: activeProgram.state.id,
    programId: activeProgram.state.program.id,
    programVersion: activeProgram.state.program.version,
    cycleStart: activeProgram.state.cycle.startDate,
  };
  if ("testResults" in options.candidate) {
    return {
      candidate: options.candidate,
      programContext,
      plannedSession: resolveSpecialSession({
        candidate: options.candidate,
        program: activeProgram.program,
        state: activeProgram.state,
      }),
    };
  }
  const ordinary = resolveOrdinarySession({
    candidate: options.candidate,
    program: activeProgram.program,
    state: activeProgram.state,
  });
  return { ...ordinary, programContext };
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
  if (location.kind === "test-result") {
    const result = candidateTestResult(candidate, location.testResultIndex);
    setFieldValue(result[location.key], value);
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

function candidateTestResult(
  candidate: Record<string, unknown>,
  index: number,
): Record<string, unknown> {
  if (!Array.isArray(candidate.testResults)) {
    throw new Error("Invalid confirmation path");
  }
  const result = candidate.testResults[index];
  if (typeof result !== "object" || result === null || Array.isArray(result)) {
    throw new Error("Invalid confirmation path");
  }
  return result as Record<string, unknown>;
}

async function rebuildSpecialSessionState(options: {
  readonly personalDataDirectory: string;
}): Promise<ProgramState> {
  const activeProgram = await readActiveProgram({
    personalDataDirectory: options.personalDataDirectory,
  });
  const symbolicLoadBindings: Record<string, Record<string, ProgramState["symbolicLoadBindings"][string][string]>> = {};
  for (const [exerciseId, bindings] of Object.entries(activeProgram.state.symbolicLoadBindings)) {
    if (bindings.A !== undefined) {
      symbolicLoadBindings[exerciseId] = { A: bindings.A };
    }
  }
  const { nextCycle: _nextCycle, ...withoutNextCycle } = activeProgram.state;
  let nextState: ProgramState = {
    ...withoutNextCycle,
    symbolicLoadBindings,
    assistanceBindings: {},
  };
  const view = await rebuildTrainingRecordView(options.personalDataDirectory);
  if (view.errors.length > 0) {
    throw new Error(view.errors.map(({ file, message }) => `${file} - ${message}`).join("\n"));
  }
  const specialSessionKeys = new Set<string>();
  for (const { observation } of view.records) {
    if (
      observation.kind !== "workout-special-session" ||
      observation.programContext?.stateId !== activeProgram.state.id ||
      observation.programContext.cycleStart !== activeProgram.state.cycle.startDate
    ) {
      continue;
    }
    const key = observation.plannedSession.kind === "cycle-completion-retest"
      ? "cycle-completion-retest"
      : `week-${observation.plannedSession.cycle.week}-strength-test`;
    if (specialSessionKeys.has(key)) {
      throw new Error(`Multiple active special-session Observations conflict for ${key}`);
    }
    specialSessionKeys.add(key);
    nextState = applyStrengthTestBindings({ state: nextState, observation });
  }
  if (JSON.stringify(nextState) === JSON.stringify(activeProgram.state)) {
    return activeProgram.state;
  }
  return await replaceProgramState({
    personalDataDirectory: options.personalDataDirectory,
    previousState: activeProgram.state,
    nextState,
  });
}

async function hasProgramJourneySetup(personalDataDirectory: string): Promise<boolean> {
  try {
    await readFile(join(personalDataDirectory, "program", "setup.json"), "utf8");
    return true;
  } catch (error) {
    if (isMissingFile(error)) return false;
    throw error;
  }
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
