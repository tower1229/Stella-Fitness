import { mkdtempSync, rmSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  ControlledExtractionRuntime,
  createScenarioHarness,
} from "../src/scenario/harness.js";

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("Program Journey", () => {
  it("activates the Built-in Program only after prerequisites, baseline and three per-exercise 12RM facts", async () => {
    const root = mkdtempSync(join(tmpdir(), "stella-journey-"));
    temporaryRoots.push(root);
    const harness = createScenarioHarness({
      extractionRuntime: new ControlledExtractionRuntime([]),
      personalDataDirectory: () => join(root, "personal"),
      runtimeDirectory: () => join(root, "runtime"),
      preflight: () => ({ readiness: "READY_FOR_SETUP", reasons: [] }),
    });

    await expect(harness.programJourneyStatus()).resolves.toMatchObject({
      state: "PREREQUISITES_REQUIRED",
      program: { id: "zhuoshu-12-week", version: "0.2.0" },
      nextStep: { code: "ACKNOWLEDGE_PREREQUISITE" },
      missingPrerequisiteIds: [
        "adjustable-dumbbells",
        "pull-up-bar",
        "printed-workout-log",
      ],
    });

    for (const [index, prerequisiteId] of [
      "adjustable-dumbbells",
      "pull-up-bar",
      "printed-workout-log",
    ].entries()) {
      await harness.acknowledgePrerequisite({
        prerequisiteId,
        acknowledgedAt: `2026-08-11T0${index}:00:00.000Z`,
        source: {
          kind: "user-text",
          text: `已准备 ${prerequisiteId}`,
          channel: "test",
          messageId: `prerequisite-${index}`,
        },
      });
    }
    await expect(harness.programJourneyStatus()).resolves.toMatchObject({
      state: "BASELINE_WEIGHT_REQUIRED",
      nextStep: { code: "RECORD_BASELINE_WEIGHT" },
    });

    const baseline = await harness.recordJourneyBodyWeight({
      role: "baseline",
      text: "今天体重 68.4 kg",
      receivedAt: "2026-08-11T03:00:00.000Z",
      source: { channel: "test", messageId: "baseline-1" },
    });
    expect(baseline).toMatchObject({ status: "recorded", role: "baseline" });
    await expect(harness.programJourneyStatus()).resolves.toMatchObject({
      state: "INITIAL_12RM_REQUIRED",
      missingInitial12RMExerciseIds: [
        "goblet-squat",
        "dumbbell-bench-press",
        "dumbbell-deadlift",
      ],
    });

    const inputs = [
      ["goblet-squat", 32],
      ["dumbbell-bench-press", 24],
      ["dumbbell-deadlift", 40],
    ] as const;
    for (const [index, [exerciseId, valueKg]] of inputs.entries()) {
      await harness.recordInitial12RM({
        exerciseId,
        valueKg,
        confirmationId: `00000000-0000-4000-8000-00000000000${index}`,
        occurredAt: "2026-08-11T04:00:00.000Z",
        recordedAt: "2026-08-11T04:01:00.000Z",
        source: {
          kind: "user-text",
          text: `${exerciseId} 12RM ${valueKg} kg`,
          channel: "test",
          messageId: `12rm-${index}`,
        },
      });
    }
    await expect(harness.programJourneyStatus()).resolves.toMatchObject({
      state: "READY_TO_ACTIVATE",
      nextStep: { code: "CONFIRM_CYCLE_START" },
    });

    await expect(harness.activateProgram("2026-08-12")).rejects.toThrow(
      "Cycle start must be a Monday",
    );
    const active = await harness.activateProgram("2026-08-10");
    expect(active).toMatchObject({
      symbolicLoadBindings: {
        "goblet-squat": { A: { value: 32, unit: "kg" } },
        "dumbbell-bench-press": { A: { value: 24, unit: "kg" } },
        "dumbbell-deadlift": { A: { value: 40, unit: "kg" } },
      },
    });
    await expect(harness.activateProgram("2026-08-10")).resolves.toEqual(active);
    await expect(
      harness.recordInitial12RM({
        exerciseId: "goblet-squat",
        valueKg: 34,
        confirmationId: "00000000-0000-4000-8000-000000000099",
        occurredAt: "2026-08-11T06:00:00.000Z",
        recordedAt: "2026-08-11T06:01:00.000Z",
        source: { kind: "user-text", text: "goblet-squat 34 kg" },
      }),
    ).rejects.toThrow("cannot change after activation");
    await expect(harness.programJourneyStatus({ date: "2026-08-11" })).resolves
      .toMatchObject({ state: "ACTIVE", nextStep: { code: "VIEW_TODAY" } });

    await harness.shutdown();
    const restarted = createScenarioHarness({
      extractionRuntime: new ControlledExtractionRuntime([]),
      personalDataDirectory: () => join(root, "personal"),
      runtimeDirectory: () => join(root, "runtime-restarted"),
      preflight: () => ({ readiness: "READY_FOR_SETUP", reasons: [] }),
    });
    await expect(restarted.programJourneyStatus({ date: "2026-08-11" })).resolves
      .toMatchObject({ state: "ACTIVE" });
    if (baseline.status !== "recorded") {
      throw new Error("Expected recorded baseline");
    }
    const correction = await restarted.correctBodyWeight({
      replacesObservationId: baseline.observation.id,
      text: "2026-08-10T03:00:00Z 纠正体重为 68.8 kg",
      receivedAt: "2026-08-11T05:00:00.000Z",
      source: { channel: "test", messageId: "baseline-correction" },
    });
    expect(correction.status).toBe("recorded");
    await expect(restarted.programJourneyStatus({ date: "2026-08-11" })).resolves
      .toMatchObject({ state: "ACTIVE" });
    if (correction.status !== "recorded") {
      throw new Error("Expected recorded correction");
    }
    unlinkSync(
      join(
        root,
        "personal",
        "observations",
        "body-weight",
        `${correction.observation.id}.json`,
      ),
    );
    unlinkSync(
      join(
        root,
        "personal",
        "observations",
        "body-weight",
        `${baseline.observation.id}.json`,
      ),
    );
    await expect(restarted.programJourneyStatus({ date: "2026-08-11" })).resolves
      .toMatchObject({ state: "BASELINE_WEIGHT_REQUIRED" });
    await restarted.shutdown();
  });

  it("persists confirmation identity and fails closed when it is reused with another 12RM value", async () => {
    const root = mkdtempSync(join(tmpdir(), "stella-journey-dedupe-"));
    temporaryRoots.push(root);
    const harness = createScenarioHarness({
      extractionRuntime: new ControlledExtractionRuntime([]),
      personalDataDirectory: () => join(root, "personal"),
      runtimeDirectory: () => join(root, "runtime"),
      preflight: () => ({ readiness: "READY_FOR_SETUP", reasons: [] }),
    });
    const input = {
      exerciseId: "goblet-squat" as const,
      valueKg: 32,
      confirmationId: "00000000-0000-4000-8000-000000000010",
      occurredAt: "2026-08-11T04:00:00.000Z",
      recordedAt: "2026-08-11T04:01:00.000Z",
      source: {
        kind: "user-text" as const,
        text: "高脚杯深蹲 12RM 32 kg",
        channel: "test",
        messageId: "12rm-dedupe",
      },
    };

    const first = await harness.recordInitial12RM(input);
    await expect(harness.recordInitial12RM(input)).resolves.toEqual(first);
    await expect(
      harness.recordInitial12RM({ ...input, valueKg: 34 }),
    ).rejects.toThrow("confirmation ID was reused for different facts");
  });
});
