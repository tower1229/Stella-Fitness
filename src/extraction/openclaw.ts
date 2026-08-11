import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";

import type {
  ExtractionRequest,
  ExtractionResult,
  ExtractionRuntime,
} from "./runtime.js";
import { rejectOnAbort, throwIfAborted } from "./cancellation.js";
import { WORKOUT_LOG_CANDIDATE_SCHEMA } from "./candidate.js";

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

      const extraction = options.extractStructuredWithModel({
        input: [
          {
            type: "image",
            buffer: request.media.bytes,
            fileName: request.media.fileName,
            mime: request.media.mime,
          },
        ],
        instructions:
          "Extract only candidate facts from the fixed Zhuoshu three-stage workout workbook. Classify ordinary pages as zhuoshu-three-stage-workbook and strength-test pages as zhuoshu-strength-test-block. Use strength_test for Week 4 Friday and end_of_cycle_retest only for the post-cycle 12RM retest. Identify stage, week, weekday, session type, ordinary exercises or strength-test results, load semantics, set-cell values, action quality, notes, field confidence, and uncertainty. Treat intentionally blank actual cells as null. Never copy ProgramSpec targets into blank actual cells. Never treat the pull-up max result as a replacement for programmed total reps. Do not diagnose, advise, or infer health, safety, nutrition, or training quality.",
        schemaName: "stella_workout_log_candidate_v2",
        jsonSchema: WORKOUT_LOG_CANDIDATE_SCHEMA,
        jsonMode: true,
        cfg: options.openclawConfig,
        provider: options.model.provider,
        model: options.model.model,
        timeoutMs: request.timeoutMs,
      });

      const result = await rejectOnAbort(extraction, request.signal);
      if (result.parsed === undefined) {
        throw new Error("OpenClaw returned no structured extraction result");
      }

      return {
        parsed: result.parsed,
        metadata: compactMetadata({
          provider: result.provider,
          model: result.model,
          contentType: result.contentType,
        }),
      };
    },
  };
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
