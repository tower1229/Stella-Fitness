import type { SanitizedMediaCopy } from "../media/sanitized-copy.js";

export type ExtractionExecutionMetadata = {
  provider?: string;
  model?: string;
  contentType?: "json" | "text";
};

export type ExtractionRequest = {
  runId: string;
  media: SanitizedMediaCopy;
  timeoutMs: number;
  signal: AbortSignal;
};

export type ExtractionResult = {
  parsed: unknown;
  metadata: ExtractionExecutionMetadata;
};

export interface ExtractionRuntime {
  extract(request: ExtractionRequest): Promise<ExtractionResult>;
}
