import type {
  ExtractionRequest,
  ExtractionResult,
  ExtractionRuntime,
} from "../extraction/runtime.js";
import { throwIfAborted } from "../extraction/cancellation.js";
import { createStellaFitnessRuntime } from "../plugin-runtime.js";
import type { ConfigurationPreflightResult } from "../preflight.js";

type HarnessInput = Omit<ExtractionRequest, "signal"> & {
  signal?: AbortSignal;
};

type ScenarioHarnessOptions = {
  extractionRuntime: ExtractionRuntime;
  personalDataDirectory?: () => string | undefined;
  preflight: () => ConfigurationPreflightResult;
};

export function createScenarioHarness(options: ScenarioHarnessOptions) {
  const pluginRuntime = createStellaFitnessRuntime(options);

  return {
    selectProgram(programSpec: unknown) {
      return pluginRuntime.selectProgram(programSpec);
    },
    confirmCycleStart(cycleStart: string) {
      return pluginRuntime.confirmCycleStart(cycleStart);
    },
    resolvePlannedSession(
      input: Parameters<typeof pluginRuntime.resolvePlannedSession>[0],
    ) {
      return pluginRuntime.resolvePlannedSession(input);
    },
    extract(input: HarnessInput) {
      return pluginRuntime.extractWorkoutLog({
        runId: input.runId,
        media: input.media,
        timeoutMs: input.timeoutMs,
        signal: input.signal ?? new AbortController().signal,
      });
    },
  };
}

export class ControlledExtractionRuntime implements ExtractionRuntime {
  readonly requests: ExtractionRequest[] = [];
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
    this.requests.push(request);
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
