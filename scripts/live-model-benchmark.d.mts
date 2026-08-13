export type LiveBenchmark = {
  readonly manifestPath: string;
  readonly rootDirectory: string;
  readonly provider: string;
  readonly model: string;
  readonly cases: readonly {
    readonly id: string;
    readonly imagePath: string;
    readonly expected: Readonly<Record<string, unknown>>;
    readonly approval: Readonly<Record<string, string>>;
  }[];
  readonly requiredCoverage: readonly string[];
  readonly providerEvidence: Readonly<Record<string, unknown>> | undefined;
};

export const REQUIRED_LIVE_BENCHMARK_COVERAGE: readonly string[];

export function loadLiveBenchmark(manifestPath: string): Promise<LiveBenchmark>;

export function resolveLiveBenchmarkManifest(options: {
  readonly workingDirectory: string;
  readonly environment: Readonly<Record<string, string | undefined>>;
}): string;

export type LiveBenchmarkCaseScore = {
  readonly outcome: "ordinary" | "strength-test" | "crop-required" | "invalid";
  readonly expectedOutcome: "ordinary" | "strength-test" | "crop-required";
  readonly coverage: string;
  readonly structuredValid: boolean;
  readonly identity: { readonly correct: number; readonly total: number };
  readonly exactFields: { readonly correct: number; readonly total: number };
  readonly criticalNumeric: { readonly errors: number; readonly total: number };
  readonly blankPreservation: { readonly correct: number; readonly total: number };
  readonly loadSemantics: { readonly correct: number; readonly total: number };
  readonly layoutClassification: { readonly correct: number; readonly total: number };
  readonly setSemantics: { readonly correct: number; readonly total: number };
  readonly abstention: {
    readonly truePositive: number;
    readonly falsePositive: number;
    readonly falseNegative: number;
  };
  readonly planLeakage: { readonly errors: number; readonly total: number };
  readonly correctionsRequired: number;
};

export function scoreLiveBenchmarkCase(
  expected: Readonly<Record<string, unknown>>,
  actual: unknown,
): LiveBenchmarkCaseScore;

export type TimedLiveBenchmarkCaseScore = LiveBenchmarkCaseScore & {
  readonly latencyMs: number;
};

export function summarizeLiveBenchmark(
  scores: readonly TimedLiveBenchmarkCaseScore[],
  options?: {
    readonly requiredCoverage?: readonly string[];
    readonly providerEvidence?: Readonly<Record<string, unknown>>;
  },
): Readonly<Record<string, number | boolean>>;

export function runLiveBenchmark(options: {
  readonly manifestPath: string;
  readonly timeoutMs?: number;
  readonly adapterSha256?: string;
  readonly extractStructured(request: Readonly<{
    provider: string;
    model: string;
    bytes: Buffer;
    fileName: string;
    mime: "image/png";
    timeoutMs: number;
    instructions: string;
    schemaName: string;
    jsonSchema: Readonly<Record<string, unknown>>;
  }>): Promise<{
    readonly parsed: unknown;
    readonly execution: {
      readonly provider: string;
      readonly model: string;
      readonly host: string;
      readonly requestId: string;
      readonly operatorPermissionVerified: boolean;
    };
  }>;
}): Promise<{
  readonly cases: readonly Readonly<Record<string, unknown>>[];
  readonly evidence: Readonly<Record<string, unknown>>;
  readonly summary: Readonly<Record<string, number | boolean>>;
}>;
