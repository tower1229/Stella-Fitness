import {
  mkdtempSync,
  readFileSync,
  rmSync,
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

describe("workout-log Observation recording", () => {
  it("records a high-confidence fixed-layout page without filling blank actuals", async () => {
    const personalDataDirectory = temporaryDirectory("stella-personal-");
    const runtimeDirectory = temporaryDirectory("stella-runtime-");
    const runtime = new ControlledExtractionRuntime([
      {
        parsed: completedTorsoPage(),
        metadata: { provider: "controlled", model: "fixture-v1" },
      },
    ]);
    const harness = createScenarioHarness({
      extractionRuntime: runtime,
      personalDataDirectory: () => personalDataDirectory,
      runtimeDirectory: () => runtimeDirectory,
      preflight: () => ({ readiness: "READY", reasons: [] }),
    });

    const result = await harness.ingestWorkoutLog({
      runId: "workout-observation-1",
      upload: rawMediaUploadFixture(),
      timeoutMs: 2_000,
    });

    expect(result).toMatchObject({
      status: "recorded",
      observation: {
        schemaVersion: "stella-fitness/observation/workout-log/v0.1",
        id: expect.stringMatching(/^[0-9a-f-]{36}$/u),
        kind: "workout-log",
        occurredAt: "2026-08-10T08:00:00.000Z",
        layout: { value: "zhuoshu-three-stage-workbook", confidence: 0.99 },
        stage: { value: 2, confidence: 0.99 },
        week: { value: 7, confidence: 0.99 },
        weekday: { value: "thursday", confidence: 0.98 },
        sessionType: { value: "torso", confidence: 0.98 },
        exercises: [
          expect.objectContaining({
            exerciseId: { value: "pull-up", confidence: 0.99 },
            load: {
              value: {
                kind: "assistance",
                mode: "resistance-band",
                raw: "红色弹力带",
              },
              confidence: 0.96,
            },
            sets: [
              { value: 8, semantic: "repetitions", confidence: 0.99 },
              { value: 7, semantic: "repetitions", confidence: 0.98 },
            ],
          }),
          expect.objectContaining({
            exerciseId: {
              value: "dumbbell-bench-press",
              confidence: 0.99,
            },
            load: {
              value: { kind: "kg", value: 24, unit: "kg", raw: "24" },
              confidence: 0.99,
            },
          }),
          expect.objectContaining({
            exerciseId: { value: "plank", confidence: 0.99 },
            load: {
              value: { kind: "none", raw: "-" },
              confidence: 0.99,
            },
            sets: [
              { value: 60, semantic: "duration-seconds", confidence: 0.99 },
              {
                value: null,
                semantic: "duration-seconds",
                confidence: 0.99,
              },
            ],
          }),
        ],
        source: expect.objectContaining({
          kind: "workout-log-image",
          artifactId: expect.any(String),
          path: expect.stringContaining("raw-artifacts/workout-log/"),
          sha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
        }),
        provenance: {
          kind: "workout-log-recording",
          runId: "workout-observation-1",
          recordedAt: expect.any(String),
          confirmedFields: [],
        },
      },
    });
    if (result.status !== "recorded") {
      throw new Error("Expected the workout log to be recorded");
    }

    const observationPath = join(
      personalDataDirectory,
      "observations",
      "workout-log",
      `${result.observation.id}.json`,
    );
    expect(JSON.parse(readFileSync(observationPath, "utf8"))).toEqual(
      result.observation,
    );
    expect(result.processing.result).toEqual({
      kind: "workout-log-observation",
      observationId: result.observation.id,
      path: join(
        "observations",
        "workout-log",
        `${result.observation.id}.json`,
      ),
    });
  });

  it("asks only for uncertain fields and records the user-confirmed values", async () => {
    const personalDataDirectory = temporaryDirectory("stella-personal-");
    const candidate = completedTorsoPage();
    candidate.exercises[1]!.load = field(null, 0.51);
    candidate.exercises[1]!.problemNote = field("右侧略晃？", 0.58);
    candidate.uncertainFields = [
      {
        path: "exercises[1].load.value",
        kind: "conflict",
        candidates: ["24 kg", "26 kg"],
      },
      {
        path: "exercises[1].problemNote.value",
        kind: "low-confidence",
      },
    ];
    const harness = createScenarioHarness({
      extractionRuntime: new ControlledExtractionRuntime([
        { parsed: candidate, metadata: { provider: "controlled" } },
      ]),
      personalDataDirectory: () => personalDataDirectory,
      runtimeDirectory: () => temporaryDirectory("stella-runtime-"),
      preflight: () => ({ readiness: "READY", reasons: [] }),
    });

    const pending = await harness.ingestWorkoutLog({
      runId: "workout-confirmation-1",
      upload: rawMediaUploadFixture(),
      timeoutMs: 2_000,
    });

    expect(pending).toMatchObject({
      status: "confirmation",
      confirmationId: expect.stringMatching(/^[0-9a-f-]{36}$/u),
      fields: candidate.uncertainFields,
    });
    expect(pending).not.toHaveProperty("observation");
    if (pending.status !== "confirmation") {
      throw new Error("Expected workout-log field confirmation");
    }

    await expect(
      harness.confirmWorkoutLog({
        confirmationId: pending.confirmationId,
        values: {
          "exercises[1].load.value": {
            kind: "kg",
            value: 26,
            unit: "kg",
            raw: "26",
          },
        },
      }),
    ).rejects.toThrow("Confirm exactly the requested workout-log fields");

    const recorded = await harness.confirmWorkoutLog({
      confirmationId: pending.confirmationId,
      values: {
        "exercises[1].load.value": {
          kind: "kg",
          value: 26,
          unit: "kg",
          raw: "26",
        },
        "exercises[1].problemNote.value": "右侧略晃",
      },
    });

    expect(recorded).toMatchObject({
      status: "recorded",
      observation: {
        exercises: expect.arrayContaining([
          expect.objectContaining({
            load: {
              value: { kind: "kg", value: 26, unit: "kg", raw: "26" },
              confidence: 0.51,
            },
            problemNote: { value: "右侧略晃", confidence: 0.58 },
          }),
        ]),
        provenance: {
          kind: "workout-log-recording",
          runId: "workout-confirmation-1",
          recordedAt: expect.any(String),
          confirmedFields: [
            "exercises[1].load.value",
            "exercises[1].problemNote.value",
          ],
        },
      },
      processing: {
        operation: "workout-log-confirmation",
        result: {
          kind: "workout-log-observation",
          observationId: expect.any(String),
          path: expect.stringContaining("observations/workout-log/"),
        },
      },
    });
  });

  it("keeps bodyweight and exercise variants distinct from missing load", async () => {
    const candidate = completedTorsoPage();
    candidate.stage = field(3, 0.99);
    candidate.week = field(9, 0.99);
    candidate.sessionType = field("torso", 0.99);
    candidate.exercises = [
      {
        rawLabel: field("引体向上", 0.99),
        exerciseId: field("pull-up", 0.99),
        load: field({ kind: "bodyweight", raw: "徒手" }, 0.99),
        sets: [field(10, 0.99)],
        actionQuality: field("高", 0.99),
        problemNote: field(null, 0.99),
      },
      {
        rawLabel: field("俯卧撑", 0.99),
        exerciseId: field("push-up", 0.99),
        load: field({ kind: "variant", variant: "kneeling", raw: "跪姿" }, 0.99),
        sets: [field(12, 0.99)],
        actionQuality: field("中", 0.99),
        problemNote: field(null, 0.99),
      },
    ];
    const harness = createScenarioHarness({
      extractionRuntime: new ControlledExtractionRuntime([
        { parsed: candidate, metadata: { provider: "controlled" } },
      ]),
      personalDataDirectory: () => temporaryDirectory("stella-personal-"),
      runtimeDirectory: () => temporaryDirectory("stella-runtime-"),
      preflight: () => ({ readiness: "READY", reasons: [] }),
    });

    const result = await harness.ingestWorkoutLog({
      runId: "workout-load-semantics",
      upload: rawMediaUploadFixture(),
      timeoutMs: 2_000,
    });

    expect(result).toMatchObject({
      status: "recorded",
      observation: {
        exercises: [
          expect.objectContaining({
            load: {
              value: { kind: "bodyweight", raw: "徒手" },
              confidence: 0.99,
            },
          }),
          expect.objectContaining({
            load: {
              value: { kind: "variant", variant: "kneeling", raw: "跪姿" },
              confidence: 0.99,
            },
          }),
        ],
      },
    });
  });

  it("rejects uncertainty that cannot be corrected through a candidate field", async () => {
    const candidate = completedTorsoPage();
    candidate.uncertainFields = [
      { path: "exercises[99].invented.value", kind: "low-confidence" },
    ];
    const harness = createScenarioHarness({
      extractionRuntime: new ControlledExtractionRuntime([
        { parsed: candidate, metadata: { provider: "controlled" } },
      ]),
      personalDataDirectory: () => temporaryDirectory("stella-personal-"),
      runtimeDirectory: () => temporaryDirectory("stella-runtime-"),
      preflight: () => ({ readiness: "READY", reasons: [] }),
    });

    await expect(
      harness.ingestWorkoutLog({
        runId: "workout-invalid-uncertainty",
        upload: rawMediaUploadFixture(),
        timeoutMs: 2_000,
      }),
    ).rejects.toMatchObject({ name: "InvalidWorkoutLogCandidateError" });
  });
});

function completedTorsoPage(): {
  layout: ReturnType<typeof field<string>>;
  stage: ReturnType<typeof field<number>>;
  week: ReturnType<typeof field<number>>;
  weekday: ReturnType<typeof field<string>>;
  sessionType: ReturnType<typeof field<string>>;
  exercises: Array<{
    rawLabel: ReturnType<typeof field<string>>;
    exerciseId: ReturnType<typeof field<string>>;
    load: ReturnType<typeof field<Record<string, unknown> | null>>;
    sets: Array<ReturnType<typeof field<number | null>>>;
    actionQuality: ReturnType<typeof field<string | null>>;
    problemNote: ReturnType<typeof field<string | null>>;
  }>;
  uncertainFields: Array<{
    path: string;
    kind: "unknown" | "low-confidence" | "conflict";
    candidates?: string[];
  }>;
} {
  return {
    layout: field("zhuoshu-three-stage-workbook", 0.99),
    stage: field(2, 0.99),
    week: field(7, 0.99),
    weekday: field("thursday", 0.98),
    sessionType: field("torso", 0.98),
    exercises: [
      {
        rawLabel: field("引体向上", 0.99),
        exerciseId: field("pull-up", 0.99),
        load: field(
          {
            kind: "assistance",
            mode: "resistance-band",
            raw: "红色弹力带",
          },
          0.96,
        ),
        sets: [field(8, 0.99), field(7, 0.98)],
        actionQuality: field("中", 0.93),
        problemNote: field(null, 0.99),
      },
      {
        rawLabel: field("哑铃卧推", 0.99),
        exerciseId: field("dumbbell-bench-press", 0.99),
        load: field(
          { kind: "kg", value: 24, unit: "kg", raw: "24" },
          0.99,
        ),
        sets: [field(9, 0.99), field(null, 0.99)],
        actionQuality: field("高", 0.98),
        problemNote: field("右侧略晃", 0.96),
      },
      {
        rawLabel: field("平板支撑", 0.99),
        exerciseId: field("plank", 0.99),
        load: field({ kind: "none", raw: "-" }, 0.99),
        sets: [field(60, 0.99), field(null, 0.99)],
        actionQuality: field(null, 0.99),
        problemNote: field(null, 0.99),
      },
    ],
    uncertainFields: [],
  };
}

function field<T>(value: T, confidence: number) {
  return { value, confidence };
}

function temporaryDirectory(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  temporaryRoots.push(directory);
  return directory;
}
