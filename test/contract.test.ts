import { describe, expect, it, vi } from "vitest";

import {
  LOCKED_OPENCLAW_CONTRACT,
  OpenClawContractError,
  assertOpenClawContract,
  assertOperatorModelPermission,
} from "../src/contracts/openclaw.js";

describe("locked OpenClaw contract", () => {
  it("accepts the locked host surfaces and records every required contract", () => {
    expect(assertOpenClawContract(compatibleHost())).toEqual(
      LOCKED_OPENCLAW_CONTRACT,
    );
    expect(LOCKED_OPENCLAW_CONTRACT).toMatchObject({
      packageVersion: "2026.7.1-2",
      runtimeVersions: ["2026.7.1", "2026.7.1-2"],
      hooks: ["before_agent_reply", "before_agent_run"],
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

  it("rejects an incompatible host version before personal data is accessed", () => {
    let structuredMediaAccesses = 0;
    const host = {
      runtime: {
        version: "2026.7.2",
        get mediaUnderstanding() {
          structuredMediaAccesses += 1;
          return { extractStructuredWithModel: vi.fn() };
        },
      },
      on: vi.fn(),
    };

    expect(() => assertOpenClawContract(host)).toThrow(
      new OpenClawContractError("host-version"),
    );
    expect(structuredMediaAccesses).toBe(0);
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
      version: "2026.7.1-2",
      mediaUnderstanding: {
        extractStructuredWithModel: vi.fn(),
      },
    },
    on: vi.fn(),
  };
}
