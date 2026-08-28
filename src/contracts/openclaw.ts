import {
  buildAllowedModelSet,
  resolveAllowlistModelKey,
} from "openclaw/plugin-sdk/agent-runtime";
import type { OpenClawConfig } from "openclaw/plugin-sdk/plugin-entry";

export const OPENCLAW_CONTRACT_BASELINE = {
  developmentVersion: "2026.7.1-2",
  minimumVersion: "2026.6.34",
  hooks: [
    "inbound_claim",
    "before_agent_reply",
    "before_prompt_build",
    "before_agent_run",
    "message_received",
    "reply_payload_sending",
    "reply_dispatch",
  ],
  dedicatedAgentScope: "routing.parseAgentSessionKey+resolveAgentRoute",
  agentMemory: [
    "memory-core.resolveMemorySearchConfig",
    "memory-core.getMemoryCapabilityRegistration",
    "agent-scoped-memory-source",
    "agent-scoped-session-source",
  ],
  structuredMedia: "runtime.mediaUnderstanding.extractStructuredWithModel",
  confirmationState: "plugin-owned-runtime-directory",
  semanticConfirmation: "runtime.llm.complete",
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
    llm: { complete?: unknown };
  };
  on?: unknown;
};

export class OpenClawContractError extends Error {
  readonly contract:
    | "conversation-hooks"
    | "structured-media"
    | "llm-complete"
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
  if (typeof host.runtime.llm.complete !== "function") {
    throw new OpenClawContractError("llm-complete");
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
