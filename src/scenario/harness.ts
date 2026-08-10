import type {
  ExtractionRequest,
  ExtractionResult,
  ExtractionRuntime,
} from "../extraction/runtime.js";
import { rejectOnAbort, throwIfAborted } from "../extraction/cancellation.js";
import { createStellaFitnessRuntime } from "../plugin-runtime.js";

type HarnessInput = Omit<ExtractionRequest, "signal"> & {
  signal?: AbortSignal;
};

type ScenarioHarnessOptions = {
  extractionRuntime: ExtractionRuntime;
};

export function createScenarioHarness(options: ScenarioHarnessOptions) {
  const pluginRuntime = createStellaFitnessRuntime(options);

  return {
    async extract(input: HarnessInput) {
      const controller = new AbortController();
      const signal = input.signal ?? controller.signal;
      throwIfAborted(signal);

      return await rejectOnAbort(
        pluginRuntime.extractWorkoutLog({
          runId: input.runId,
          media: input.media,
          timeoutMs: input.timeoutMs,
          signal,
        }),
        signal,
      );
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
