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
      kind: "accept-with-overrides",
      updates: [{ fieldId: "f1", value: "中" }],
    });
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({
      agentId: "fitness",
      temperature: 0,
      purpose: "stella-fitness-workout-log-confirmation-intent",
    }));
  });

  it.each([
    { kind: "provide-values", confidence: "high", updates: [{ fieldId: "f9", value: "中" }] },
    { kind: "accept-all", confidence: "high", extra: true },
    { kind: "provide-values", confidence: "low", updates: [{ fieldId: "f1", value: "中" }] },
    { kind: "provide-values", confidence: "high", updates: [{ fieldId: "f1", value: { invented: true } }] },
  ])("fails closed on invalid constrained output %#", async (output) => {
    const classifier = createOpenClawConfirmationIntentClassifier({
      complete: vi.fn().mockResolvedValue({ text: JSON.stringify(output) }),
      agentId: () => "fitness",
    });

    await expect(classifier.classify(input)).resolves.toEqual({ kind: "ambiguous" });
  });

  it("fails closed on provider failure and timeout", async () => {
    const providerFailure = createOpenClawConfirmationIntentClassifier({
      complete: vi.fn().mockRejectedValue(new Error("provider failed")),
      agentId: () => "fitness",
    });
    await expect(providerFailure.classify(input)).resolves.toEqual({
      kind: "ambiguous",
    });

    const timeout = createOpenClawConfirmationIntentClassifier({
      complete: vi.fn().mockImplementation(({ signal }: { signal: AbortSignal }) =>
        new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason))),
      ),
      agentId: () => "fitness",
      timeoutMs: 1,
    });
    await expect(timeout.classify(input)).resolves.toEqual({ kind: "ambiguous" });
  });
});
