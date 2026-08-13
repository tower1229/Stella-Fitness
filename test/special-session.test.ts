import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parse } from "yaml";
import { afterEach, describe, expect, it } from "vitest";

import {
  ControlledExtractionRuntime,
  createScenarioHarness,
} from "../src/scenario/harness.js";
import { activateProgramFixture } from "./support/program-state.js";
import { rawMediaUploadFixture } from "./support/sanitized-media.js";

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("special workout sessions", () => {
  it("records Week 4 Friday as strength_test and binds each confirmed result", async () => {
    const personalDataDirectory = temporaryPersonalDataDirectory();
    const harness = createScenarioHarness({
      extractionRuntime: new ControlledExtractionRuntime([
        {
          parsed: strengthTestCandidate(),
          metadata: { provider: "controlled", model: "fixture-v1" },
        },
      ]),
      personalDataDirectory: () => personalDataDirectory,
      runtimeDirectory: () => join(personalDataDirectory, "..", "runtime"),
      preflight: () => ({ readiness: "READY", reasons: [] }),
    });
    await activateProgramFixture({ personalDataDirectory, programSpec: await programFixture() });

    const pending = await harness.ingestWorkoutLog({
      runId: "week-4-strength-test",
      upload: rawMediaUploadFixture(),
      timeoutMs: 2_000,
    });

    expect(pending).toMatchObject({
      status: "confirmation",
      fields: [0, 1, 2, 3].map((index) => ({
        path: `testResults[${index}].result.value`,
        kind: "confirmation-required",
      })),
    });
    expect(
      JSON.parse(
        readFileSync(
          join(personalDataDirectory, "program", "state.json"),
          "utf8",
        ),
      ).symbolicLoadBindings,
    ).toEqual({});
    if (pending.status !== "confirmation") {
      throw new Error("Expected strength-test confirmation");
    }
    const result = await harness.confirmWorkoutLog({
      confirmationId: pending.confirmationId,
      values: Object.fromEntries(
        strengthTestCandidate().testResults.map((testResult, index) => [
          `testResults[${index}].result.value`,
          testResult.result.value,
        ]),
      ),
    });

    expect(result).toMatchObject({
      status: "recorded",
      observation: {
        kind: "workout-special-session",
        sessionType: { value: "strength_test", confidence: "high" },
        plannedSession: {
          cycle: { week: 4, phase: "phase-1" },
          day: "friday",
          type: "strength-test",
        },
        testResults: [
          {
            exerciseId: { value: "goblet-squat", confidence: "high" },
            test: "12RM",
            result: {
              value: { kind: "kg", value: 32, unit: "kg", raw: "32" },
              confidence: "high",
            },
          },
          {
            exerciseId: {
              value: "dumbbell-bench-press",
              confidence: "high",
            },
            test: "12RM",
            result: {
              value: { kind: "kg", value: 24, unit: "kg", raw: "24" },
              confidence: "high",
            },
          },
          {
            exerciseId: {
              value: "dumbbell-deadlift",
              confidence: "high",
            },
            test: "12RM",
            result: {
              value: { kind: "kg", value: 40, unit: "kg", raw: "40" },
              confidence: "high",
            },
          },
          {
            exerciseId: { value: "pull-up", confidence: "high" },
            test: "max_reps_first_set",
            result: {
              value: { kind: "repetitions", value: 9, raw: "9" },
              confidence: "high",
            },
          },
        ],
      },
      programState: {
        symbolicLoadBindings: {
          "goblet-squat": { N: { value: 32, unit: "kg" } },
          "dumbbell-bench-press": { N: { value: 24, unit: "kg" } },
          "dumbbell-deadlift": { N: { value: 40, unit: "kg" } },
        },
        assistanceBindings: {
          phase2_pullup_assistance_baseline: {
            exerciseId: "pull-up",
            result: { value: 9, unit: "repetitions" },
          },
        },
      },
    });
    expect(JSON.stringify(result)).not.toMatch(
      /diagnosis|evaluation|recommendation|performance/i,
    );

    const state = JSON.parse(
      readFileSync(join(personalDataDirectory, "program", "state.json"), "utf8"),
    );
    expect(state).toEqual(result.programState);
  });

  it.each([
    [8, "thursday", "torso-recovery", 15, 8],
    [8, "friday", "limbs-recovery", undefined, 8],
    [12, "thursday", "torso-recovery", 20, 12],
    [12, "friday", "limbs-recovery", undefined, 12],
  ] as const)(
    "retains week %i %s recovery identity and prescription",
    async (week, weekday, sessionType, pullupTotal, mainReps) => {
      const personalDataDirectory = temporaryPersonalDataDirectory();
      const candidate = recoveryCandidate(week, weekday);
      const harness = createScenarioHarness({
        extractionRuntime: new ControlledExtractionRuntime([
          { parsed: candidate, metadata: { provider: "controlled" } },
        ]),
        personalDataDirectory: () => personalDataDirectory,
        runtimeDirectory: () => join(personalDataDirectory, "..", "runtime"),
        preflight: () => ({ readiness: "READY", reasons: [] }),
      });
      await activateProgramFixture({ personalDataDirectory, programSpec: await programFixture() });

      const result = await harness.ingestWorkoutLog({
        runId: `recovery-${week}-${weekday}`,
        upload: rawMediaUploadFixture(),
        timeoutMs: 2_000,
      });

      expect(result).toMatchObject({
        status: "recorded",
        observation: {
          kind: "workout-recovery-session",
          sessionType: { value: sessionType, confidence: "high" },
          plannedSession: {
            cycle: { week },
            day: weekday,
            type: sessionType,
            recovery: true,
            exercises: expect.arrayContaining([
              expect.objectContaining({
                exerciseId:
                  weekday === "thursday"
                    ? "dumbbell-bench-press"
                    : "goblet-squat",
                prescription: {
                  type: "sets_reps",
                  sets: 3,
                  reps: mainReps,
                },
                effort: "complete_prescribed_reps",
              }),
            ]),
          },
        },
      });
      if (pullupTotal !== undefined) {
        expect(result).toMatchObject({
          observation: {
            plannedSession: {
              exercises: expect.arrayContaining([
                expect.objectContaining({
                  exerciseId: "pull-up",
                  prescription: { type: "total_reps", reps: pullupTotal },
                }),
              ]),
            },
          },
        });
      }
      expect(JSON.stringify(result)).not.toMatch(
        /decline|regress|diagnosis|evaluation|recommendation/i,
      );
    },
  );

  it("initializes next-cycle A bindings from the end-of-cycle retest", async () => {
    const personalDataDirectory = temporaryPersonalDataDirectory();
    const candidate = strengthTestCandidate();
    candidate.stage = field(3);
    candidate.week = field(12);
    candidate.weekday = field("friday");
    candidate.sessionType = field("end_of_cycle_retest");
    candidate.testResults = candidate.testResults.slice(0, 3).map(
      (result, index) => ({
        ...result,
        result: field({
          kind: "kg",
          value: [36, 28, 44][index],
          unit: "kg",
          raw: String([36, 28, 44][index]),
        }),
      }),
    );
    const harness = createScenarioHarness({
      extractionRuntime: new ControlledExtractionRuntime([
        { parsed: candidate, metadata: { provider: "controlled" } },
      ]),
      personalDataDirectory: () => personalDataDirectory,
      runtimeDirectory: () => join(personalDataDirectory, "..", "runtime"),
      preflight: () => ({ readiness: "READY", reasons: [] }),
    });
    await activateJourneyThroughWeek12(harness);

    const pending = await harness.ingestWorkoutLog({
      runId: "end-of-cycle-retest",
      upload: rawMediaUploadFixture(),
      timeoutMs: 2_000,
    });
    if (pending.status !== "confirmation") {
      throw new Error("Expected end-of-cycle retest confirmation");
    }
    const result = await harness.confirmWorkoutLog({
      confirmationId: pending.confirmationId,
      values: Object.fromEntries(
        candidate.testResults.map((testResult, index) => [
          `testResults[${index}].result.value`,
          testResult.result.value,
        ]),
      ),
    });

    expect(result).toMatchObject({
      status: "recorded",
      observation: {
        kind: "workout-special-session",
        sessionType: { value: "end_of_cycle_retest" },
        plannedSession: {
          kind: "cycle-completion-retest",
          type: "end-of-cycle-retest",
          cycle: { completedWeek: 12 },
        },
      },
      programState: {
        symbolicLoadBindings: {
          "goblet-squat": { A: { value: 30, unit: "kg" } },
          "dumbbell-bench-press": { A: { value: 20, unit: "kg" } },
          "dumbbell-deadlift": { A: { value: 38, unit: "kg" } },
        },
        nextCycle: {
          restartFromWeek: 1,
          symbolicLoadBindings: {
            "goblet-squat": { A: { value: 36, unit: "kg" } },
            "dumbbell-bench-press": { A: { value: 28, unit: "kg" } },
            "dumbbell-deadlift": { A: { value: 44, unit: "kg" } },
          },
        },
      },
    });
  });

  it("serializes concurrent special-session confirmations onto the latest Program State", async () => {
    const personalDataDirectory = temporaryPersonalDataDirectory();
    const week4 = strengthTestCandidate();
    const cycleEnd = endOfCycleCandidate();
    const harness = createScenarioHarness({
      extractionRuntime: new ControlledExtractionRuntime([
        { parsed: week4, metadata: { provider: "controlled" } },
        { parsed: cycleEnd, metadata: { provider: "controlled" } },
      ]),
      personalDataDirectory: () => personalDataDirectory,
      runtimeDirectory: () => join(personalDataDirectory, "..", "runtime"),
      preflight: () => ({ readiness: "READY", reasons: [] }),
    });
    await activateJourneyThroughWeek12(harness);
    const first = await harness.ingestWorkoutLog({
      runId: "concurrent-week-4",
      upload: rawMediaUploadFixture(),
      timeoutMs: 2_000,
    });
    const second = await harness.ingestWorkoutLog({
      runId: "concurrent-cycle-end",
      upload: (() => {
        const upload = rawMediaUploadFixture();
        return { ...upload, bytes: Buffer.concat([upload.bytes, Buffer.from([0])]) };
      })(),
      timeoutMs: 2_000,
    });
    if (first.status !== "confirmation" || second.status !== "confirmation") {
      throw new Error("Expected both special sessions to require confirmation");
    }

    await expect(
      Promise.all([
        harness.confirmWorkoutLog({
          confirmationId: first.confirmationId,
          values: confirmationValues(week4),
        }),
        harness.confirmWorkoutLog({
          confirmationId: second.confirmationId,
          values: confirmationValues(cycleEnd),
        }),
      ]),
    ).resolves.toHaveLength(2);

    const state = JSON.parse(
      readFileSync(join(personalDataDirectory, "program", "state.json"), "utf8"),
    );
    expect(state).toMatchObject({
      symbolicLoadBindings: {
        "goblet-squat": { N: { value: 32 } },
        "dumbbell-bench-press": { N: { value: 24 } },
        "dumbbell-deadlift": { N: { value: 40 } },
      },
      assistanceBindings: {
        phase2_pullup_assistance_baseline: {
          result: { value: 9, unit: "repetitions" },
        },
      },
      nextCycle: {
        symbolicLoadBindings: {
          "goblet-squat": { A: { value: 36 } },
          "dumbbell-bench-press": { A: { value: 28 } },
          "dumbbell-deadlift": { A: { value: 44 } },
        },
      },
    });
  });

  it("rebuilds N bindings from active special-session Observations after correction deletion", async () => {
    const personalDataDirectory = temporaryPersonalDataDirectory();
    const originalCandidate = strengthTestCandidate();
    const correctedCandidate = strengthTestCandidate();
    for (const [index, value] of [34, 26, 42].entries()) {
      correctedCandidate.testResults[index]!.result = field({
        kind: "kg",
        value,
        unit: "kg",
        raw: String(value),
      });
    }
    const harness = createScenarioHarness({
      extractionRuntime: new ControlledExtractionRuntime([
        { parsed: originalCandidate, metadata: { provider: "controlled" } },
        { parsed: correctedCandidate, metadata: { provider: "controlled" } },
      ]),
      personalDataDirectory: () => personalDataDirectory,
      runtimeDirectory: () => join(personalDataDirectory, "..", "runtime"),
      preflight: () => ({ readiness: "READY", reasons: [] }),
    });
    await activateProgramFixture({ personalDataDirectory, programSpec: await programFixture() });
    const originalPending = await harness.ingestWorkoutLog({
      runId: "week-4-original",
      upload: rawMediaUploadFixture(),
      timeoutMs: 2_000,
    });
    if (originalPending.status !== "confirmation") throw new Error("Expected confirmation");
    const original = await harness.confirmWorkoutLog({
      confirmationId: originalPending.confirmationId,
      values: confirmationValues(originalCandidate),
    });
    const correctedPending = await harness.correctWorkoutLog({
      runId: "week-4-correction",
      replacesObservationId: original.observation.id,
      upload: { ...rawMediaUploadFixture(), fileName: "corrected-strength-test.png" },
      timeoutMs: 2_000,
    });
    if (correctedPending.status !== "confirmation") throw new Error("Expected correction confirmation");
    const corrected = await harness.confirmWorkoutLog({
      confirmationId: correctedPending.confirmationId,
      values: confirmationValues(correctedCandidate),
    });
    expect(corrected.programState).toMatchObject({
      symbolicLoadBindings: {
        "goblet-squat": { N: { value: 34 } },
        "dumbbell-bench-press": { N: { value: 26 } },
        "dumbbell-deadlift": { N: { value: 42 } },
      },
    });

    unlinkSync(join(
      personalDataDirectory,
      "observations",
      "workout-log",
      `${corrected.observation.id}.json`,
    ));
    await harness.programJourneyStatus();
    expect(JSON.parse(readFileSync(join(personalDataDirectory, "program", "state.json"), "utf8")))
      .toMatchObject({
        symbolicLoadBindings: {
          "goblet-squat": { N: { value: 32 } },
          "dumbbell-bench-press": { N: { value: 24 } },
          "dumbbell-deadlift": { N: { value: 40 } },
        },
      });

    unlinkSync(join(
      personalDataDirectory,
      "observations",
      "workout-log",
      `${original.observation.id}.json`,
    ));
    await harness.programJourneyStatus();
    expect(JSON.parse(readFileSync(join(personalDataDirectory, "program", "state.json"), "utf8")))
      .toMatchObject({ symbolicLoadBindings: {} });
  });

  it("fails closed on invalid or conflicting active strength-test Observations across runtimes", async () => {
    const personalDataDirectory = temporaryPersonalDataDirectory();
    const runtimeDirectory = join(personalDataDirectory, "..", "shared-runtime");
    await activateProgramFixture({ personalDataDirectory, programSpec: await programFixture() });
    const createHarness = (candidate: ReturnType<typeof strengthTestCandidate>) =>
      createScenarioHarness({
        extractionRuntime: new ControlledExtractionRuntime([
          { parsed: candidate, metadata: { provider: "controlled" } },
        ]),
        personalDataDirectory: () => personalDataDirectory,
        runtimeDirectory: () => runtimeDirectory,
        preflight: () => ({ readiness: "READY", reasons: [] }),
      });
    const firstHarness = createHarness(strengthTestCandidate());
    const secondHarness = createHarness(strengthTestCandidate());
    const firstPending = await firstHarness.ingestWorkoutLog({
      runId: "cross-runtime-strength-a",
      upload: rawMediaUploadFixture(),
      timeoutMs: 2_000,
    });
    const secondUpload = rawMediaUploadFixture();
    const secondPending = await secondHarness.ingestWorkoutLog({
      runId: "cross-runtime-strength-b",
      upload: { ...secondUpload, bytes: Buffer.concat([secondUpload.bytes, Buffer.from([0])]) },
      timeoutMs: 2_000,
    });
    if (firstPending.status !== "confirmation" || secondPending.status !== "confirmation") {
      throw new Error("Expected two strength-test confirmations");
    }
    const results = await Promise.allSettled([
      firstHarness.confirmWorkoutLog({
        confirmationId: firstPending.confirmationId,
        values: confirmationValues(strengthTestCandidate()),
      }),
      secondHarness.confirmWorkoutLog({
        confirmationId: secondPending.confirmationId,
        values: confirmationValues(strengthTestCandidate()),
      }),
    ]);
    expect(results.map(({ status }) => status).sort()).toEqual(["fulfilled", "rejected"]);
    const activeFiles = readdirSync(join(personalDataDirectory, "observations", "workout-log"));
    expect(activeFiles).toHaveLength(1);
    const observationPath = join(
      personalDataDirectory,
      "observations",
      "workout-log",
      activeFiles[0]!,
    );
    const stateBeforeInvalidEdit = readFileSync(
      join(personalDataDirectory, "program", "state.json"),
      "utf8",
    );
    writeFileSync(observationPath, "{}\n");
    await expect(firstHarness.programJourneyStatus()).rejects.toThrow(
      /observations\/workout-log\/.+Workout-log Observation is schema-invalid/u,
    );
    expect(readFileSync(join(personalDataDirectory, "program", "state.json"), "utf8"))
      .toBe(stateBeforeInvalidEdit);
  });
});

