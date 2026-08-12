import { mkdtempSync, readFileSync, rmSync } from "node:fs";
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

describe("Program Facts and Printable Log", () => {
  it("answers today and next session from canonical program facts and refuses unsupported advice", async () => {
    const harness = await activeHarness();

    const today = await harness.programFacts({
      kind: "today",
      date: "2026-08-10",
    });
    expect(today).toMatchObject({
      kind: "planned-session-facts",
      relation: "today",
      session: {
        cycle: { week: 1, phase: "phase-1" },
        date: "2026-08-10",
        day: "monday",
      },
    });
    if (today.kind !== "planned-session-facts") {
      throw new Error("Expected planned-session facts");
    }
    expect(today.session.exercises).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          exerciseId: "goblet-squat",
          resolvedLoad: expect.objectContaining({
            symbol: "A",
            value: 32,
            unit: "kg",
          }),
        }),
      ]),
    );
    await expect(
      harness.programFacts({ kind: "next", date: "2026-08-10" }),
    ).resolves.toMatchObject({
      kind: "planned-session-facts",
      relation: "next",
      session: { date: "2026-08-12", day: "wednesday" },
    });
    await expect(
      harness.programFacts({ kind: "unsupported", question: "体重没涨要怎么调整饮食和训练？" }),
    ).resolves.toEqual({
      kind: "unsupported",
      scope:
        "Stella Fitness only reports source-program, Program State and recorded facts; it does not diagnose, advise or adjust the plan.",
    });
  });

  it("generates a persistent A4 PDF with a normal-session table and blank Actual cells", async () => {
    const harness = await activeHarness();

    const result = await harness.printableLog({
      range: "today",
      date: "2026-08-10",
    });
    const pdf = readFileSync(result.path);

    expect(result).toMatchObject({
      range: "today",
      mediaType: "application/pdf",
      layout: "ordinary-training",
    });
    expect(pdf.subarray(0, 8).toString("ascii")).toBe("%PDF-1.4");
    expect(pdf.toString("latin1")).toContain("/MediaBox [0 0 595.28 841.89]");
    expect(pdf.toString("latin1")).toContain("/ActualFieldsBlank true");
    expect(pdf.toString("latin1")).toContain("/Subtype /Image");

    const strengthTest = await harness.printableLog({
      range: "today",
      date: "2026-09-04",
    });
    expect(strengthTest).toMatchObject({
      layout: "strength-test",
      pages: 1,
      mediaType: "application/pdf",
    });
    expect(readFileSync(strengthTest.path).toString("latin1")).toContain(
      "/ActualFieldsBlank true",
    );

    await expect(harness.printableLog({
      range: "week",
      date: "2026-08-10",
    })).resolves.toMatchObject({
      range: "week",
      layout: "ordinary-training",
      pages: 3,
    });
    await expect(harness.printableLog({
      range: "phase",
      date: "2026-08-10",
    })).resolves.toMatchObject({
      range: "phase",
      layout: "mixed",
      pages: 12,
    });
  });

  it("gates Week 5 on a Week 4 checkpoint and rebuilds deterministic weight facts", async () => {
    const harness = await activeHarness();

    await expect(harness.programFacts({ kind: "next", date: "2026-09-06" }))
      .rejects.toThrow("PHASE_CHECKPOINT_REQUIRED");
    await expect(harness.programJourneyStatus({ date: "2026-09-07" })).resolves
      .toMatchObject({
        state: "PHASE_CHECKPOINT_REQUIRED",
        requiredCheckpointWeek: 4,
        nextStep: { code: "RECORD_PHASE_CHECKPOINT" },
      });
    await harness.recordJourneyBodyWeight({
      role: "checkpoint",
      checkpointWeek: 4,
      text: "2026-09-06T12:00:00Z 体重 70.452 kg",
      receivedAt: "2026-09-06T12:00:00.000Z",
      source: { channel: "test", messageId: "checkpoint-4" },
    });

    await expect(harness.programJourneyStatus({ date: "2026-09-07" })).resolves
      .toMatchObject({ state: "ACTIVE" });
    await expect(harness.programFacts({ kind: "next", date: "2026-09-06" }))
      .resolves.toMatchObject({
        kind: "planned-session-facts",
        session: { date: "2026-09-07", cycle: { week: 5 } },
      });
    await expect(harness.programFacts({ kind: "next", date: "2026-10-04" }))
      .rejects.toThrow("PHASE_CHECKPOINT_REQUIRED");
    await harness.recordJourneyBodyWeight({
      role: "checkpoint",
      checkpointWeek: 8,
      text: "2026-10-04T12:00:00Z 体重 71 kg",
      receivedAt: "2026-10-04T12:00:00.000Z",
    });
    await expect(harness.programFacts({ kind: "next", date: "2026-11-02" }))
      .rejects.toThrow("PHASE_CHECKPOINT_REQUIRED");
    await harness.recordJourneyBodyWeight({
      role: "checkpoint",
      checkpointWeek: 12,
      text: "2026-11-01T12:00:00Z 体重 72 kg",
      receivedAt: "2026-11-01T12:00:00.000Z",
    });
    await expect(harness.programFacts({ kind: "next", date: "2026-11-02" }))
      .resolves.toEqual({ kind: "no-session", relation: "next" });
    await expect(harness.weightFacts()).resolves.toMatchObject({
      goal: "gain-weight",
      baseline: { amountKg: 68.4 },
      checkpoints: {
        "4": {
          amountKg: 70.452,
          fromBaseline: {
            changeKg: 2.052,
            changePercent: 3,
            direction: "toward-goal",
          },
          fromPrevious: {
            changeKg: 2.052,
            changePercent: 3,
            direction: "toward-goal",
          },
        },
      },
    });
  });
});

async function activeHarness() {
  const root = mkdtempSync(join(tmpdir(), "stella-facts-"));
  temporaryRoots.push(root);
  const harness = createScenarioHarness({
    extractionRuntime: new ControlledExtractionRuntime([]),
    personalDataDirectory: () => join(root, "personal"),
    runtimeDirectory: () => join(root, "runtime"),
    preflight: () => ({ readiness: "READY_FOR_SETUP", reasons: [] }),
  });
  for (const [index, prerequisiteId] of [
    "adjustable-dumbbells",
    "pull-up-bar",
    "printed-workout-log",
    "recording-protocol",
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
  await harness.recordJourneyBodyWeight({
    role: "baseline",
    text: "2026-08-10T12:00:00Z 体重 68.4 kg",
    receivedAt: "2026-08-10T12:00:00.000Z",
    source: { channel: "test", messageId: "baseline" },
  });
  for (const [index, [exerciseId, valueKg]] of [
    ["goblet-squat", 32],
    ["dumbbell-bench-press", 24],
    ["dumbbell-deadlift", 40],
  ].entries()) {
    await harness.recordInitial12RM({
      exerciseId: exerciseId as
        | "goblet-squat"
        | "dumbbell-bench-press"
        | "dumbbell-deadlift",
      valueKg: valueKg as number,
      confirmationId: `00000000-0000-4000-8000-00000000002${index}`,
      occurredAt: "2026-08-10T04:00:00.000Z",
      recordedAt: "2026-08-10T04:01:00.000Z",
      source: {
        kind: "user-text",
        text: `${exerciseId} 12RM ${valueKg} kg`,
        channel: "test",
        messageId: `12rm-${index}`,
      },
    });
  }
  await harness.activateProgram("2026-08-10");
  return harness;
}
