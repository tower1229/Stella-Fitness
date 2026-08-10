export type ExtractionExecutionMetadata = {
  provider?: string;
  model?: string;
  contentType?: "json" | "text";
};

export type ExtractionRequest = {
  image: Buffer;
  fileName: string;
  mime: string;
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
