import { describe, expect, it, vi } from "vitest";

import { createOpenClawExtractionRuntime } from "../src/extraction/openclaw.js";

describe("OpenClaw structured extraction adapter", () => {
  it("uses operator-owned model config and preserves observable execution metadata", async () => {
    const extractStructuredWithModel = vi.fn().mockResolvedValue({
      text: '{"stage":1}',
      parsed: { stage: 1 },
      provider: "operator-provider",
      model: "operator-model",
      contentType: "json",
    });
    const runtime = createOpenClawExtractionRuntime({
      extractStructuredWithModel,
      openclawConfig: {},
      model: { provider: "operator-provider", model: "operator-model" },
    });

    const result = await runtime.extract({
      image: Buffer.from("sanitized-image"),
      fileName: "sanitized.jpg",
      mime: "image/jpeg",
      timeoutMs: 1_500,
      signal: new AbortController().signal,
    });

    expect(extractStructuredWithModel).toHaveBeenCalledWith(
      expect.objectContaining({
        cfg: {},
        provider: "operator-provider",
        model: "operator-model",
        timeoutMs: 1_500,
        jsonMode: true,
        schemaName: "stella_workout_log_candidate_v1",
        input: [
          {
            type: "image",
            buffer: Buffer.from("sanitized-image"),
            fileName: "sanitized.jpg",
            mime: "image/jpeg",
          },
        ],
      }),
    );
    expect(result).toEqual({
      parsed: { stage: 1 },
      metadata: {
        provider: "operator-provider",
        model: "operator-model",
        contentType: "json",
      },
    });
  });

  it("rejects an in-flight result after caller cancellation", async () => {
    let resolveExtraction:
      | ((value: { text: string; parsed: object }) => void)
      | undefined;
    const extractStructuredWithModel = vi.fn(
      () =>
        new Promise<{ text: string; parsed: object }>((resolve) => {
          resolveExtraction = resolve;
        }),
    );
    const runtime = createOpenClawExtractionRuntime({
      extractStructuredWithModel,
      openclawConfig: {},
      model: { provider: "operator-provider", model: "operator-model" },
    });
    const controller = new AbortController();
    const extraction = runtime.extract({
      image: Buffer.from("sanitized-image"),
      fileName: "sanitized.jpg",
      mime: "image/jpeg",
      timeoutMs: 1_500,
      signal: controller.signal,
    });

    controller.abort("user-cancelled");
    resolveExtraction?.({ text: '{"stage":1}', parsed: { stage: 1 } });

    await expect(extraction).rejects.toMatchObject({ name: "AbortError" });
  });
});
