import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";

import type {
  ExtractionRequest,
  ExtractionResult,
  ExtractionRuntime,
} from "./runtime.js";
import { rejectOnAbort, throwIfAborted } from "./cancellation.js";
import {
  TARGETED_WORKOUT_LOG_CANDIDATE_SCHEMA,
  WORKOUT_LOG_CANDIDATE_SCHEMA,
} from "./candidate.js";
import { normalizeWorkoutLogExtraction } from "./candidate.js";
import { workoutLogExtractionInstructions } from "./instructions.js";

type ExtractStructuredWithModel =
  OpenClawPluginApi["runtime"]["mediaUnderstanding"]["extractStructuredWithModel"];

type OpenClawExtractionOptions = {
  extractStructuredWithModel: ExtractStructuredWithModel;
  openclawConfig: Parameters<ExtractStructuredWithModel>[0]["cfg"];
  model: {
    provider: string;
    model: string;
  };
};

export function createOpenClawExtractionRuntime(
  options: OpenClawExtractionOptions,
): ExtractionRuntime {
  return {
    async extract(request: ExtractionRequest): Promise<ExtractionResult> {
      throwIfAborted(request.signal);

      let result: Awaited<ReturnType<ExtractStructuredWithModel>>;
      try {
        const extraction = options.extractStructuredWithModel({
          input: [
            {
              type: "image",
              buffer: request.media.bytes,
              fileName: request.media.fileName,
              mime: request.media.mime,
            },
          ],
          instructions: workoutLogExtractionInstructions(request.target),
          schemaName: "stella_workout_log_candidate_v2",
          jsonSchema: request.target === undefined
            ? WORKOUT_LOG_CANDIDATE_SCHEMA
            : TARGETED_WORKOUT_LOG_CANDIDATE_SCHEMA,
          jsonMode: true,
          cfg: options.openclawConfig,
          provider: options.model.provider,
          model: options.model.model,
          timeoutMs: request.timeoutMs,
        });
        result = await rejectOnAbort(extraction, request.signal);
      } catch (error) {
        if (
          error instanceof Error &&
          error.message.includes("does not support structured extraction")
        ) {
          throw new StructuredExtractionProviderUnavailableError(
            options.model.provider,
            options.model.model,
          );
        }
        throw error;
      }
      if (result.parsed === undefined) {
        throw new Error("OpenClaw returned no structured extraction result");
      }

      return {
        parsed: normalizeWorkoutLogExtraction(result.parsed),
        metadata: compactMetadata({
          provider: result.provider,
          model: result.model,
          contentType: result.contentType,
        }),
      };
    },
  };
}

export class StructuredExtractionProviderUnavailableError extends Error {
  readonly provider: string;
  readonly model: string;

  constructor(provider: string, model: string) {
    super(
      `OpenClaw provider ${provider}/${model} does not support structured extraction`,
    );
    this.name = "StructuredExtractionProviderUnavailableError";
    this.provider = provider;
    this.model = model;
  }
}

function compactMetadata(metadata: {
  provider?: string | undefined;
  model?: string | undefined;
  contentType?: "json" | "text" | undefined;
}): ExtractionResult["metadata"] {
  return Object.fromEntries(
    Object.entries(metadata).filter((entry) => entry[1] !== undefined),
  );
}
