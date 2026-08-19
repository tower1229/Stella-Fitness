import { describe, expect, it, vi } from "vitest";

import { createOpenClawConfirmationIntentClassifier } from "../src/confirmation/openclaw.js";

const input = {
  text: "其他都对，但平板支撑质量是中",
  fields: [{
    fieldId: "f1",
    label: "平板支撑动作质量",
    suggestedValue: null,
  }],
};

describe("OpenClaw confirmation intent classifier", () => {
  it("accepts only high-confidence whitelisted field updates", async () => {
    const complete = vi.fn().mockResolvedValue({
      text: JSON.stringify({
        kind: "accept-with-overrides",
        confidence: "high",
        updates: [{ fieldId: "f1", value: "中" }],
      }),
    });
    const classifier = createOpenClawConfirmationIntentClassifier({
      complete,
      agentId: () => "fitness",
    });

    await expect(classifier.classify(input)).resolves.toEqual({
      status: "classified",
      intent: {
        kind: "accept-with-overrides",
        updates: [{ fieldId: "f1", value: "中" }],
      },
    });
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({
      agentId: "fitness",
      temperature: 0,
      purpose: "stella-fitness-workout-log-confirmation-intent",
    }));
  });

  it.each([
    {
      output: { kind: "provide-values", confidence: "high", updates: [{ fieldId: "f9", value: "中" }] },
      status: "invalid-output",
    },
    {
      output: { kind: "accept-all", confidence: "high", extra: true },
      status: "invalid-output",
    },
    {
      output: { kind: "provide-values", confidence: "low", updates: [{ fieldId: "f1", value: "中" }] },
      status: "low-confidence",
    },
    {
      output: { kind: "accept-all", confidence: "low", extra: true },
      status: "invalid-output",
    },
    {
      output: { kind: "invented", confidence: "low" },
      status: "invalid-output",
    },
    {
      output: { kind: "provide-values", confidence: "high", updates: [{ fieldId: "f1", value: { invented: true } }] },
      status: "invalid-output",
    },
  ])("fails closed with a specific reason for constrained output %#", async ({ output, status }) => {
    const classifier = createOpenClawConfirmationIntentClassifier({
      complete: vi.fn().mockResolvedValue({ text: JSON.stringify(output) }),
      agentId: () => "fitness",
    });

    await expect(classifier.classify(input)).resolves.toEqual({ status });
  });

  it("distinguishes provider failure, timeout, and missing agent configuration", async () => {
    const providerFailure = createOpenClawConfirmationIntentClassifier({
      complete: vi.fn().mockRejectedValue(new Error("provider failed")),
      agentId: () => "fitness",
    });
    await expect(providerFailure.classify(input)).resolves.toEqual({
      status: "provider-error",
    });

    const timeout = createOpenClawConfirmationIntentClassifier({
      complete: vi.fn().mockImplementation(({ signal }: { signal: AbortSignal }) =>
        new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason))),
      ),
      agentId: () => "fitness",
      timeoutMs: 1,
    });
    await expect(timeout.classify(input)).resolves.toEqual({ status: "timeout" });

    const missingAgent = createOpenClawConfirmationIntentClassifier({
      complete: vi.fn(),
      agentId: () => undefined,
    });
    await expect(missingAgent.classify(input)).resolves.toEqual({
      status: "missing-agent-id",
    });
  });
});
