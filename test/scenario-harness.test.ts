import { describe, expect, it } from "vitest";

import {
  ControlledExtractionRuntime,
  createScenarioHarness,
} from "../src/scenario/harness.js";
import { sanitizedMediaFixture } from "./support/sanitized-media.js";

describe("scenario-level Plugin harness", () => {
  it("injects a controlled extraction result without a live provider", async () => {
    const runtime = new ControlledExtractionRuntime([
      {
        parsed: candidate(),
        metadata: {
          provider: "controlled",
          model: "fixture-v1",
          contentType: "json",
        },
      },
    ]);
    const harness = createScenarioHarness({ extractionRuntime: runtime });

    const output = await harness.extract({
      runId: "scenario-1",
      media: sanitizedFixture(),
      timeoutMs: 2_000,
    });

    expect(output).toEqual({
      status: "candidate",
      candidate: candidate(),
      execution: {
        provider: "controlled",
        model: "fixture-v1",
        contentType: "json",
      },
    });
    expect(runtime.requests).toEqual([
      expect.objectContaining({
        runId: "scenario-1",
        media: expect.objectContaining({
          fileName: "workout.jpg",
          mime: "image/jpeg",
        }),
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
        runId: "scenario-cancelled",
        media: sanitizedFixture(),
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
      runId: "scenario-pending",
      media: sanitizedFixture(),
      timeoutMs: 2_000,
      signal: controller.signal,
    });

    controller.abort("user-cancelled");

    await expect(extraction).rejects.toMatchObject({ name: "AbortError" });
  });

  it("deduplicates repeated run IDs before invoking extraction again", async () => {
    const runtime = new ControlledExtractionRuntime([
      { parsed: candidate(), metadata: { provider: "controlled" } },
    ]);
    const harness = createScenarioHarness({ extractionRuntime: runtime });
    const input = {
      runId: "scenario-idempotent",
      media: sanitizedFixture(),
      timeoutMs: 2_000,
    };

    const first = await harness.extract(input);
    const second = await harness.extract(input);

    expect(second).toEqual(first);
    expect(runtime.requests).toHaveLength(1);
  });

  it("rejects a run ID reused for different sanitized media", async () => {
    const runtime = new ControlledExtractionRuntime([
      { parsed: candidate(), metadata: { provider: "controlled" } },
    ]);
    const harness = createScenarioHarness({ extractionRuntime: runtime });

    await harness.extract({
      runId: "scenario-collision",
      media: sanitizedFixture(),
      timeoutMs: 2_000,
    });
    await expect(
      harness.extract({
        runId: "scenario-collision",
        media: sanitizedMediaFixture(Buffer.from("different-image")),
        timeoutMs: 2_000,
      }),
    ).rejects.toThrow("reused for different media");
    expect(runtime.requests).toHaveLength(1);
  });

  it("applies each caller's cancellation gate to an idempotent run", async () => {
    const runtime = new ControlledExtractionRuntime([], { pending: true });
    const harness = createScenarioHarness({ extractionRuntime: runtime });
    void harness.extract({
      runId: "scenario-shared-pending",
      media: sanitizedFixture(),
      timeoutMs: 2_000,
    });
    const controller = new AbortController();
    controller.abort("second-caller-cancelled");

    await expect(
      harness.extract({
        runId: "scenario-shared-pending",
        media: sanitizedFixture(),
        timeoutMs: 2_000,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(runtime.requests).toHaveLength(1);
  });

  it("rejects schema-invalid controlled output", async () => {
    const runtime = new ControlledExtractionRuntime([
      { parsed: { stage: 1 }, metadata: { provider: "controlled" } },
    ]);
    const harness = createScenarioHarness({ extractionRuntime: runtime });

    await expect(
      harness.extract({
        runId: "scenario-invalid",
        media: sanitizedFixture(),
        timeoutMs: 2_000,
      }),
    ).rejects.toMatchObject({ name: "InvalidWorkoutLogCandidateError" });
  });

  it("preserves conflicts as structured uncertainty instead of choosing a value", async () => {
    const conflict = {
      path: "exercises[0].load",
      kind: "conflict",
      candidates: ["20 kg", "25 kg"],
    } as const;
    const runtime = new ControlledExtractionRuntime([
      {
        parsed: { ...candidate(), uncertainFields: [conflict] },
        metadata: { provider: "controlled" },
      },
    ]);
    const harness = createScenarioHarness({ extractionRuntime: runtime });

    await expect(
      harness.extract({
        runId: "scenario-conflict",
        media: sanitizedFixture(),
        timeoutMs: 2_000,
      }),
    ).resolves.toMatchObject({
      candidate: { uncertainFields: [conflict] },
    });
  });
});

function candidate() {
  return {
    stage: 1,
    week: 1,
    weekday: "monday",
    exercises: [],
    uncertainFields: [],
  };
}

function sanitizedFixture() {
  return sanitizedMediaFixture();
}
