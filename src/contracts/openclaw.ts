import {
  buildAllowedModelSet,
  resolveAllowlistModelKey,
} from "openclaw/plugin-sdk/agent-runtime";
import type { OpenClawConfig } from "openclaw/plugin-sdk/plugin-entry";

export const OPENCLAW_CONTRACT_BASELINE = {
  developmentVersion: "2026.6.34",
  minimumVersion: "2026.6.34",
  hooks: ["inbound_claim", "before_agent_reply", "before_agent_run"],
  conversationBinding: "command-context.requestConversationBinding",
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
): typeof OPENCLAW_CONTRACT_BASELINE {
  if (typeof host.on !== "function") {
    throw new OpenClawContractError("conversation-hooks");
  }
  if (
    typeof host.runtime.mediaUnderstanding.extractStructuredWithModel !==
    "function"
  ) {
    throw new OpenClawContractError("structured-media");
  }

  return OPENCLAW_CONTRACT_BASELINE;
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
