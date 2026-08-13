import type {
  VerificationProfile,
  VerificationReceipt,
} from "./verification-environment.mjs";

export interface PersistedVerificationReceipt extends VerificationReceipt {
  readonly sourceRevision: string;
  readonly sourceClean: boolean;
  readonly profileDefinitionSha256: string;
}

export function persistVerificationReceipt(options: {
  readonly receipt: VerificationReceipt;
  readonly cwd: string;
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly sourceState?: {
    readonly revision: string;
    readonly clean: boolean;
  };
  readonly profile: VerificationProfile;
}): Promise<{
  readonly receipt: PersistedVerificationReceipt;
  readonly path: string;
  readonly relativePath: string;
}>;

export function loadVerificationReceipts(options: {
  readonly cwd: string;
  readonly project: string;
  readonly profiles: Readonly<Record<string, VerificationProfile>>;
  readonly environment?: Readonly<Record<string, string | undefined>>;
}): Promise<{
  readonly receipts: readonly PersistedVerificationReceipt[];
  readonly invalidFiles: readonly string[];
}>;
