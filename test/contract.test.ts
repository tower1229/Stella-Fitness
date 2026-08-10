import { describe, expect, it, vi } from "vitest";

import {
  OPENCLAW_CONTRACT_BASELINE,
  OpenClawContractError,
  assertOpenClawContract,
  assertOperatorModelPermission,
} from "../src/contracts/openclaw.js";

describe("OpenClaw stable contract baseline", () => {
  it("accepts the baseline host surfaces and records every required contract", () => {
    expect(assertOpenClawContract(compatibleHost())).toEqual(
      OPENCLAW_CONTRACT_BASELINE,
    );
    expect(OPENCLAW_CONTRACT_BASELINE).toMatchObject({
      developmentVersion: "2026.6.34",
      minimumVersion: "2026.6.34",
      hooks: ["inbound_claim", "before_agent_reply", "before_agent_run"],
      structuredMedia: "runtime.mediaUnderstanding.extractStructuredWithModel",
      modelPermission: "explicit-openclaw-model-allowlist",
      executionMetadata: ["provider", "model", "contentType"],
      timeout: "timeoutMs",
      cancellation: "abort-signal-result-gate",
    });
  });

  it("fails before personal data is accessed when a required surface is missing", () => {
    const host = compatibleHost();
    host.runtime.mediaUnderstanding.extractStructuredWithModel = undefined;

    expect(() => assertOpenClawContract(host)).toThrow(
      new OpenClawContractError("structured-media"),
    );
  });

  it("accepts newer hosts by capabilities instead of an exact version whitelist", () => {
    const host = compatibleHost();
    host.runtime.version = "2026.8.1";

    expect(() => assertOpenClawContract(host)).not.toThrow();
  });

  it("requires an explicit OpenClaw model allowlist entry", () => {
    const selection = { provider: "operator-provider", model: "operator-model" };
    const allowedConfig = {
      agents: {
        defaults: {
          models: { "operator-provider/operator-model": {} },
        },
      },
    };

    expect(() =>
      assertOperatorModelPermission(allowedConfig, selection),
    ).not.toThrow();
    expect(() => assertOperatorModelPermission({}, selection)).toThrow(
      new OpenClawContractError("model-permission"),
    );
  });
});

function compatibleHost(): {
  runtime: {
    version: string;
    mediaUnderstanding: { extractStructuredWithModel?: unknown };
  };
  on: ReturnType<typeof vi.fn>;
} {
  return {
    runtime: {
      version: "2026.6.34",
      mediaUnderstanding: {
        extractStructuredWithModel: vi.fn(),
      },
    },
    on: vi.fn(),
  };
}
