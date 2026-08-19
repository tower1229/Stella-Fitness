import { describe, expect, it, vi } from "vitest";

import {
  createOpenClawExtractionRuntime,
  StructuredExtractionProviderUnavailableError,
} from "../src/extraction/openclaw.js";
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
        schemaName: "stella_workout_log_candidate_v2",
        jsonSchema: expect.objectContaining({
          oneOf: expect.arrayContaining([
            expect.objectContaining({
              required: expect.arrayContaining(["exercises"]),
            }),
            expect.objectContaining({
              required: expect.arrayContaining(["testResults"]),
            }),
          ]),
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
    expect(extractStructuredWithModel.mock.calls[0]?.[0].instructions).toContain(
      "Never treat the pull-up max result as a replacement for programmed total reps",
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

  it("normalizes bounded model aliases and uncertainty paths before candidate validation", async () => {
    const parsed = ordinaryCandidateFromLiveModel();
    const extractStructuredWithModel = vi.fn().mockResolvedValue({
      text: JSON.stringify(parsed),
      parsed,
      provider: "codex",
      model: "gpt-5.6-sol",
      contentType: "json",
    });
    const runtime = createOpenClawExtractionRuntime({
      extractStructuredWithModel,
      openclawConfig: {},
      model: { provider: "codex", model: "gpt-5.6-sol" },
    });

    await expect(runtime.extract({
      runId: "live-model-aliases",
      media: sanitizedFixture(),
      timeoutMs: 1_500,
      signal: new AbortController().signal,
    })).resolves.toMatchObject({
      parsed: {
        sessionType: { value: "full-body", confidence: "low" },
        exercises: [
          { exerciseId: { value: "goblet-squat", confidence: "high" } },
          { exerciseId: { value: "dumbbell-bench-press", confidence: "high" } },
          { exerciseId: { value: "dumbbell-deadlift", confidence: "high" } },
          { exerciseId: { value: "plank", confidence: "high" } },
        ],
        uncertainFields: [
          expect.objectContaining({
            path: "sessionType.value",
            candidates: ["full-body"],
          }),
          expect.objectContaining({ path: "exercises[3].load.value" }),
        ],
      },
    });
  });

  it("asks the provider to abstain when one image contains multiple session blocks", async () => {
    const extractStructuredWithModel = vi.fn().mockResolvedValue({
      text: '{"layout":"multi-session-page","reason":"multiple-session-blocks"}',
      parsed: {
        layout: "multi-session-page",
        reason: "multiple-session-blocks",
      },
    });
    const runtime = createOpenClawExtractionRuntime({
      extractStructuredWithModel,
      openclawConfig: {},
      model: { provider: "codex", model: "gpt-5.6-sol" },
    });

    const result = await runtime.extract({
      runId: "multi-session-page",
      media: sanitizedFixture(),
      timeoutMs: 1_500,
      signal: new AbortController().signal,
    });

    const request = extractStructuredWithModel.mock.calls[0]?.[0];
    expect(request.instructions).toContain("exactly one session block");
    expect(request.instructions).toContain("multi-session-page");
    expect(request.jsonSchema.oneOf).toContainEqual(
      expect.objectContaining({
        required: ["layout", "reason"],
        properties: expect.objectContaining({
          layout: { const: "multi-session-page" },
        }),
      }),
    );
    expect(result.parsed).toEqual({
      layout: "multi-session-page",
      reason: "multiple-session-blocks",
    });
  });

  it("locks structured extraction to the deterministic planned-session target", async () => {
    const extractStructuredWithModel = vi.fn().mockResolvedValue({
      parsed: { layout: "not-workout-log", reason: "not-fixed-workbook" },
      text: "{}",
    });
    const runtime = createOpenClawExtractionRuntime({
      extractStructuredWithModel,
      openclawConfig: {},
      model: { provider: "codex", model: "gpt-5.6-sol" },
    });

    await runtime.extract({
      runId: "targeted-week-one-monday",
      media: sanitizedFixture(),
      target: {
        date: "2026-08-10",
        stage: 1,
        week: 1,
        weekday: "monday",
        sessionType: "full-body",
        exerciseIds: [
          "goblet-squat",
          "dumbbell-bench-press",
          "dumbbell-deadlift",
          "plank",
        ],
      },
      timeoutMs: 1_500,
      signal: new AbortController().signal,
    });

    const request = extractStructuredWithModel.mock.calls[0]?.[0];
    expect(request.instructions).toContain(
      "Target exactly: stage 1, week 1, monday, full-body, date 2026-08-10",
    );
    expect(request.instructions).toContain(
      "Ignore every other visible session block",
    );
    expect(request.instructions).toContain(
      "Once the target header and complete exercise-label set match",
    );
    expect(request.instructions).toContain(
      "Return a candidate and list only those unclear actual fields in uncertainFields",
    );
    expect(request.instructions).toContain(
      "goblet-squat, dumbbell-bench-press, dumbbell-deadlift, plank",
    );
    expect(request.jsonSchema.oneOf).toContainEqual(
      expect.objectContaining({
        properties: expect.objectContaining({
          layout: { const: "not-workout-log" },
        }),
      }),
    );
    expect(request.jsonSchema.oneOf).not.toContainEqual(
      expect.objectContaining({
        properties: expect.objectContaining({
          layout: { const: "multi-session-page" },
        }),
      }),
    );
  });

  it("reports an explicit compatibility error when the selected provider lacks structured extraction", async () => {
    const extractStructuredWithModel = vi.fn().mockRejectedValue(
      new Error("Provider does not support structured extraction: codex"),
    );
    const runtime = createOpenClawExtractionRuntime({
      extractStructuredWithModel,
      openclawConfig: {},
      model: { provider: "codex", model: "gpt-5.6-sol" },
    });

    await expect(runtime.extract({
      runId: "unsupported-provider",
      media: sanitizedFixture(),
      timeoutMs: 1_500,
      signal: new AbortController().signal,
    })).rejects.toEqual(
      new StructuredExtractionProviderUnavailableError("codex", "gpt-5.6-sol"),
    );
  });
});

function sanitizedFixture() {
  return sanitizedMediaFixture(Buffer.from("sanitized-image"), "sanitized.jpg");
}

function ordinaryCandidateFromLiveModel() {
  const field = <T>(value: T, confidence: "high" | "low" = "high") => ({
    value,
    confidence,
  });
  const exercise = (rawLabel: string, exerciseId: string) => ({
    rawLabel: field(rawLabel),
    exerciseId: field(exerciseId),
    load: field(null),
    sets: [field(10)],
    actionQuality: field(null),
    problemNote: field(null),
  });
  return {
    layout: field("zhuoshu-three-stage-workbook"),
    stage: field(1),
    week: field(1),
    weekday: field("friday"),
    sessionType: field("full_body_training", "low"),
    exercises: [
      exercise("高脚杯深蹲", "goblet_squat"),
      exercise("哑铃卧推", "dumbbell_bench_press"),
      exercise("哑铃硬拉", "dumbbell_deadlift"),
      exercise("平板支撑", "plank"),
    ],
    uncertainFields: [
      {
        path: "sessionType.value",
        kind: "low-confidence",
        candidates: ["full_body_training"],
      },
      {
        path: "exercises[3].load",
        kind: "unknown",
      },
    ],
  };
}
