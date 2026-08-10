import { describe, expect, it, vi } from "vitest";

import {
  LOCKED_OPENCLAW_CONTRACT,
  OpenClawContractError,
  assertOpenClawContract,
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
      modelPermission: "operator-owned-provider-model-config",
      executionMetadata: ["provider", "model", "contentType"],
      timeout: "timeoutMs",
      cancellation: "abort-signal-result-gate",
    });
  });

  it("fails before personal data is accessed when a required surface is missing", () => {
    const personalDataAccess = vi.fn();
    const host = compatibleHost();
    host.runtime.mediaUnderstanding.extractStructuredWithModel = undefined;

    expect(() => assertOpenClawContract(host, personalDataAccess)).toThrow(
      new OpenClawContractError("structured-media"),
    );
    expect(personalDataAccess).not.toHaveBeenCalled();
  });

  it("rejects an incompatible host version before personal data is accessed", () => {
    const personalDataAccess = vi.fn();
    const host = compatibleHost();
    host.runtime.version = "2026.7.2";

    expect(() => assertOpenClawContract(host, personalDataAccess)).toThrow(
      new OpenClawContractError("host-version"),
    );
    expect(personalDataAccess).not.toHaveBeenCalled();
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
