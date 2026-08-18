import type { SanitizedMediaCopy } from "../media/sanitized-copy.js";

export type ExtractionExecutionMetadata = {
  provider?: string;
  model?: string;
  contentType?: "json" | "text";
};

export type ExtractionRequest = {
  runId: string;
  media: SanitizedMediaCopy;
  target?: WorkoutLogTarget;
  timeoutMs: number;
  signal: AbortSignal;
};

export type WorkoutLogTarget = {
  readonly date: string;
  readonly stage: number;
  readonly week: number;
  readonly weekday: string;
  readonly sessionType: string;
  readonly exerciseIds: readonly string[];
};

export type ExtractionResult = {
  parsed: unknown;
  metadata: ExtractionExecutionMetadata;
};

export interface ExtractionRuntime {
  extract(request: ExtractionRequest): Promise<ExtractionResult>;
}
