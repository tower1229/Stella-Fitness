import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
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
    await advanceToInitial12RM(harness);
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
    await expect(harness.recordInitial12RM({
      ...input,
      confirmationId: "00000000-0000-4000-8000-000000000016",
      valueKg: 34,
      source: { ...input.source, text: "高脚杯深蹲 12RM 34 kg" },
    })).rejects.toThrow("already recorded for goblet-squat");
    await expect(
      harness.recordInitial12RM({ ...input, valueKg: 34 }),
    ).rejects.toThrow("confirmation ID was reused for different facts");
    unlinkSync(join(
      root,
      "personal",
      "observations",
      "special-session",
      `${first.id}.json`,
    ));
    const replacement = await harness.recordInitial12RM({
      ...input,
      confirmationId: "00000000-0000-4000-8000-000000000018",
      source: { ...input.source, text: "高脚杯深蹲 12RM 33 kg after deletion" },
      valueKg: 33,
    });
    expect(replacement.id).not.toBe(first.id);

    const concurrentInput = {
      ...input,
      exerciseId: "dumbbell-bench-press" as const,
      confirmationId: "00000000-0000-4000-8000-000000000011",
      source: { ...input.source, text: "哑铃卧推 12RM 24 kg" },
      valueKg: 24,
    };
    const [left, right] = await Promise.all([
      harness.recordInitial12RM(concurrentInput),
      harness.recordInitial12RM(concurrentInput),
    ]);
    expect(left).toEqual(right);
    expect(
      readdirSync(join(root, "personal", "observations", "special-session"))
        .filter((file) => file.endsWith(".json")),
    ).toHaveLength(2);

    const conflictingInput = {
      ...input,
      exerciseId: "dumbbell-deadlift" as const,
      confirmationId: "00000000-0000-4000-8000-000000000015",
      source: { ...input.source, text: "哑铃硬拉 12RM 40 kg" },
      valueKg: 40,
    };
    const conflicting = await Promise.allSettled([
      harness.recordInitial12RM(conflictingInput),
      harness.recordInitial12RM({
        ...conflictingInput,
        valueKg: 42,
        source: { ...conflictingInput.source, text: "哑铃硬拉 12RM 42 kg" },
      }),
      harness.recordInitial12RM({
        ...conflictingInput,
        confirmationId: "00000000-0000-4000-8000-000000000017",
        valueKg: 44,
        source: { ...conflictingInput.source, text: "哑铃硬拉 12RM 44 kg" },
      }),
    ]);
    expect(conflicting.map(({ status }) => status).sort()).toEqual([
      "fulfilled",
      "rejected",
      "rejected",
    ]);
    expect(
      readdirSync(join(root, "personal", "observations", "special-session"))
        .filter((file) => file.endsWith(".json")),
    ).toHaveLength(3);
  });

  it("fails closed before writes, enforces step order and accepts limited readiness with a Runtime lock", async () => {
    const root = mkdtempSync(join(tmpdir(), "stella-journey-boundaries-"));
    temporaryRoots.push(root);
    const personal = join(root, "personal");
    const runtime = join(root, "runtime");
    mkdirSync(personal, { recursive: true });
    const blocked = createScenarioHarness({
      extractionRuntime: new ControlledExtractionRuntime([]),
      personalDataDirectory: () => personal,
      runtimeDirectory: () => runtime,
      preflight: () => ({
        readiness: "BLOCKED_CONFIGURATION",
        reasons: [{ code: "CONVERSATION_ACCESS_REQUIRED", message: "blocked" }],
      }),
    });
    await expect(blocked.acknowledgePrerequisite({
      prerequisiteId: "adjustable-dumbbells",
      acknowledgedAt: "2026-08-11T00:00:00.000Z",
      source: { kind: "user-text", text: "ready" },
    })).rejects.toThrow("BLOCKED_CONFIGURATION");
    expect(readdirSync(personal)).toEqual([]);

    const limited = createScenarioHarness({
      extractionRuntime: new ControlledExtractionRuntime([]),
      personalDataDirectory: () => personal,
      runtimeDirectory: () => runtime,
      preflight: () => ({
        readiness: "READY_WITH_LIMITED_CAPABILITIES",
        reasons: [{ code: "STRUCTURED_MEDIA_REQUIRED", message: "media unavailable" }],
      }),
    });
    await expect(limited.programJourneyStatus()).resolves.toMatchObject({
      state: "PREREQUISITES_REQUIRED",
    });
    await expect(limited.recordInitial12RM({
      exerciseId: "goblet-squat",
      valueKg: 32,
      confirmationId: "00000000-0000-4000-8000-000000000012",
      occurredAt: "2026-08-11T04:00:00.000Z",
      recordedAt: "2026-08-11T04:01:00.000Z",
      source: { kind: "user-text", text: "too early" },
    })).rejects.toThrow("unavailable in PREREQUISITES_REQUIRED");
    await expect(limited.acknowledgePrerequisite({
      prerequisiteId: "adjustable-dumbbells",
      acknowledgedAt: "2026-08-11T00:00:00.000Z",
      source: { kind: "user-text", text: "ready" },
    })).resolves.toMatchObject({ state: "PREREQUISITES_REQUIRED" });
    expect(existsSync(join(runtime, "program-setup-lock.sqlite"))).toBe(true);
    expect(existsSync(join(root, "personal", "program", "setup.lock"))).toBe(false);
  });

  it("serializes the baseline gate so concurrent different facts cannot both commit", async () => {
    const root = mkdtempSync(join(tmpdir(), "stella-journey-baseline-race-"));
    temporaryRoots.push(root);
    const harness = journeyHarness(root);
    for (const [index, prerequisiteId] of [
      "adjustable-dumbbells",
      "pull-up-bar",
      "printed-workout-log",
    ].entries()) {
      await harness.acknowledgePrerequisite({
        prerequisiteId,
        acknowledgedAt: `2026-08-11T0${index}:00:00.000Z`,
        source: { kind: "user-text", text: prerequisiteId },
      });
    }
    const results = await Promise.allSettled([
      harness.recordJourneyBodyWeight({
        role: "baseline",
        text: "68.4 kg",
        receivedAt: "2026-08-11T03:00:00.000Z",
        source: { messageId: "baseline-a" },
      }),
      harness.recordJourneyBodyWeight({
        role: "baseline",
        text: "68.6 kg",
        receivedAt: "2026-08-11T03:00:01.000Z",
        source: { messageId: "baseline-b" },
      }),
    ]);
    expect(results.map(({ status }) => status).sort()).toEqual([
      "fulfilled",
      "rejected",
    ]);
    expect(
      readdirSync(join(root, "personal", "observations", "body-weight"))
        .filter((file) => file.endsWith(".json")),
    ).toHaveLength(1);
  });

  it("rejects schema-invalid nested setup and cross-exercise 12RM references", async () => {
    const root = mkdtempSync(join(tmpdir(), "stella-journey-schema-"));
    temporaryRoots.push(root);
    const harness = journeyHarness(root);
    await harness.programJourneyStatus();
    const setupPath = join(root, "personal", "program", "setup.json");
    const setup = JSON.parse(readFileSync(setupPath, "utf8"));
    setup.prerequisiteAcknowledgements["adjustable-dumbbells"] = true;
    writeFileSync(setupPath, `${JSON.stringify(setup)}\n`);
    await expect(harness.programJourneyStatus()).rejects.toThrow(
      "Program Setup is schema-invalid",
    );

    rmSync(root, { recursive: true, force: true });
    mkdirSync(root, { recursive: true });
    const swappedHarness = journeyHarness(root);
    await advanceToInitial12RM(swappedHarness);
    const first = await swappedHarness.recordInitial12RM(initial12RMInput(
      "goblet-squat",
      32,
      "00000000-0000-4000-8000-000000000013",
    ));
    const second = await swappedHarness.recordInitial12RM(initial12RMInput(
      "dumbbell-bench-press",
      24,
      "00000000-0000-4000-8000-000000000014",
    ));
    const swappedSetup = JSON.parse(readFileSync(setupPath, "utf8"));
    swappedSetup.initial12RMObservationIds["goblet-squat"] = second.id;
    swappedSetup.initial12RMObservationIds["dumbbell-bench-press"] = first.id;
    writeFileSync(setupPath, `${JSON.stringify(swappedSetup)}\n`);
    await expect(swappedHarness.programJourneyStatus()).resolves.toMatchObject({
      state: "INITIAL_12RM_REQUIRED",
      missingInitial12RMExerciseIds: expect.arrayContaining([
        "goblet-squat",
        "dumbbell-bench-press",
      ]),
    });

    const invalidObservationPath = join(
      root,
      "personal",
      "observations",
      "special-session",
      `${first.id}.json`,
    );
    writeFileSync(invalidObservationPath, "{}\n");
    await expect(swappedHarness.programJourneyStatus()).resolves.toMatchObject({
      errors: [
        expect.objectContaining({
          file: expect.stringContaining(`${first.id}.json`),
          message: "Course-start 12RM Observation is schema-invalid",
        }),
      ],
    });
    await expect(swappedHarness.recordInitial12RM(initial12RMInput(
      "dumbbell-bench-press",
      25,
      "00000000-0000-4000-8000-000000000019",
    ))).resolves.toMatchObject({
      exerciseId: "dumbbell-bench-press",
      result: { value: 25 },
    });
  });
});

