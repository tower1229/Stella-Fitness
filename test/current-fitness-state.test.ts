import {
  cpSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { readFile } from "node:fs/promises";

import {
  ControlledFitnessQueryClassifier,
  ControlledExtractionRuntime,
  createScenarioHarness,
} from "../src/scenario/harness.js";
import type { ConfigurationPreflightResult } from "../src/preflight.js";
import { activateProgramFixture } from "./support/program-state.js";
import { rawMediaUploadFixture } from "./support/sanitized-media.js";
import { workoutLogCandidate } from "./support/workout-log-candidate.js";
import { rebuildCurrentFitnessTrainingRecordView } from
  "../src/storage/training-record.js";

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("Current Fitness State scenario", () => {
  it("routes a natural current-state phrase to Program Journey when no Program is active", async () => {
    const scenario = harness("Asia/Shanghai");

    await expect(scenario.queryFitness({
      text: "目前训练进度",
      receivedAt: "2026-08-11T16:30:00.000Z",
    })).resolves.toEqual({
      status: "answered",
      intent: { kind: "current-state", source: "deterministic" },
      facts: {
        kind: "program-journey",
        asOf: { localDate: "2026-08-12", timeZone: "Asia/Shanghai" },
        program: { id: "zhuoshu-12-week", version: "0.2.0" },
        pendingConfirmations: 0,
        nextStep: { message: "请先确认训练计划所需的准备项目。" },
      },
    });
  });

  it("uses the confirmed IANA timezone and labels due sessions as no record found", async () => {
    const personalDataDirectory = temporaryDirectory("stella-current-state-");
    await activateProgramFixture({
      personalDataDirectory,
      programSpec: await programFixture(),
      cycleStart: "2026-08-10",
    });
    const scenario = harness("Asia/Shanghai", personalDataDirectory);

    await expect(scenario.queryFitness({
      text: "最近练到哪了",
      receivedAt: "2026-08-11T16:30:00.000Z",
    })).resolves.toMatchObject({
      status: "answered",
      intent: { kind: "recent-training", source: "deterministic" },
      facts: {
        kind: "active",
        asOf: { localDate: "2026-08-12", timeZone: "Asia/Shanghai" },
        program: {
          id: "zhuoshu-12-week",
          version: "0.2.0",
          cycleStart: "2026-08-10",
        },
        position: { phase: "phase-1", week: 1 },
        dueSessions: [
          {
            date: "2026-08-10",
            weekday: "monday",
            sessionType: "full-body",
            record: "no-record-found",
          },
          {
            date: "2026-08-12",
            weekday: "wednesday",
            sessionType: "full-body",
            record: "no-record-found",
          },
        ],
        recordedSessions: [],
        pendingConfirmations: 0,
        nextStep: {
          kind: "review-unrecorded-session",
          date: "2026-08-10",
          message: "未找到 2026-08-10 计划训练的记录；这不表示没有训练。",
        },
      },
    });
  });

  it("allows a constrained classifier to select only an allowlisted read query", async () => {
    const classifier = new ControlledFitnessQueryClassifier([{
      status: "classified",
      intent: { kind: "current-state" },
    }]);
    const scenario = harness("Asia/Shanghai", undefined, classifier);

    await expect(scenario.queryFitness({
      text: "我的训练情况到哪一步了",
      receivedAt: "2026-08-11T16:30:00.000Z",
    })).resolves.toMatchObject({
      status: "answered",
      intent: { kind: "current-state", source: "classifier" },
      facts: { kind: "program-journey" },
    });
    expect(classifier.requests).toEqual([{
      text: "我的训练情况到哪一步了",
    }]);
  });

  it.each([
    "low-confidence",
    "timeout",
    "provider-error",
    "invalid-output",
  ] as const)("asks a minimal clarification after %s for an exact-fact-like request", async (status) => {
    const scenario = harness(
      "Asia/Shanghai",
      undefined,
      new ControlledFitnessQueryClassifier([{ status }]),
    );

    await expect(scenario.queryFitness({
      text: "我的训练情况到哪一步了",
      receivedAt: "2026-08-11T16:30:00.000Z",
    })).resolves.toEqual({
      status: "clarification",
      question: "你是想查看目前的训练计划与记录状态吗？",
    });
  });

  it("leaves ordinary conversation alone when the classifier is unavailable", async () => {
    const classifier = new ControlledFitnessQueryClassifier([{
      status: "provider-error",
    }]);
    const scenario = harness(
      "Asia/Shanghai",
      undefined,
      classifier,
    );

    await expect(scenario.queryFitness({
      text: "我今天训练挺开心",
      receivedAt: "2026-08-11T16:30:00.000Z",
    })).resolves.toEqual({ status: "not-applicable" });
    expect(classifier.requests).toEqual([{ text: "我今天训练挺开心" }]);
  });

  it.each([undefined, "Mars/Olympus_Mons"])(
    "does not guess a date boundary without a confirmed IANA timezone (%s)",
    async (timeZone) => {
      const scenario = harness(timeZone);

      await expect(scenario.queryFitness({
        text: "目前训练进度",
        receivedAt: "2026-08-11T16:30:00.000Z",
      })).resolves.toEqual({
        status: "clarification",
        question: "请先确认你的 IANA 时区，我才能确定“今天”“本周”和“目前”的日期边界。",
      });
    },
  );

  it("reflects a correction and external Observation deletion on the next query", async () => {
    const personalDataDirectory = temporaryDirectory("stella-current-state-");
    await activateProgramFixture({
      personalDataDirectory,
      programSpec: await programFixture(),
      cycleStart: "2026-08-10",
    });
    const originalScenario = createScenarioHarness({
      ...harnessOptions("Asia/Shanghai", personalDataDirectory),
      extractionRuntime: new ControlledExtractionRuntime([{
        parsed: currentStateWorkoutCandidate(),
        metadata: { provider: "controlled" },
      }]),
    });
    const original = await originalScenario.ingestWorkoutLog({
      runId: "current-state-original",
      upload: rawMediaUploadFixture(),
      timeoutMs: 2_000,
    });
    if (original.status !== "recorded") throw new Error("Expected a record");
    const correctedCandidate = currentStateWorkoutCandidate();
    correctedCandidate.exercises[0]!.sets[0]!.value = 12;
    const correctedScenario = createScenarioHarness({
      ...harnessOptions("Asia/Shanghai", personalDataDirectory),
      extractionRuntime: new ControlledExtractionRuntime([{
        parsed: correctedCandidate,
        metadata: { provider: "controlled" },
      }]),
    });
    const corrected = await correctedScenario.correctWorkoutLog({
      runId: "current-state-correction",
      replacesObservationId: original.observation.id,
      upload: rawMediaUploadFixture(
        Buffer.concat([rawMediaUploadFixture().bytes, Buffer.from([1])]),
      ),
      timeoutMs: 2_000,
    });
    if (corrected.status !== "recorded") throw new Error("Expected a correction");

    await expect(correctedScenario.queryFitness({
      text: "最近练到哪了",
      receivedAt: "2026-08-11T16:30:00.000Z",
    })).resolves.toMatchObject({
      facts: {
        latestRecord: {
          exercises: expect.arrayContaining([
            { exerciseId: "goblet-squat", sets: [12, null] },
          ]),
        },
      },
    });

    rmSync(join(
      personalDataDirectory,
      "observations",
      "workout-log",
      `${corrected.observation.id}.json`,
    ));

    await expect(correctedScenario.queryFitness({
      text: "最近练到哪了",
      receivedAt: "2026-08-11T16:30:00.000Z",
    })).resolves.toMatchObject({
      facts: {
        latestRecord: {
          exercises: expect.arrayContaining([
            { exerciseId: "goblet-squat", sets: [10, null] },
          ]),
        },
      },
    });
  });

  it("reports a persisted pending confirmation without exposing its ID", async () => {
    const personalDataDirectory = temporaryDirectory("stella-current-state-");
    await activateProgramFixture({
      personalDataDirectory,
      programSpec: await programFixture(),
      cycleStart: "2026-08-10",
    });
    const candidate = currentStateWorkoutCandidate();
    candidate.exercises[0]!.sets[0]!.confidence = "low";
    candidate.uncertainFields.push({
      path: "exercises[0].sets[0].value",
      kind: "low-confidence",
      candidates: ["10"],
    });
    const scenario = createScenarioHarness({
      ...harnessOptions("Asia/Shanghai", personalDataDirectory),
      extractionRuntime: new ControlledExtractionRuntime([{
        parsed: candidate,
        metadata: { provider: "controlled" },
      }]),
    });
    const pending = await scenario.ingestWorkoutLog({
      runId: "current-state-pending",
      upload: rawMediaUploadFixture(),
      timeoutMs: 2_000,
    });
    expect(pending.status).toBe("confirmation");

    const state = await scenario.queryFitness({
      text: "目前训练进度",
      receivedAt: "2026-08-11T16:30:00.000Z",
    });
    expect(state).toMatchObject({
      facts: { pendingConfirmations: 1 },
    });
    expect(JSON.stringify(state)).not.toMatch(/confirmationId|observationId/u);
  });

  it("reports a canonical conflict instead of choosing between multiple active Programs", async () => {
    const personalDataDirectory = temporaryDirectory("stella-current-state-");
    await activateProgramFixture({
      personalDataDirectory,
      programSpec: await programFixture(),
      cycleStart: "2026-08-10",
    });
    const conflictingContext = join(
      personalDataDirectory,
      "program",
      "active-contexts",
      "conflicting-cycle",
    );
    mkdirSync(conflictingContext, { recursive: true });
    writeFileSync(
      join(conflictingContext, "active.json"),
      `${JSON.stringify({
        schemaVersion: "stella-fitness/active-program-context/v0.1",
        contextId: "conflicting-cycle",
        active: true,
      }, null, 2)}\n`,
    );
    cpSync(
      join(personalDataDirectory, "program", "state.json"),
      join(conflictingContext, "state.json"),
    );
    cpSync(
      join(personalDataDirectory, "program", "spec.json"),
      join(conflictingContext, "spec.json"),
    );

    const result = await harness(
      "Asia/Shanghai",
      personalDataDirectory,
    ).queryFitness({
      text: "目前训练进度",
      receivedAt: "2026-08-11T16:30:00.000Z",
    });

    expect(result).toEqual({
      status: "answered",
      intent: { kind: "current-state", source: "deterministic" },
      facts: {
        kind: "conflict",
        asOf: { localDate: "2026-08-12", timeZone: "Asia/Shanghai" },
        message: "检测到多个 Active Program，无法确定唯一的当前训练状态。",
      },
    });
    expect(JSON.stringify(result)).not.toMatch(/stateId|observationId|conflicting-cycle/u);
  });

  it("ignores an unmarked staging Program Context", async () => {
    const personalDataDirectory = temporaryDirectory("stella-current-state-");
    await activateProgramFixture({
      personalDataDirectory,
      programSpec: await programFixture(),
      cycleStart: "2026-08-10",
    });
    mkdirSync(join(
      personalDataDirectory,
      "program",
      "active-contexts",
      "staging",
    ), { recursive: true });

    await expect(harness(
      "Asia/Shanghai",
      personalDataDirectory,
    ).queryFitness({
      text: "目前训练进度",
      receivedAt: "2026-08-11T16:30:00.000Z",
    })).resolves.toMatchObject({ facts: { kind: "active" } });
  });

  it("reports and excludes invalid pending-confirmation files", async () => {
    const personalDataDirectory = temporaryDirectory("stella-current-state-");
    const workoutProcessing = join(
      personalDataDirectory,
      "processing",
      "workout-log",
    );
    const journeyConfirmations = join(
      personalDataDirectory,
      "program",
      "pending-confirmations",
    );
    mkdirSync(workoutProcessing, { recursive: true });
    mkdirSync(journeyConfirmations, { recursive: true });
    writeFileSync(join(workoutProcessing, "invalid.json"), "{");
    writeFileSync(join(journeyConfirmations, "invalid.json"), "{}");
    const scenario = harness("Asia/Shanghai", personalDataDirectory);

    await expect(rebuildCurrentFitnessTrainingRecordView(
      personalDataDirectory,
    )).resolves.toMatchObject({
      pendingConfirmationCount: 0,
      errors: [{
        file: join("processing", "workout-log", "invalid.json"),
      }],
    });
    await expect(scenario.programJourneyStatus({
      date: "2026-08-12",
      includePendingConfirmations: true,
    })).resolves.toMatchObject({
      pendingConfirmationCount: 0,
      errors: [{
        file: join("program", "pending-confirmations", "invalid.json"),
      }],
    });
    await expect(scenario.queryFitness({
      text: "目前训练进度",
      receivedAt: "2026-08-11T16:30:00.000Z",
    })).resolves.toMatchObject({
      facts: { kind: "program-journey", pendingConfirmations: 0 },
    });
  });

  it("does not let a future planned-session record become current as of an earlier local date", async () => {
    const personalDataDirectory = temporaryDirectory("stella-current-state-");
    await activateProgramFixture({
      personalDataDirectory,
      programSpec: await programFixture(),
      cycleStart: "2026-08-10",
    });
    const candidate = currentStateWorkoutCandidate();
    candidate.weekday.value = "friday";
    const scenario = createScenarioHarness({
      ...harnessOptions("Asia/Shanghai", personalDataDirectory),
      extractionRuntime: new ControlledExtractionRuntime([{
        parsed: candidate,
        metadata: { provider: "controlled" },
      }]),
    });
    await scenario.ingestWorkoutLog({
      runId: "future-record",
      upload: rawMediaUploadFixture(),
      timeoutMs: 2_000,
    });

    await expect(scenario.queryFitness({
      text: "目前训练进度",
      receivedAt: "2026-08-11T16:30:00.000Z",
    })).resolves.toMatchObject({
      facts: {
        recordedSessions: [],
        dueSessions: [
          expect.objectContaining({ date: "2026-08-10" }),
          expect.objectContaining({ date: "2026-08-12" }),
        ],
      },
    });
    const result = await scenario.queryFitness({
      text: "目前训练进度",
      receivedAt: "2026-08-11T16:30:00.000Z",
    });
    expect(JSON.stringify(result)).not.toContain("latestRecord");
  });
});

function harness(
  timeZone: string | undefined,
  personalDataDirectory?: string,
  queryClassifier?: ControlledFitnessQueryClassifier,
) {
  const directory = personalDataDirectory ?? temporaryDirectory("stella-current-state-");
  return createScenarioHarness({
    ...harnessOptions(timeZone, directory, queryClassifier),
    extractionRuntime: new ControlledExtractionRuntime([]),
  });
}

function harnessOptions(
  timeZone: string | undefined,
  personalDataDirectory: string,
  queryClassifier?: ControlledFitnessQueryClassifier,
) {
  return {
    personalDataDirectory: () => personalDataDirectory,
    runtimeDirectory: () => join(personalDataDirectory, "..", "runtime"),
    userTimezone: () => timeZone,
    ...(queryClassifier === undefined ? {} : { queryClassifier }),
    preflight: (): ConfigurationPreflightResult => ({
      readiness: "READY",
      reasons: [],
    }),
  };
}

function temporaryDirectory(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  temporaryRoots.push(root);
  const directory = join(root, "personal");
  mkdirSync(directory);
  return directory;
}

async function programFixture(): Promise<unknown> {
  return parse(await readFile(
    new URL(
      "../knowledge/programs/zhuoshu-12-week/program-spec.v0.2.yaml",
      import.meta.url,
    ),
    "utf8",
  ));
}

function currentStateWorkoutCandidate(): ReturnType<typeof workoutLogCandidate> {
  const candidate = workoutLogCandidate();
  const exercise = candidate.exercises[0]!;
  candidate.exercises = [
    exercise,
    {
      ...structuredClone(exercise),
      rawLabel: { value: "哑铃卧推", confidence: "high" },
      exerciseId: { value: "dumbbell-bench-press", confidence: "high" },
    },
    {
      ...structuredClone(exercise),
      rawLabel: { value: "哑铃硬拉", confidence: "high" },
      exerciseId: { value: "dumbbell-deadlift", confidence: "high" },
    },
    {
      ...structuredClone(exercise),
      rawLabel: { value: "平板支撑", confidence: "high" },
      exerciseId: { value: "plank", confidence: "high" },
    },
  ];
  return candidate;
}
