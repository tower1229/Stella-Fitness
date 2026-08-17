import type {
  ExtractionRequest,
  ExtractionResult,
  ExtractionRuntime,
} from "../extraction/runtime.js";
import type { WorkoutLogIngestRequest } from "../domain/media.js";
import { throwIfAborted } from "../extraction/cancellation.js";
import type { MediaSanitizer } from "../media/sanitizer.js";
import { createStellaFitnessRuntime } from "../plugin-runtime.js";
import type { ConfigurationPreflightResult } from "../preflight.js";

type HarnessInput = Omit<WorkoutLogIngestRequest, "signal"> & {
  signal?: AbortSignal;
};

type ScenarioHarnessOptions = {
  extractionRuntime: ExtractionRuntime;
  personalDataDirectory?: () => string | undefined;
  runtimeDirectory?: () => string | undefined;
  mediaSanitizer?: MediaSanitizer;
  preflight: () => ConfigurationPreflightResult;
};

export function createScenarioHarness(options: ScenarioHarnessOptions) {
  const pluginRuntime = createStellaFitnessRuntime(options);

  return {
    programJourneyStatus(
      input?: Parameters<typeof pluginRuntime.programJourneyStatus>[0],
    ) {
      return pluginRuntime.programJourneyStatus(input);
    },
    acknowledgePrerequisite(
      input: Parameters<typeof pluginRuntime.acknowledgePrerequisite>[0],
    ) {
      return pluginRuntime.acknowledgePrerequisite(input);
    },
    recordJourneyBodyWeight(
      input: Parameters<typeof pluginRuntime.recordJourneyBodyWeight>[0],
    ) {
      return pluginRuntime.recordJourneyBodyWeight(input);
    },
    correctJourneyBodyWeight(
      input: Parameters<typeof pluginRuntime.correctJourneyBodyWeight>[0],
    ) {
      return pluginRuntime.correctJourneyBodyWeight(input);
    },
    deleteJourneyBodyWeight(
      input: Parameters<typeof pluginRuntime.deleteJourneyBodyWeight>[0],
    ) {
      return pluginRuntime.deleteJourneyBodyWeight(input);
    },
    recordInitial12RM(
      input: Parameters<typeof pluginRuntime.recordInitial12RM>[0],
    ) {
      return pluginRuntime.recordInitial12RM(input);
    },
    recordInitial12RMBatch(
      input: Parameters<typeof pluginRuntime.recordInitial12RMBatch>[0],
    ) {
      return pluginRuntime.recordInitial12RMBatch(input);
    },
    correctInitial12RM(
      input: Parameters<typeof pluginRuntime.correctInitial12RM>[0],
    ) {
      return pluginRuntime.correctInitial12RM(input);
    },
    deleteInitial12RM(
      input: Parameters<typeof pluginRuntime.deleteInitial12RM>[0],
    ) {
      return pluginRuntime.deleteInitial12RM(input);
    },
    submitProgramJourneyText(
      input: Parameters<typeof pluginRuntime.submitProgramJourneyText>[0],
    ) {
      return pluginRuntime.submitProgramJourneyText(input);
    },
    confirmProgramJourneyCandidate(
      input: Parameters<typeof pluginRuntime.confirmProgramJourneyCandidate>[0],
    ) {
      return pluginRuntime.confirmProgramJourneyCandidate(input);
    },
    activateProgram(cycleStart: string) {
      return pluginRuntime.activateProgram(cycleStart);
    },
    programFacts(input: Parameters<typeof pluginRuntime.programFacts>[0]) {
      return pluginRuntime.programFacts(input);
    },
    printableLog() {
      return pluginRuntime.printableLog();
    },
    weightFacts() {
      return pluginRuntime.weightFacts();
    },
    resolvePlannedSession(
      input: Parameters<typeof pluginRuntime.resolvePlannedSession>[0],
    ) {
      return pluginRuntime.resolvePlannedSession(input);
    },
    recordBodyWeight(
      input: Parameters<typeof pluginRuntime.recordBodyWeight>[0],
    ) {
      return pluginRuntime.recordBodyWeight(input);
    },
    correctBodyWeight(
      input: Parameters<typeof pluginRuntime.correctBodyWeight>[0],
    ) {
      return pluginRuntime.correctBodyWeight(input);
    },
    bodyWeightTimeline() {
      return pluginRuntime.bodyWeightTimeline();
    },
    ingestWorkoutLog(input: HarnessInput) {
      return pluginRuntime.ingestWorkoutLog({
        runId: input.runId,
        upload: input.upload,
        timeoutMs: input.timeoutMs,
        signal: input.signal ?? new AbortController().signal,
      });
    },
    correctWorkoutLog(
      input: HarnessInput & { readonly replacesObservationId: string },
    ) {
      return pluginRuntime.correctWorkoutLog({
        runId: input.runId,
        upload: input.upload,
        timeoutMs: input.timeoutMs,
        signal: input.signal ?? new AbortController().signal,
        replacesObservationId: input.replacesObservationId,
      });
    },
    trainingRecordView() {
      return pluginRuntime.trainingRecordView();
    },
    confirmWorkoutLog(
      input: Parameters<typeof pluginRuntime.confirmWorkoutLog>[0],
    ) {
      return pluginRuntime.confirmWorkoutLog(input);
    },
    shutdown() {
      return pluginRuntime.shutdown();
    },
  };
}

export class ControlledExtractionRuntime implements ExtractionRuntime {
  readonly requests: ExtractionRequest[] = [];
  readonly transientMediaBytes: Buffer[] = [];
  readonly #results: ExtractionResult[];
  readonly #pending: boolean;

  constructor(
    results: ExtractionResult[],
    options: { pending?: boolean } = {},
  ) {
    this.#results = [...results];
    this.#pending = options.pending ?? false;
  }

  async extract(request: ExtractionRequest): Promise<ExtractionResult> {
    this.transientMediaBytes.push(request.media.bytes);
    this.requests.push({
      ...request,
      media: {
        ...request.media,
        bytes: Buffer.from(request.media.bytes),
      },
    });
    throwIfAborted(request.signal);

    if (this.#pending) {
      return await new Promise<ExtractionResult>(() => undefined);
    }

    const result = this.#results.shift();
    if (result === undefined) {
      throw new Error("No controlled extraction result remains");
    }
    return result;
  }
}