function journeyHarness(root: string) {
  return createScenarioHarness({
    extractionRuntime: new ControlledExtractionRuntime([]),
    personalDataDirectory: () => join(root, "personal"),
    runtimeDirectory: () => join(root, "runtime"),
    preflight: () => ({ readiness: "READY_FOR_SETUP", reasons: [] }),
  });
}

async function advanceToInitial12RM(
  harness: ReturnType<typeof journeyHarness>,
): Promise<void> {
  for (const [index, prerequisiteId] of [
    "adjustable-dumbbells",
    "pull-up-bar",
    "printed-workout-log",
  ].entries()) {
    await harness.acknowledgePrerequisite({
      prerequisiteId,
      acknowledgedAt: `2026-08-11T0${index}:00:00.000Z`,
      source: { kind: "user-text", text: prerequisiteId },
    });
  }
  await harness.recordJourneyBodyWeight({
    role: "baseline",
    text: "68.4 kg",
    receivedAt: "2026-08-11T03:00:00.000Z",
  });
}

function initial12RMInput(
  exerciseId: "goblet-squat" | "dumbbell-bench-press" | "dumbbell-deadlift",
  valueKg: number,
  confirmationId: string,
) {
  return {
    exerciseId,
    valueKg,
    confirmationId,
    occurredAt: "2026-08-11T04:00:00.000Z",
    recordedAt: "2026-08-11T04:01:00.000Z",
    source: { kind: "user-text" as const, text: `${exerciseId} ${valueKg} kg` },
  };
}
