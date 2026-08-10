import {
  buildAllowedModelSet,
  resolveAllowlistModelKey,
} from "openclaw/plugin-sdk/agent-runtime";
import type { OpenClawConfig } from "openclaw/plugin-sdk/plugin-entry";

export const LOCKED_OPENCLAW_CONTRACT = {
  packageVersion: "2026.7.1-2",
  runtimeVersions: ["2026.7.1", "2026.7.1-2"],
  hooks: ["before_agent_reply", "before_agent_run"],
  structuredMedia: "runtime.mediaUnderstanding.extractStructuredWithModel",
  modelPermission: "explicit-openclaw-model-allowlist",
  executionMetadata: ["provider", "model", "contentType"],
  timeout: "timeoutMs",
  cancellation: "abort-signal-result-gate",
} as const;

type ContractHost = {
  runtime: {
    version: string;
    mediaUnderstanding: {
      extractStructuredWithModel?: unknown;
    };
  };
  on?: unknown;
};

export class OpenClawContractError extends Error {
  readonly contract:
    | "host-version"
    | "conversation-hooks"
    | "structured-media"
    | "model-permission";

  constructor(contract: OpenClawContractError["contract"]) {
    super(`Unsupported OpenClaw contract: ${contract}`);
    this.name = "OpenClawContractError";
    this.contract = contract;
  }
}

export function assertOpenClawContract(
  host: ContractHost,
): typeof LOCKED_OPENCLAW_CONTRACT {
  if (
    !LOCKED_OPENCLAW_CONTRACT.runtimeVersions.includes(
      host.runtime.version as (typeof LOCKED_OPENCLAW_CONTRACT.runtimeVersions)[number],
    )
  ) {
    throw new OpenClawContractError("host-version");
  }
  if (typeof host.on !== "function") {
    throw new OpenClawContractError("conversation-hooks");
  }
  if (
    typeof host.runtime.mediaUnderstanding.extractStructuredWithModel !==
    "function"
  ) {
    throw new OpenClawContractError("structured-media");
  }

  return LOCKED_OPENCLAW_CONTRACT;
}

export function assertOperatorModelPermission(
  config: OpenClawConfig,
  selection: { provider: string; model: string },
): void {
  const raw = `${selection.provider}/${selection.model}`;
  const key = resolveAllowlistModelKey(raw, selection.provider, config);
  const allowed = buildAllowedModelSet({
    cfg: config,
    catalog: [],
    defaultProvider: "__stella_fitness_no_default__",
  });

  if (allowed.allowAny || key === null || !allowed.allowedKeys.has(key)) {
    throw new OpenClawContractError("model-permission");
  }
}
