import type { ExtractionExecutionMetadata } from "../extraction/runtime.js";

export type RawMediaUpload = {
  readonly bytes: Buffer;
  readonly fileName: string;
  readonly mime: "image/jpeg" | "image/png" | "image/webp";
  readonly receivedAt: string;
  readonly provenance: {
    readonly channel?: string;
    readonly messageId?: string;
  };
};

export type RawArtifactRecord = {
  readonly schemaVersion: "stella-fitness/raw-artifact/v0.1";
  readonly id: string;
  readonly kind: "workout-log-image";
  readonly path: string;
  readonly sha256: string;
  readonly size: number;
  readonly originalFileName: string;
  readonly mime: RawMediaUpload["mime"];
  readonly provenance: {
    readonly kind: "openclaw-media";
    readonly receivedAt: string;
    readonly channel?: string;
    readonly messageId?: string;
  };
};

export type WorkoutLogProcessingRecord = {
  readonly schemaVersion: "stella-fitness/processing/workout-log/v0.1";
  readonly id: string;
  readonly path: string;
  readonly operation:
    | "workout-log-extraction"
    | "workout-log-confirmation";
  readonly runId: string;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly status: "succeeded" | "awaiting-confirmation" | "failed";
  readonly artifact: Pick<RawArtifactRecord, "id" | "path" | "sha256">;
  readonly payload?: {
    readonly category: "sanitized-workout-log-image";
    readonly transport: "buffer" | "runtime-file";
    readonly mime: string;
    readonly sha256: string;
  };
  readonly execution?: ExtractionExecutionMetadata;
  readonly result?:
    | {
        readonly kind: "workout-log-observation";
        readonly observationId: string;
        readonly path: string;
      }
    | {
        readonly kind: "workout-log-confirmation";
        readonly confirmationId: string;
      };
  readonly errorCategory?:
    | "cancelled"
    | "extraction-failed"
    | "invalid-image"
    | "invalid-result"
    | "shutdown"
    | "timeout";
};

export type WorkoutLogIngestRequest = {
  readonly runId: string;
  readonly upload: RawMediaUpload;
  readonly timeoutMs: number;
  readonly signal: AbortSignal;
};