function strengthTestCandidate() {
  return {
    layout: field("zhuoshu-strength-test-block"),
    stage: field(1),
    week: field(4),
    weekday: field("friday"),
    sessionType: field("strength_test"),
    testResults: [
      testResult("goblet-squat", "12RM", {
        kind: "kg",
        value: 32,
        unit: "kg",
        raw: "32",
      }),
      testResult("dumbbell-bench-press", "12RM", {
        kind: "kg",
        value: 24,
        unit: "kg",
        raw: "24",
      }),
      testResult("dumbbell-deadlift", "12RM", {
        kind: "kg",
        value: 40,
        unit: "kg",
        raw: "40",
      }),
      testResult("pull-up", "max_reps_first_set", {
        kind: "repetitions",
        value: 9,
        raw: "9",
      }),
    ],
    uncertainFields: [],
  };
}

function recoveryCandidate(week: 8 | 12, weekday: "thursday" | "friday") {
  const exercises = week === 12 && weekday === "thursday"
    ? [
        ["引体向上", "pull-up"],
        ["哑铃卧推", "dumbbell-bench-press"],
        ["哑铃推肩", "dumbbell-overhead-press"],
        ["俯卧撑", "push-up"],
        ["单臂哑铃划船", "one-arm-dumbbell-row"],
      ] as const
    : week === 12
      ? [
          ["高脚杯深蹲", "goblet-squat"],
          ["哑铃硬拉", "dumbbell-deadlift"],
          ["哑铃侧平举", "dumbbell-lateral-raise"],
          ["哑铃弯举", "dumbbell-curl"],
          ["哑铃锤式弯举", "dumbbell-hammer-curl"],
        ] as const
      : weekday === "thursday"
    ? [
        ["引体向上", "pull-up"],
        ["哑铃卧推", "dumbbell-bench-press"],
        ["哑铃推肩", "dumbbell-overhead-press"],
        ["平板支撑", "plank"],
      ] as const
    : [
        ["高脚杯深蹲", "goblet-squat"],
        ["哑铃硬拉", "dumbbell-deadlift"],
        ["哑铃侧平举", "dumbbell-lateral-raise"],
        ["平板支撑", "plank"],
      ] as const;
  return {
    layout: field("zhuoshu-three-stage-workbook"),
    stage: field(week === 8 ? 2 : 3),
    week: field(week),
    weekday: field(weekday),
    // The fixed page can look like the ordinary split. ProgramSpec owns recovery identity.
    sessionType: field(weekday === "thursday" ? "torso" : "limbs"),
    exercises: exercises.map(([rawLabel, exerciseId]) => ({
        rawLabel: field(rawLabel),
        exerciseId: field(exerciseId),
        load: field(
          exerciseId === "plank"
            ? { kind: "none", raw: "-" }
            : { kind: "kg", value: 24, unit: "kg", raw: "24" },
        ),
        sets: [field(12), field(12), field(12)],
        actionQuality: field(null),
        problemNote: field(null),
      })),
    uncertainFields: [],
  };
}

