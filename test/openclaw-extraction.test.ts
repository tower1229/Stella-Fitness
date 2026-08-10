import { describe, expect, it, vi } from "vitest";

import { createOpenClawExtractionRuntime } from "../src/extraction/openclaw.js";
import { sanitizedMediaFixture } from "./support/sanitized-media.js";

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
      runId: "run-1",
      media: sanitizedFixture(),
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
        jsonSchema: expect.objectContaining({
          type: "object",
          additionalProperties: false,
          required: [
            "layout",
            "stage",
            "week",
            "weekday",
            "sessionType",
            "exercises",
            "uncertainFields",
          ],
        }),
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
    expect(extractStructuredWithModel.mock.calls[0]?.[0].instructions).toContain(
      "Never copy ProgramSpec targets into blank actual cells",
    );
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
      runId: "run-2",
      media: sanitizedFixture(),
      timeoutMs: 1_500,
      signal: controller.signal,
    });

    controller.abort("user-cancelled");
    resolveExtraction?.({ text: '{"stage":1}', parsed: { stage: 1 } });

    await expect(extraction).rejects.toMatchObject({ name: "AbortError" });
  });
});

function sanitizedFixture() {
  return sanitizedMediaFixture(Buffer.from("sanitized-image"), "sanitized.jpg");
}
