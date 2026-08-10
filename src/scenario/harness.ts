import type {
  ExtractionRequest,
  ExtractionResult,
  ExtractionRuntime,
} from "../extraction/runtime.js";

type HarnessInput = Omit<ExtractionRequest, "signal"> & {
  signal?: AbortSignal;
};

type ScenarioHarnessOptions = {
  extractionRuntime: ExtractionRuntime;
};

export function createScenarioHarness(options: ScenarioHarnessOptions) {
  return {
    async extract(input: HarnessInput) {
      const controller = new AbortController();
      const signal = input.signal ?? controller.signal;
      throwIfAborted(signal);

      const result = await rejectOnAbort(
        options.extractionRuntime.extract({
          image: input.image,
          fileName: input.fileName,
          mime: input.mime,
          timeoutMs: input.timeoutMs,
          signal,
        }),
        signal,
      );
      throwIfAborted(signal);

      return {
        status: "candidate" as const,
        candidate: result.parsed,
        execution: result.metadata,
      };
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

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) {
    return;
  }

  const error = new Error("Extraction cancelled");
  error.name = "AbortError";
  throw error;
}

async function rejectOnAbort<T>(
  promise: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  throwIfAborted(signal);

  return await new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      const error = new Error("Extraction cancelled");
      error.name = "AbortError";
      reject(error);
    };
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", onAbort);
    });
  });
}
