export const VERIFICATION_EXIT: Readonly<{
  passed: 0;
  failed: 1;
  usage: 2;
  environmentBlocked: 3;
}>;

export interface VerificationStep {
  readonly name: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly requirements?: readonly string[];
}

export interface VerificationProfile {
  readonly requirements: readonly string[];
  readonly steps: readonly VerificationStep[];
}

export interface VerificationReceipt {
  readonly schemaVersion: "verification-environment/v1";
  readonly project: string;
  readonly profile: string;
  readonly status: "passed" | "failed" | "environment_blocked" | "usage_error";
  readonly exitCode: number;
  readonly reasonCode?: string;
  readonly steps?: readonly Readonly<Record<string, unknown>>[];
}

export function resolveVerificationCache(options: {
  readonly temporaryRoot: string;
  readonly environment: Readonly<Record<string, string | undefined>>;
}): string;

export function classifyEnvironmentBlock(options: {
  readonly output: string;
  readonly requirements: readonly string[];
}): string | null;

export function executeVerification(options: {
  readonly project: string;
  readonly profileName: string;
  readonly profiles: Readonly<Record<string, VerificationProfile>>;
  readonly cwd: string;
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly now?: () => Date;
  readonly runStep?: (options: {
    readonly step: VerificationStep;
    readonly cwd: string;
    readonly environment: Readonly<Record<string, string | undefined>>;
    readonly writeLog: (text: string) => void;
  }) => Promise<{
    readonly durationMs: number;
    readonly exitCode: number;
    readonly output: string;
    readonly signal: NodeJS.Signals | null;
  }>;
  readonly writeLog?: (text: string) => void;
}): Promise<VerificationReceipt>;
