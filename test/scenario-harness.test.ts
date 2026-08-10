import { describe, expect, it } from "vitest";

import {
  ControlledExtractionRuntime,
  createScenarioHarness,
} from "../src/scenario/harness.js";

describe("scenario-level Plugin harness", () => {
  it("injects a controlled extraction result without a live provider", async () => {
    const runtime = new ControlledExtractionRuntime([
      {
        parsed: { stage: 1, week: 1, weekday: "monday", exercises: [] },
        metadata: {
          provider: "controlled",
          model: "fixture-v1",
          contentType: "json",
        },
      },
    ]);
    const harness = createScenarioHarness({ extractionRuntime: runtime });

    const output = await harness.extract({
      image: Buffer.from("fixture-image"),
      fileName: "workout.jpg",
      mime: "image/jpeg",
      timeoutMs: 2_000,
    });

    expect(output).toEqual({
      status: "candidate",
      candidate: { stage: 1, week: 1, weekday: "monday", exercises: [] },
      execution: {
        provider: "controlled",
        model: "fixture-v1",
        contentType: "json",
      },
    });
    expect(runtime.requests).toEqual([
      expect.objectContaining({
        fileName: "workout.jpg",
        mime: "image/jpeg",
        timeoutMs: 2_000,
        signal: expect.any(AbortSignal),
      }),
    ]);
  });

  it("rejects cancellation and never emits a candidate", async () => {
    const runtime = new ControlledExtractionRuntime([], { pending: true });
    const harness = createScenarioHarness({ extractionRuntime: runtime });
    const controller = new AbortController();
    controller.abort("user-cancelled");

    await expect(
      harness.extract({
        image: Buffer.from("fixture-image"),
        fileName: "workout.jpg",
        mime: "image/jpeg",
        timeoutMs: 2_000,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("rejects when cancellation arrives while controlled extraction is pending", async () => {
    const runtime = new ControlledExtractionRuntime([], { pending: true });
    const harness = createScenarioHarness({ extractionRuntime: runtime });
    const controller = new AbortController();
    const extraction = harness.extract({
      image: Buffer.from("fixture-image"),
      fileName: "workout.jpg",
      mime: "image/jpeg",
      timeoutMs: 2_000,
      signal: controller.signal,
    });

    controller.abort("user-cancelled");

    await expect(extraction).rejects.toMatchObject({ name: "AbortError" });
  });
});