function endOfCycleCandidate() {
  const candidate = strengthTestCandidate();
  return {
    ...candidate,
    stage: field(3),
    week: field(12),
    sessionType: field("end_of_cycle_retest"),
    testResults: candidate.testResults.slice(0, 3).map((result, index) => ({
      ...result,
      result: field({
        kind: "kg",
        value: [36, 28, 44][index],
        unit: "kg",
        raw: String([36, 28, 44][index]),
      }),
    })),
  };
}

function confirmationValues(candidate: ReturnType<typeof strengthTestCandidate>) {
  return Object.fromEntries(
    candidate.testResults.map((testResult, index) => [
      `testResults[${index}].result.value`,
      testResult.result.value,
    ]),
  );
}

function testResult(
  exerciseId: string,
  test: string,
  result: Record<string, unknown>,
) {
  return {
    exerciseId: field(exerciseId),
    test,
    result: field(result),
  };
}

function field<T>(value: T) {
  return { value, confidence: "high" as const };
}

async function activateJourneyThroughWeek12(
  harness: ReturnType<typeof createScenarioHarness>,
): Promise<void> {
  for (const [index, prerequisiteId] of [
    "adjustable-dumbbells",
    "pull-up-bar",
    "printed-workout-log",
    "recording-protocol",
  ].entries()) {
    await harness.acknowledgePrerequisite({
      prerequisiteId,
      acknowledgedAt: `2026-08-09T0${index}:00:00.000Z`,
      source: { kind: "user-text", text: prerequisiteId },
    });
  }
  await harness.recordJourneyBodyWeight({
    role: "baseline",
    text: "68.4 kg",
    receivedAt: "2026-08-09T04:00:00.000Z",
  });
  for (const [index, [exerciseId, valueKg]] of [
    ["goblet-squat", 30],
    ["dumbbell-bench-press", 20],
    ["dumbbell-deadlift", 38],
  ].entries()) {
    await harness.recordInitial12RM({
      exerciseId: exerciseId as
        | "goblet-squat"
        | "dumbbell-bench-press"
        | "dumbbell-deadlift",
      valueKg: valueKg as number,
      confirmationId: `00000000-0000-4000-8000-00000000020${index}`,
      occurredAt: "2026-08-09T05:00:00.000Z",
      recordedAt: "2026-08-09T05:01:00.000Z",
      source: { kind: "user-text", text: `${exerciseId} ${valueKg} kg` },
    });
  }
  await harness.activateProgram("2026-08-10");
  for (const [checkpointWeek, receivedAt, amount] of [
    [4, "2026-09-07T08:00:00.000Z", "68.8"],
    [8, "2026-10-05T08:00:00.000Z", "69"],
    [12, "2026-10-26T08:00:00.000Z", "69.2"],
  ] as const) {
    await harness.recordJourneyBodyWeight({
      role: "checkpoint",
      checkpointWeek,
      text: `${amount} kg`,
      receivedAt,
      source: { channel: "test", messageId: `week-${checkpointWeek}-checkpoint` },
    });
  }
}

function temporaryPersonalDataDirectory(): string {
  const root = mkdtempSync(join(tmpdir(), "stella-special-session-"));
  temporaryRoots.push(root);
  const personalDataDirectory = join(root, "personal");
  mkdirSync(personalDataDirectory);
  return personalDataDirectory;
}

async function programFixture(): Promise<unknown> {
  return parse(
    await readFile(
      new URL(
        "../knowledge/programs/zhuoshu-12-week/program-spec.v0.2.yaml",
        import.meta.url,
      ),
      "utf8",
    ),
  );
}
