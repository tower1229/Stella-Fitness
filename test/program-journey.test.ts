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
import { rawMediaUploadFixture } from "./support/sanitized-media.js";

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
        "recording-protocol",
      ],
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

  it("keeps baseline and 12RM replacement history while deletion reopens the required gate", async () => {
    const root = mkdtempSync(join(tmpdir(), "stella-journey-replacements-"));
    temporaryRoots.push(root);
    const harness = journeyHarness(root);
    await advanceToInitial12RM(harness);
    const setupPath = join(root, "personal", "program", "setup.json");
    const baselineId = JSON.parse(readFileSync(setupPath, "utf8")).baselineObservationId;

    const correctedBaseline = await harness.correctJourneyBodyWeight({
      replacesObservationId: baselineId,
      text: "纠正体重为 150 lb",
      receivedAt: "2026-08-11T03:30:00.000Z",
      source: { channel: "test", messageId: "baseline-correction" },
    });
    expect(correctedBaseline).toMatchObject({
      status: "recorded",
      observation: {
        value: { amount: 150, unit: "lb" },
        provenance: {
          kind: "body-weight-correction",
          replacesObservationId: baselineId,
        },
      },
    });
    await expect(harness.programJourneyStatus()).resolves.toMatchObject({
      state: "INITIAL_12RM_REQUIRED",
    });

    await harness.deleteJourneyBodyWeight({
      observationId: correctedBaseline.status === "recorded"
        ? correctedBaseline.observation.id
        : "unreachable",
      deletedAt: "2026-08-11T03:40:00.000Z",
      source: {
        kind: "user-text",
        text: "删除这条基线体重",
        channel: "test",
        messageId: "baseline-deletion",
      },
    });
    await expect(harness.programJourneyStatus()).resolves.toMatchObject({
      state: "BASELINE_WEIGHT_REQUIRED",
    });
    expect(
      readdirSync(join(root, "personal", "observations", "body-weight")),
    ).toHaveLength(3);

    await harness.recordJourneyBodyWeight({
      role: "baseline",
      text: "68.8 kg",
      receivedAt: "2026-08-11T03:50:00.000Z",
      source: { channel: "test", messageId: "replacement-baseline" },
    });
    const original12RM = await harness.recordInitial12RM(initial12RMInput(
      "goblet-squat",
      32,
      "00000000-0000-4000-8000-000000000020",
    ));
    const corrected12RM = await harness.correctInitial12RM({
      replacesObservationId: original12RM.id,
      valueKg: 34,
      confirmationId: "00000000-0000-4000-8000-000000000021",
      occurredAt: "2026-08-11T04:00:00.000Z",
      recordedAt: "2026-08-11T04:10:00.000Z",
      source: { kind: "user-text", text: "纠正高脚杯深蹲 12RM 为 34 kg" },
    });
    expect(corrected12RM).toMatchObject({
      exerciseId: "goblet-squat",
      result: { value: 34 },
      provenance: {
        kind: "course-start-12rm-correction",
        replacesObservationId: original12RM.id,
      },
    });
    await expect(harness.programJourneyStatus()).resolves.toMatchObject({
      missingInitial12RMExerciseIds: [
        "dumbbell-bench-press",
        "dumbbell-deadlift",
      ],
    });

    await harness.deleteInitial12RM({
      observationId: corrected12RM.id,
      confirmationId: "00000000-0000-4000-8000-000000000022",
      deletedAt: "2026-08-11T04:20:00.000Z",
      source: { kind: "user-text", text: "删除这条高脚杯深蹲 12RM" },
    });
    await expect(harness.programJourneyStatus()).resolves.toMatchObject({
      state: "INITIAL_12RM_REQUIRED",
      missingInitial12RMExerciseIds: [
        "goblet-squat",
        "dumbbell-bench-press",
        "dumbbell-deadlift",
      ],
    });
    expect(
      readdirSync(join(root, "personal", "observations", "special-session")),
    ).toHaveLength(3);
  });

  it("rebuilds checkpoint and current Weight Facts after correction and deletion", async () => {
    const root = mkdtempSync(join(tmpdir(), "stella-journey-checkpoint-facts-"));
    temporaryRoots.push(root);
    const harness = journeyHarness(root);
    await activateJourney(harness);

    const week4 = await harness.recordJourneyBodyWeight({
      role: "checkpoint",
      checkpointWeek: 4,
      text: "体重 69 kg",
      receivedAt: "2026-09-07T08:00:00.000Z",
      source: { channel: "test", messageId: "week-4-weight" },
    });
    if (week4.status !== "recorded") {
      throw new Error("Expected Week 4 checkpoint");
    }
    await expect(harness.recordJourneyBodyWeight({
      role: "checkpoint",
      checkpointWeek: 4,
      text: "体重 69 kg",
      receivedAt: "2026-09-07T08:00:00.000Z",
      source: { channel: "test", messageId: "week-4-weight" },
    })).resolves.toEqual(week4);
    const current = await harness.recordBodyWeight({
      text: "体重 70 kg",
      receivedAt: "2026-09-08T08:00:00.000Z",
      source: { channel: "test", messageId: "current-weight" },
    });

    await expect(harness.weightFacts()).resolves.toMatchObject({
      baseline: { amountKg: 68.4 },
      current: { amountKg: 70 },
      checkpoints: {
        "4": {
          amountKg: 69,
          fromBaseline: {
            changeKg: 0.6,
            changePercent: 0.877193,
            direction: "toward-goal",
          },
          fromPrevious: {
            changeKg: 0.6,
            direction: "toward-goal",
          },
        },
      },
    });

    const corrected = await harness.correctJourneyBodyWeight({
      replacesObservationId: week4.observation.id,
      text: "纠正为 68.4 kg",
      receivedAt: "2026-12-01T09:00:00.000Z",
      source: { channel: "test", messageId: "week-4-weight-correction" },
    });
    expect(corrected).toMatchObject({
      status: "recorded",
      role: "checkpoint",
      checkpointWeek: 4,
    });
    await expect(harness.weightFacts()).resolves.toMatchObject({
      checkpoints: {
        "4": {
          amountKg: 68.4,
          fromBaseline: {
            changeKg: 0,
            changePercent: 0,
            direction: "unchanged",
          },
        },
      },
    });
    if (corrected.status !== "recorded") {
      throw new Error("Expected checkpoint correction");
    }
    await harness.deleteJourneyBodyWeight({
      observationId: corrected.observation.id,
      deletedAt: "2026-12-01T10:00:00.000Z",
      source: {
        kind: "user-text",
        text: "删除第 4 周 checkpoint",
        channel: "test",
        messageId: "week-4-weight-deletion",
      },
    });
    await expect(harness.programJourneyStatus({ date: "2026-09-07" })).resolves
      .toMatchObject({ state: "PHASE_CHECKPOINT_REQUIRED", requiredCheckpointWeek: 4 });
    await expect(harness.weightFacts()).resolves.toMatchObject({
      current: { amountKg: 70 },
      checkpoints: {},
    });
    if (current.status !== "recorded") throw new Error("Expected current weight");
    writeFileSync(join(
      root,
      "personal",
      "observations",
      "body-weight",
      `${current.observation.id}.json`,
    ), "{}\n");
    await expect(harness.weightFacts()).resolves.toMatchObject({
      errors: [expect.objectContaining({
        file: expect.stringContaining(`${current.observation.id}.json`),
        message: "Body-weight Observation is schema-invalid",
      })],
    });
  });

  it("does not compare a later checkpoint across a missing previous phase", async () => {
    const root = mkdtempSync(join(tmpdir(), "stella-journey-missing-checkpoint-"));
    temporaryRoots.push(root);
    const harness = journeyHarness(root);
    await activateJourney(harness);
    const statePath = join(root, "personal", "program", "state.json");

    const week4 = await harness.recordJourneyBodyWeight({
      role: "checkpoint",
      checkpointWeek: 4,
      text: "69 kg",
      receivedAt: "2026-09-07T08:00:00.000Z",
      source: { messageId: "week-4" },
    });
    if (week4.status !== "recorded") throw new Error("Expected Week 4 checkpoint");
    const week8 = await harness.recordJourneyBodyWeight({
      role: "checkpoint",
      checkpointWeek: 8,
      text: "70 kg",
      receivedAt: "2026-10-05T08:00:00.000Z",
      source: { messageId: "week-8" },
    });
    if (week8.status !== "recorded") throw new Error("Expected Week 8 checkpoint");
    const state = JSON.parse(readFileSync(statePath, "utf8"));
    delete state.phaseCheckpointObservationIds["4"];
    writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);

    await expect(harness.weightFacts()).resolves.toMatchObject({
      checkpoints: {
        "8": {
          fromPrevious: { direction: "insufficient-data" },
        },
      },
    });
  });

  it("migrates legacy checkpoint references into Program State on restart", async () => {
    const root = mkdtempSync(join(tmpdir(), "stella-journey-checkpoint-migration-"));
    temporaryRoots.push(root);
    const first = journeyHarness(root);
    await activateJourney(first);
    const week4 = await first.recordJourneyBodyWeight({
      role: "checkpoint",
      checkpointWeek: 4,
      text: "69 kg",
      receivedAt: "2026-09-07T08:00:00.000Z",
      source: { messageId: "legacy-week-4" },
    });
    if (week4.status !== "recorded") throw new Error("Expected Week 4 checkpoint");

    const setupPath = join(root, "personal", "program", "setup.json");
    const statePath = join(root, "personal", "program", "state.json");
    const setup = JSON.parse(readFileSync(setupPath, "utf8"));
    const state = JSON.parse(readFileSync(statePath, "utf8"));
    setup.checkpointObservationIds = { "4": week4.observation.id };
    delete state.phaseCheckpointObservationIds;
    writeFileSync(setupPath, `${JSON.stringify(setup, null, 2)}\n`);
    writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
    await first.shutdown();

    const restarted = journeyHarness(root);
    await expect(restarted.programJourneyStatus({ date: "2026-09-07" })).resolves
      .toMatchObject({ state: "ACTIVE" });
    expect(JSON.parse(readFileSync(statePath, "utf8"))).toMatchObject({
      phaseCheckpointObservationIds: { "4": week4.observation.id },
    });
  });

  it("fails closed for a schema-invalid checkpoint reference in Program State", async () => {
    const root = mkdtempSync(join(tmpdir(), "stella-journey-invalid-checkpoint-ref-"));
    temporaryRoots.push(root);
    const harness = journeyHarness(root);
    await activateJourney(harness);
    const statePath = join(root, "personal", "program", "state.json");
    const state = JSON.parse(readFileSync(statePath, "utf8"));
    state.phaseCheckpointObservationIds = { "4": "bad" };
    writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);

    await expect(harness.programJourneyStatus({ date: "2026-09-07" })).rejects.toThrow(
      "Program State is schema-invalid",
    );
  });

  it("persists an ambiguous checkpoint confirmation across restart", async () => {
    const root = mkdtempSync(join(tmpdir(), "stella-journey-checkpoint-confirmation-"));
    temporaryRoots.push(root);
    const first = journeyHarness(root);
    await activateJourney(first);

    const pending = await first.submitProgramJourneyText({
      text: "昨天体重 69 kg",
      receivedAt: "2026-09-07T08:00:00.000Z",
      source: { channel: "test", messageId: "ambiguous-week-4" },
    });
    expect(pending).toMatchObject({
      status: "confirmation",
      kind: "checkpoint-body-weight",
      checkpointWeek: 4,
      fields: [{ path: "occurredAt" }],
    });
    if (pending.status !== "confirmation") {
      throw new Error("Expected checkpoint confirmation");
    }
    await first.shutdown();

    const restarted = journeyHarness(root);
    await expect(restarted.confirmProgramJourneyCandidate({
      confirmationId: pending.confirmationId,
      values: { occurredAt: "2026-09-07T08:00:00.000Z" },
      confirmedAt: "2026-09-07T08:05:00.000Z",
      source: {
        kind: "user-text",
        text: "/stella-confirm occurredAt=2026-09-07T08:00:00.000Z",
        channel: "test",
        messageId: "confirm-week-4",
      },
    })).resolves.toMatchObject({
      status: "recorded",
      kind: "checkpoint-body-weight",
      checkpointWeek: 4,
      observation: { value: { amount: 69, unit: "kg" } },
    });
    await expect(restarted.programJourneyStatus({ date: "2026-09-07" })).resolves
      .toMatchObject({ state: "ACTIVE" });
  });

  it("rejects a body-weight fact from before the corresponding checkpoint window", async () => {
    const root = mkdtempSync(join(tmpdir(), "stella-journey-old-checkpoint-"));
    temporaryRoots.push(root);
    const harness = journeyHarness(root);
    await activateJourney(harness);
    await expect(harness.recordJourneyBodyWeight({
      role: "checkpoint",
      checkpointWeek: 4,
      text: "2026-08-10T08:00:00Z 体重 69 kg",
      receivedAt: "2026-09-07T08:00:00.000Z",
      source: { messageId: "old-week-4-weight" },
    })).rejects.toThrow("does not belong to the Week 4 checkpoint");
  });

  it("blocks cycle-completion retest confirmation until the Week 12 checkpoint exists", async () => {
    const root = mkdtempSync(join(tmpdir(), "stella-journey-cycle-completion-gate-"));
    temporaryRoots.push(root);
    const onboarding = journeyHarness(root);
    await activateJourney(onboarding);
    await onboarding.shutdown();
    const candidate = endOfCycleRetestCandidate();
    const harness = createScenarioHarness({
      extractionRuntime: new ControlledExtractionRuntime([
        { parsed: candidate, metadata: { provider: "controlled" } },
      ]),
      personalDataDirectory: () => join(root, "personal"),
      runtimeDirectory: () => join(root, "runtime-retest"),
      preflight: () => ({ readiness: "READY", reasons: [] }),
    });
    const pending = await harness.ingestWorkoutLog({
      runId: "cycle-completion-before-checkpoint",
      upload: rawMediaUploadFixture(),
      timeoutMs: 2_000,
    });
    if (pending.status !== "confirmation") {
      throw new Error("Expected cycle-completion confirmation");
    }
    const values = Object.fromEntries(candidate.testResults.map((result, index) => [
      `testResults[${index}].result.value`,
      result.result.value,
    ]));

    await expect(harness.confirmWorkoutLog({
      confirmationId: pending.confirmationId,
      values,
    })).rejects.toThrow("PHASE_CHECKPOINT_REQUIRED");
    expect(
      readdirSync(join(root, "personal", "observations", "workout-log")),
    ).toEqual([]);

    for (const [week, value] of [[4, 69], [8, 70], [12, 71]] as const) {
      await harness.recordJourneyBodyWeight({
        role: "checkpoint",
        checkpointWeek: week,
        text: `${value} kg`,
        receivedAt: new Date(
          Date.parse("2026-08-10T08:00:00.000Z") + week * 604_800_000,
        ).toISOString(),
        source: { messageId: `checkpoint-${week}` },
      });
    }
    await expect(harness.confirmWorkoutLog({
      confirmationId: pending.confirmationId,
      values,
    })).resolves.toMatchObject({
      status: "recorded",
      programState: {
        nextCycle: {
          symbolicLoadBindings: {
            "goblet-squat": { A: { value: 36 } },
            "dumbbell-bench-press": { A: { value: 28 } },
            "dumbbell-deadlift": { A: { value: 44 } },
          },
        },
      },
    });
  });

  it("persists ambiguous text candidates and confirmation outcomes across restart", async () => {
    const root = mkdtempSync(join(tmpdir(), "stella-journey-confirmations-"));
    temporaryRoots.push(root);
    const first = journeyHarness(root);
    for (const [index, prerequisiteId] of [
      "adjustable-dumbbells",
      "pull-up-bar",
      "printed-workout-log",
      "recording-protocol",
    ].entries()) {
      await first.acknowledgePrerequisite({
        prerequisiteId,
        acknowledgedAt: `2026-08-11T0${index}:00:00.000Z`,
        source: { kind: "user-text", text: prerequisiteId },
      });
    }

    const pendingBaseline = await first.submitProgramJourneyText({
      text: "体重 150",
      receivedAt: "2026-08-11T03:00:00.000Z",
      source: { channel: "test", messageId: "ambiguous-baseline" },
    });
    expect(pendingBaseline).toMatchObject({
      status: "confirmation",
      kind: "baseline-body-weight",
      fields: [{ path: "unit" }],
      confirmationId: expect.stringMatching(/^[0-9a-f-]{36}$/u),
    });
    await expect(first.submitProgramJourneyText({
      text: "体重",
      receivedAt: "2026-08-11T03:01:00.000Z",
      source: { channel: "test", messageId: "missing-baseline-fields" },
    })).resolves.toMatchObject({
      status: "confirmation",
      fields: [{ path: "amount" }, { path: "unit" }],
    });
    expect(existsSync(join(
      root,
      "personal",
      "program",
      "pending-confirmations",
      `${pendingBaseline.status === "confirmation" ? pendingBaseline.confirmationId : "unreachable"}.json`,
    ))).toBe(true);
    await expect(first.programJourneyStatus()).resolves.toMatchObject({
      state: "BASELINE_WEIGHT_REQUIRED",
    });
    await first.shutdown();

    const restarted = journeyHarness(root);
    if (pendingBaseline.status !== "confirmation") {
      throw new Error("Expected a pending baseline confirmation");
    }
    const baseline = await restarted.confirmProgramJourneyCandidate({
      confirmationId: pendingBaseline.confirmationId,
      values: { unit: "lb" },
      confirmedAt: "2026-08-11T03:05:00.000Z",
      source: { kind: "user-text", text: "/stella-confirm baseline", channel: "test", messageId: "confirm-baseline" },
    });
    expect(baseline).toMatchObject({ status: "recorded", kind: "baseline-body-weight" });
    const persistedBaselineConfirmation = JSON.parse(readFileSync(join(
      root,
      "personal",
      "program",
      "pending-confirmations",
      `${pendingBaseline.confirmationId}.json`,
    ), "utf8"));
    expect(persistedBaselineConfirmation.resolution).toMatchObject({
      values: { unit: "lb" },
      source: {
        channel: "test",
        messageId: "confirm-baseline",
      },
    });
    await expect(restarted.programJourneyStatus()).resolves.toMatchObject({
      state: "INITIAL_12RM_REQUIRED",
    });

    const pending12RM = await restarted.submitProgramJourneyText({
      text: "高脚杯深蹲 12RM 32 或 34 kg",
      receivedAt: "2026-08-11T04:00:00.000Z",
      source: { channel: "test", messageId: "ambiguous-12rm" },
    });
    expect(pending12RM).toMatchObject({
      status: "confirmation",
      kind: "course-start-12rm",
      fields: [{ path: "valueKg" }],
    });
    if (pending12RM.status !== "confirmation") {
      throw new Error("Expected a pending 12RM confirmation");
    }
    const confirmed12RM = await restarted.confirmProgramJourneyCandidate({
      confirmationId: pending12RM.confirmationId,
      values: { valueKg: 34 },
      confirmedAt: "2026-08-11T04:05:00.000Z",
      source: { kind: "user-text", text: "/stella-confirm 34", channel: "test", messageId: "confirm-12rm" },
    });
    expect(confirmed12RM).toMatchObject({
      status: "recorded",
      kind: "course-start-12rm",
      observation: { exerciseId: "goblet-squat", result: { value: 34 } },
    });
    const concurrent = await Promise.allSettled([
      restarted.confirmProgramJourneyCandidate({
        confirmationId: pending12RM.confirmationId,
        values: { valueKg: 34 },
        confirmedAt: "2026-08-11T04:05:00.000Z",
        source: { kind: "user-text", text: "/stella-confirm 34", channel: "test", messageId: "confirm-12rm" },
      }),
      restarted.confirmProgramJourneyCandidate({
        confirmationId: pending12RM.confirmationId,
        values: { valueKg: 35 },
        confirmedAt: "2026-08-11T04:05:01.000Z",
        source: { kind: "user-text", text: "/stella-confirm 35", channel: "test", messageId: "confirm-12rm-conflict" },
      }),
    ]);
    expect(concurrent.map(({ status }) => status).sort()).toEqual([
      "fulfilled",
      "rejected",
    ]);
    await expect(restarted.confirmProgramJourneyCandidate({
      confirmationId: pending12RM.confirmationId,
      values: { valueKg: 35 },
      confirmedAt: "2026-08-11T04:06:00.000Z",
      source: { kind: "user-text", text: "/stella-confirm 35", channel: "test", messageId: "confirm-12rm-conflict-2" },
    })).rejects.toThrow("confirmation ID was reused with different values");
    await restarted.shutdown();

    const afterSecondRestart = journeyHarness(root);
    await expect(afterSecondRestart.confirmProgramJourneyCandidate({
      confirmationId: pending12RM.confirmationId,
      values: { valueKg: 34 },
      confirmedAt: "2026-08-11T04:07:00.000Z",
      source: { kind: "user-text", text: "/stella-confirm 34", channel: "test", messageId: "confirm-12rm-retry" },
    })).resolves.toEqual(confirmed12RM);

    const ambiguousTime = await afterSecondRestart.submitProgramJourneyText({
      text: "昨天哑铃卧推 12RM 24 kg",
      receivedAt: "2026-08-11T05:00:00.000Z",
      source: { channel: "test", messageId: "ambiguous-12rm-time" },
    });
    expect(ambiguousTime).toMatchObject({
      status: "confirmation",
      fields: [{ path: "occurredAt" }],
    });
    if (ambiguousTime.status !== "confirmation") {
      throw new Error("Expected an ambiguous-time confirmation");
    }
    await afterSecondRestart.recordInitial12RM(initial12RMInput(
      "dumbbell-bench-press",
      24,
      "00000000-0000-4000-8000-000000000023",
    ));
    await expect(afterSecondRestart.confirmProgramJourneyCandidate({
      confirmationId: ambiguousTime.confirmationId,
      values: { occurredAt: "2026-08-10T05:00:00.000Z" },
      confirmedAt: "2026-08-11T05:05:00.000Z",
      source: { kind: "user-text", text: "/stella-confirm stale", channel: "test", messageId: "confirm-stale" },
    })).rejects.toThrow("already recorded for dumbbell-bench-press");
  });

  it("fails closed when one prerequisite message identity is reused for another fact", async () => {
    const root = mkdtempSync(join(tmpdir(), "stella-prerequisite-identity-"));
    temporaryRoots.push(root);
    const harness = journeyHarness(root);
    const source = {
      kind: "user-text" as const,
      text: "我已准备好可拆卸哑铃",
      channel: "test",
      messageId: "same-message",
    };
    await harness.acknowledgePrerequisite({
      prerequisiteId: "adjustable-dumbbells",
      acknowledgedAt: "2026-08-12T00:00:00.000Z",
      source,
    });

    await expect(harness.acknowledgePrerequisite({
      prerequisiteId: "pull-up-bar",
      acknowledgedAt: "2026-08-12T01:00:00.000Z",
      source: { ...source, text: "我已准备好引体向上杆" },
    })).rejects.toThrow("idempotency key was reused for another prerequisite");
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
      "recording-protocol",
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
    "recording-protocol",
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

async function activateJourney(
  harness: ReturnType<typeof journeyHarness>,
): Promise<void> {
  await advanceToInitial12RM(harness);
  for (const [index, [exerciseId, valueKg]] of [
    ["goblet-squat", 32],
    ["dumbbell-bench-press", 24],
    ["dumbbell-deadlift", 40],
  ].entries()) {
    await harness.recordInitial12RM(initial12RMInput(
      exerciseId as "goblet-squat" | "dumbbell-bench-press" | "dumbbell-deadlift",
      valueKg as number,
      `00000000-0000-4000-8000-00000000010${index}`,
    ));
  }
  await harness.activateProgram("2026-08-10");
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

function endOfCycleRetestCandidate() {
  const field = <T>(value: T) => ({ value, confidence: "high" as const });
  const result = (exerciseId: string, value: number) => ({
    exerciseId: field(exerciseId),
    test: "12RM" as const,
    result: field({ kind: "kg" as const, value, unit: "kg" as const, raw: String(value) }),
  });
  return {
    layout: field("zhuoshu-strength-test-block"),
    stage: field(3),
    week: field(12),
    weekday: field("friday"),
    sessionType: field("end_of_cycle_retest"),
    testResults: [
      result("goblet-squat", 36),
      result("dumbbell-bench-press", 28),
      result("dumbbell-deadlift", 44),
    ],
    uncertainFields: [],
  };
}
