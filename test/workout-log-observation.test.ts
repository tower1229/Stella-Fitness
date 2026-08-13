import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readFile } from "node:fs/promises";
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

describe("workout-log Observation recording", () => {
  it("fails closed when an ordinary page session type conflicts with ProgramSpec", async () => {
    const personalDataDirectory = temporaryDirectory("stella-personal-");
    const runtimeDirectory = temporaryDirectory("stella-runtime-");
    const candidate = plannedTorsoPage();
    candidate.sessionType = field("limbs");
    const harness = createScenarioHarness({
      extractionRuntime: new ControlledExtractionRuntime([
        { parsed: candidate, metadata: { provider: "controlled" } },
      ]),
      personalDataDirectory: () => personalDataDirectory,
      runtimeDirectory: () => runtimeDirectory,
      preflight: () => ({ readiness: "READY", reasons: [] }),
    });
    await activateProgramFixture({
      personalDataDirectory,
      programSpec: await programFixture(),
    });

    await expect(harness.ingestWorkoutLog({
      runId: "ordinary-session-mismatch",
      upload: rawMediaUploadFixture(),
      timeoutMs: 2_000,
    })).rejects.toThrow("planned session");

    expect(filesUnder(join(personalDataDirectory, "observations", "workout-log")))
      .toEqual([]);
    const processingFiles = filesUnder(
      join(personalDataDirectory, "processing", "workout-log"),
    );
    expect(processingFiles).toHaveLength(1);
    expect(JSON.parse(readFileSync(processingFiles[0]!, "utf8"))).toMatchObject({
      status: "failed",
      errorCategory: "invalid-result",
    });
  });

  it.each([
    ["has no planned date", (candidate: ReturnType<typeof plannedTorsoPage>) => {
      candidate.weekday = field("wednesday");
    }],
    ["misses a planned exercise", (candidate: ReturnType<typeof plannedTorsoPage>) => {
      candidate.exercises.pop();
    }],
    ["contains an extra exercise", (candidate: ReturnType<typeof plannedTorsoPage>) => {
      candidate.exercises.push({
        rawLabel: field("俯卧撑"),
        exerciseId: field("push-up"),
        load: field({ kind: "bodyweight", raw: "徒手" }),
        sets: [field(10)],
        actionQuality: field(null),
        problemNote: field(null),
      });
    }],
    ["duplicates a planned exercise", (candidate: ReturnType<typeof plannedTorsoPage>) => {
      candidate.exercises[2]!.exerciseId = field("dumbbell-bench-press");
    }],
  ])("fails closed when an ordinary page %s", async (_label, mutate) => {
    const personalDataDirectory = temporaryDirectory("stella-personal-");
    const candidate = plannedTorsoPage();
    mutate(candidate);
    const harness = createScenarioHarness({
      extractionRuntime: new ControlledExtractionRuntime([
        { parsed: candidate, metadata: { provider: "controlled" } },
      ]),
      personalDataDirectory: () => personalDataDirectory,
      runtimeDirectory: () => temporaryDirectory("stella-runtime-"),
      preflight: () => ({ readiness: "READY", reasons: [] }),
    });
    await activateProgramFixture({
      personalDataDirectory,
      programSpec: await programFixture(),
    });

    await expect(harness.ingestWorkoutLog({
      runId: `ordinary-${String(_label).replaceAll(" ", "-")}`,
      upload: rawMediaUploadFixture(),
      timeoutMs: 2_000,
    })).rejects.toThrow("planned session");
    expect(filesUnder(join(personalDataDirectory, "observations", "workout-log")))
      .toEqual([]);
  });

  it("revalidates ProgramSpec after workout-log confirmation", async () => {
    const personalDataDirectory = temporaryDirectory("stella-personal-");
    const candidate = plannedTorsoPage();
    candidate.sessionType = field("torso", "low");
    candidate.uncertainFields = [{
      path: "sessionType.value",
      kind: "conflict",
      candidates: ["torso", "limbs"],
    }];
    const harness = createScenarioHarness({
      extractionRuntime: new ControlledExtractionRuntime([
        { parsed: candidate, metadata: { provider: "controlled" } },
      ]),
      personalDataDirectory: () => personalDataDirectory,
      runtimeDirectory: () => temporaryDirectory("stella-runtime-"),
      preflight: () => ({ readiness: "READY", reasons: [] }),
    });
    await activateProgramFixture({
      personalDataDirectory,
      programSpec: await programFixture(),
    });
    const pending = await harness.ingestWorkoutLog({
      runId: "ordinary-confirmed-mismatch",
      upload: rawMediaUploadFixture(),
      timeoutMs: 2_000,
    });
    if (pending.status !== "confirmation") {
      throw new Error("Expected workout-log confirmation");
    }

    await expect(harness.confirmWorkoutLog({
      confirmationId: pending.confirmationId,
      values: { "sessionType.value": "limbs" },
    })).rejects.toThrow("planned session");

    expect(filesUnder(join(personalDataDirectory, "observations", "workout-log")))
      .toEqual([]);
    const processingFiles = filesUnder(
      join(personalDataDirectory, "processing", "workout-log"),
    );
    expect(processingFiles).toHaveLength(2);
    expect(
      processingFiles.map((path) => JSON.parse(readFileSync(path, "utf8"))),
    ).toEqual(expect.arrayContaining([
      expect.objectContaining({
        operation: "workout-log-confirmation",
        status: "failed",
        errorCategory: "invalid-result",
      }),
    ]));
  });

  it("records an ordinary page that matches its Planned Session", async () => {
    const personalDataDirectory = temporaryDirectory("stella-personal-");
    const harness = createScenarioHarness({
      extractionRuntime: new ControlledExtractionRuntime([
        { parsed: plannedTorsoPage(), metadata: { provider: "controlled" } },
      ]),
      personalDataDirectory: () => personalDataDirectory,
      runtimeDirectory: () => temporaryDirectory("stella-runtime-"),
      preflight: () => ({ readiness: "READY", reasons: [] }),
    });
    await activateProgramFixture({
      personalDataDirectory,
      programSpec: await programFixture(),
    });

    await expect(harness.ingestWorkoutLog({
      runId: "ordinary-session-match",
      upload: rawMediaUploadFixture(),
      timeoutMs: 2_000,
    })).resolves.toMatchObject({ status: "recorded" });
  });

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
        layout: { value: "zhuoshu-three-stage-workbook", confidence: "high" },
        stage: { value: 2, confidence: "high" },
        week: { value: 7, confidence: "high" },
        weekday: { value: "thursday", confidence: "high" },
        sessionType: { value: "torso", confidence: "high" },
        exercises: [
          expect.objectContaining({
            exerciseId: { value: "pull-up", confidence: "high" },
            load: {
              value: {
                kind: "assistance",
                mode: "resistance-band",
                raw: "红色弹力带",
              },
              confidence: "high",
            },
            sets: [
              { value: 8, semantic: "repetitions", confidence: "high" },
              { value: 7, semantic: "repetitions", confidence: "high" },
            ],
          }),
          expect.objectContaining({
            exerciseId: {
              value: "dumbbell-bench-press",
              confidence: "high",
            },
            load: {
              value: { kind: "kg", value: 24, unit: "kg", raw: "24" },
              confidence: "high",
            },
          }),
          expect.objectContaining({
            exerciseId: { value: "plank", confidence: "high" },
            load: {
              value: { kind: "none", raw: "-" },
              confidence: "high",
            },
            sets: [
              { value: 60, semantic: "duration-seconds", confidence: "high" },
              {
                value: null,
                semantic: "duration-seconds",
                confidence: "high",
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
        uncertainty: [],
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
    candidate.exercises[1]!.load = field(null, "low");
    candidate.exercises[1]!.problemNote = field("右侧略晃？", "low");
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
      processing: {
        status: "awaiting-confirmation",
        result: {
          kind: "workout-log-confirmation",
          confirmationId: expect.any(String),
        },
      },
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
              confidence: "high",
            },
            problemNote: { value: "右侧略晃", confidence: "high" },
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
        uncertainty: [
          {
            path: "exercises[1].load.value",
            kind: "conflict",
            candidates: ["24 kg", "26 kg"],
            resolution: "user-confirmed",
          },
          {
            path: "exercises[1].problemNote.value",
            kind: "low-confidence",
            resolution: "user-confirmed",
          },
        ],
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

  it("resumes a pending workout-log confirmation after runtime restart", async () => {
    const personalDataDirectory = temporaryDirectory("stella-personal-");
    const runtimeDirectory = temporaryDirectory("stella-runtime-");
    const candidate = completedTorsoPage();
    candidate.exercises[1]!.load = field(null, "low");
    candidate.uncertainFields = [{
      path: "exercises[1].load.value",
      kind: "low-confidence",
    }];
    const options = {
      personalDataDirectory: () => personalDataDirectory,
      runtimeDirectory: () => runtimeDirectory,
      preflight: () => ({ readiness: "READY" as const, reasons: [] }),
    };
    const first = createScenarioHarness({
      ...options,
      extractionRuntime: new ControlledExtractionRuntime([
        { parsed: candidate, metadata: { provider: "controlled" } },
      ]),
    });
    const pending = await first.ingestWorkoutLog({
      runId: "workout-confirmation-restart-1",
      upload: rawMediaUploadFixture(),
      timeoutMs: 2_000,
    });
    if (pending.status !== "confirmation") {
      throw new Error("Expected workout-log field confirmation");
    }
    await first.shutdown();

    const restarted = createScenarioHarness({
      ...options,
      extractionRuntime: new ControlledExtractionRuntime([]),
    });
    const recorded = await restarted.confirmWorkoutLog({
      confirmationId: pending.confirmationId,
      values: {
        "exercises[1].load.value": {
          kind: "kg",
          value: 26,
          unit: "kg",
          raw: "26",
        },
      },
    });

    expect(recorded).toMatchObject({
      status: "recorded",
      observation: {
        provenance: {
          runId: "workout-confirmation-restart-1",
          confirmedFields: ["exercises[1].load.value"],
        },
      },
    });
    await restarted.shutdown();
  });

  it("keeps bodyweight and exercise variants distinct from missing load", async () => {
    const candidate = completedTorsoPage();
    candidate.stage = field(3);
    candidate.week = field(9);
    candidate.sessionType = field("torso");
    candidate.exercises = [
      {
        rawLabel: field("引体向上"),
        exerciseId: field("pull-up"),
        load: field({ kind: "bodyweight", raw: "徒手" }),
        sets: [field(10)],
        actionQuality: field("高"),
        problemNote: field(null),
      },
      {
        rawLabel: field("俯卧撑"),
        exerciseId: field("push-up"),
        load: field({ kind: "variant", variant: "kneeling", raw: "跪姿" }),
        sets: [field(12)],
        actionQuality: field("中"),
        problemNote: field(null),
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
              confidence: "high",
            },
          }),
          expect.objectContaining({
            load: {
              value: { kind: "variant", variant: "kneeling", raw: "跪姿" },
              confidence: "high",
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

  it("rejects a low-confidence field that is not routed to confirmation", async () => {
    const candidate = completedTorsoPage();
    candidate.exercises[0]!.sets[0] = field(8, "low");
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
        runId: "workout-unrouted-low-confidence",
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
    layout: field("zhuoshu-three-stage-workbook"),
    stage: field(2),
    week: field(7),
    weekday: field("thursday"),
    sessionType: field("torso"),
    exercises: [
      {
        rawLabel: field("引体向上"),
        exerciseId: field("pull-up"),
        load: field(
          {
            kind: "assistance",
            mode: "resistance-band",
            raw: "红色弹力带",
          },
        ),
        sets: [field(8), field(7)],
        actionQuality: field("中"),
        problemNote: field(null),
      },
      {
        rawLabel: field("哑铃卧推"),
        exerciseId: field("dumbbell-bench-press"),
        load: field(
          { kind: "kg", value: 24, unit: "kg", raw: "24" },
        ),
        sets: [field(9), field(null)],
        actionQuality: field("高"),
        problemNote: field("右侧略晃"),
      },
      {
        rawLabel: field("平板支撑"),
        exerciseId: field("plank"),
        load: field({ kind: "none", raw: "-" }),
        sets: [field(60), field(null)],
        actionQuality: field(null),
        problemNote: field(null),
      },
    ],
    uncertainFields: [],
  };
}

function plannedTorsoPage(): ReturnType<typeof completedTorsoPage> {
  const candidate = completedTorsoPage();
  candidate.exercises.splice(2, 0, {
    rawLabel: field("哑铃推肩"),
    exerciseId: field("dumbbell-overhead-press"),
    load: field({ kind: "kg", value: 12, unit: "kg", raw: "12" }),
    sets: [field(10), field(9), field(8)],
    actionQuality: field("中"),
    problemNote: field(null),
  });
  return candidate;
}

function field<T>(value: T, confidence: "high" | "low" = "high") {
  return { value, confidence };
}

function temporaryDirectory(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  temporaryRoots.push(directory);
  return directory;
}

function filesUnder(root: string): string[] {
  try {
    return readdirSync(root, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => join(entry.parentPath, entry.name))
      .sort();
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
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
