import { describe, expect, it, vi } from "vitest";

import { createOpenClawFitnessQueryClassifier } from "../src/query/openclaw.js";

describe("OpenClaw Fitness Query Intent classifier", () => {
  it("accepts only a high-confidence allowlisted read intent", async () => {
    const complete = vi.fn().mockResolvedValue({
      text: JSON.stringify({ kind: "recent-training", confidence: "high" }),
    });
    const classifier = createOpenClawFitnessQueryClassifier({
      complete,
      agentId: () => "fitness",
    });

    await expect(classifier.classify({
      text: "我的训练情况到哪一步了",
    })).resolves.toEqual({
      status: "classified",
      intent: { kind: "recent-training" },
    });
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({
      agentId: "fitness",
      temperature: 0,
      purpose: "stella-fitness-query-intent",
      messages: [{
        role: "user",
        content: JSON.stringify({ text: "我的训练情况到哪一步了" }),
      }],
    }));
  });

  it.each([
    [{ kind: "current-state", confidence: "low" }, "low-confidence"],
    [{ kind: "invented", confidence: "high" }, "invalid-output"],
    [{ kind: "current-state", confidence: "high", date: "2026-08-12" }, "invalid-output"],
    [{ kind: "current-state", confidence: 1 }, "invalid-output"],
  ] as const)("fails closed for constrained output %#", async (output, status) => {
    const classifier = createOpenClawFitnessQueryClassifier({
      complete: vi.fn().mockResolvedValue({ text: JSON.stringify(output) }),
      agentId: () => "fitness",
    });

    await expect(classifier.classify({ text: "训练情况" })).resolves.toEqual({
      status,
    });
  });

  it("distinguishes Provider failure, timeout and missing Agent configuration", async () => {
    await expect(createOpenClawFitnessQueryClassifier({
      complete: vi.fn().mockRejectedValue(new Error("provider failed")),
      agentId: () => "fitness",
    }).classify({ text: "训练情况" })).resolves.toEqual({
      status: "provider-error",
    });

    await expect(createOpenClawFitnessQueryClassifier({
      complete: vi.fn().mockImplementation(({ signal }: { signal: AbortSignal }) =>
        new Promise((_, reject) =>
          signal.addEventListener("abort", () => reject(signal.reason)),
        )
      ),
      agentId: () => "fitness",
      timeoutMs: 1,
    }).classify({ text: "训练情况" })).resolves.toEqual({ status: "timeout" });

    await expect(createOpenClawFitnessQueryClassifier({
      complete: vi.fn(),
      agentId: () => undefined,
    }).classify({ text: "训练情况" })).resolves.toEqual({
      status: "missing-agent-id",
    });
  });
});
