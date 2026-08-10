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

export function createStellaFitnessRuntime(options: {
  extractionRuntime: ExtractionRuntime;
}): StellaFitnessRuntime {
  const runs = new Map<string, Promise<PluginExtractionOutput>>();

  return {
    extractWorkoutLog(request) {
      const existing = runs.get(request.runId);
      if (existing !== undefined) {
        return existing;
      }

      const extraction = executeExtraction(options.extractionRuntime, request);
      runs.set(request.runId, extraction);
      return extraction;
    },
  };
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
