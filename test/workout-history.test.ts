import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { parse } from "yaml";

import {
  ControlledExtractionRuntime,
  createScenarioHarness,
} from "../src/scenario/harness.js";
import type { ConfigurationPreflightResult } from "../src/preflight.js";
import { rawMediaUploadFixture } from "./support/sanitized-media.js";
import { activateProgramFixture } from "./support/program-state.js";
import { workoutLogCandidate } from "./support/workout-log-candidate.js";

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("workout history", () => {
  it("returns the active Observation when the same artifact is uploaded after restart", async () => {
    const personalDataDirectory = temporaryDirectory("stella-personal-");
    const firstRuntime = new ControlledExtractionRuntime([
      { parsed: workoutLogCandidate(), metadata: { provider: "controlled" } },
    ]);
    const first = await harness(personalDataDirectory, firstRuntime)
      .ingestWorkoutLog(request("first-upload"));
    if (first.status !== "recorded") {
      throw new Error("Expected the first workout log to be recorded");
    }

    const retryRuntime = new ControlledExtractionRuntime([]);
    const retry = await harness(personalDataDirectory, retryRuntime)
      .ingestWorkoutLog(request("retried-upload"));

    expect(retry).toMatchObject({
      status: "recorded",
      observation: { id: first.observation.id },
    });
    expect(retryRuntime.requests).toEqual([]);
    expect(
      readdirSync(join(personalDataDirectory, "observations", "workout-log")),
    ).toHaveLength(1);
  });

  it("keeps one active Observation when a different artifact describes the same logical workout", async () => {
    const personalDataDirectory = temporaryDirectory("stella-personal-");
    const original = await harness(
      personalDataDirectory,
      new ControlledExtractionRuntime([
        { parsed: workoutLogCandidate(), metadata: { provider: "controlled" } },
      ]),
    ).ingestWorkoutLog(request("logical-original"));
    if (original.status !== "recorded") {
      throw new Error("Expected the original workout log to be recorded");
    }
    const reuploadRuntime = new ControlledExtractionRuntime([
      { parsed: workoutLogCandidate(), metadata: { provider: "controlled" } },
    ]);

    const reupload = await harness(personalDataDirectory, reuploadRuntime)
      .ingestWorkoutLog({
        ...request("logical-reupload"),
        upload: rawMediaUploadFixture(
          Buffer.concat([rawMediaUploadFixture().bytes, Buffer.from([0])]),
        ),
      });

    expect(reupload).toMatchObject({
      status: "recorded",
      observation: { id: original.observation.id },
    });
    expect(reuploadRuntime.requests).toHaveLength(1);
    expect(
      readdirSync(join(personalDataDirectory, "observations", "workout-log")),
    ).toHaveLength(1);
  });

  it("records explicit correction lineage and rebuilds the view from the correction", async () => {
    const personalDataDirectory = temporaryDirectory("stella-personal-");
    const original = await harness(
      personalDataDirectory,
      new ControlledExtractionRuntime([
        { parsed: workoutLogCandidate(), metadata: { provider: "controlled" } },
      ]),
    ).ingestWorkoutLog(request("correction-original"));
    if (original.status !== "recorded") {
      throw new Error("Expected the original workout log to be recorded");
    }
    const correctedCandidate = workoutLogCandidate();
    correctedCandidate.exercises[0]!.sets[0]!.value = 12;
    const correctionHarness = harness(
      personalDataDirectory,
      new ControlledExtractionRuntime([
        { parsed: correctedCandidate, metadata: { provider: "controlled" } },
      ]),
    );

    const corrected = await correctionHarness.correctWorkoutLog({
      ...request("correction-reupload"),
      replacesObservationId: original.observation.id,
      upload: {
        ...rawMediaUploadFixture(
          Buffer.concat([rawMediaUploadFixture().bytes, Buffer.from([1])]),
        ),
        receivedAt: "2026-08-12T08:00:00.000Z",
      },
    });
    if (corrected.status !== "recorded") {
      throw new Error("Expected the corrected workout log to be recorded");
    }

    expect(corrected.observation).toMatchObject({
      id: expect.not.stringMatching(original.observation.id),
      exercises: expect.arrayContaining([
        expect.objectContaining({
          sets: expect.arrayContaining([expect.objectContaining({ value: 12 })]),
        }),
      ]),
      provenance: {
        kind: "workout-log-correction",
        replacesObservationId: original.observation.id,
      },
      occurredAt: original.observation.occurredAt,
    });
    await expect(correctionHarness.trainingRecordView()).resolves.toMatchObject({
      records: [
        {
          observation: {
            id: corrected.observation.id,
            exercises: expect.arrayContaining([
              expect.objectContaining({
                sets: expect.arrayContaining([
                  expect.objectContaining({ value: 12 }),
                ]),
              }),
            ]),
          },
        },
      ],
      errors: [],
    });
    expect(
      readdirSync(join(personalDataDirectory, "observations", "workout-log")),
    ).toHaveLength(2);
  });

  it("deduplicates the same correction retry after restart", async () => {
    const personalDataDirectory = temporaryDirectory("stella-personal-");
    const original = await harness(
      personalDataDirectory,
      new ControlledExtractionRuntime([
        { parsed: workoutLogCandidate(), metadata: { provider: "controlled" } },
      ]),
    ).ingestWorkoutLog(request("correction-retry-original"));
    if (original.status !== "recorded") {
      throw new Error("Expected the original workout log to be recorded");
    }
    const correctedCandidate = workoutLogCandidate();
    correctedCandidate.exercises[0]!.sets[0]!.value = 12;
    const correctionRequest = {
      ...request("stable-correction-run"),
      replacesObservationId: original.observation.id,
      upload: rawMediaUploadFixture(
        Buffer.concat([rawMediaUploadFixture().bytes, Buffer.from([2])]),
      ),
    };
    const corrected = await harness(
      personalDataDirectory,
      new ControlledExtractionRuntime([
        { parsed: correctedCandidate, metadata: { provider: "controlled" } },
      ]),
    ).correctWorkoutLog(correctionRequest);
    if (corrected.status !== "recorded") {
      throw new Error("Expected the corrected workout log to be recorded");
    }
    const retryRuntime = new ControlledExtractionRuntime([]);

    const retry = await harness(personalDataDirectory, retryRuntime)
      .correctWorkoutLog(correctionRequest);

    expect(retry).toMatchObject({
      status: "recorded",
      observation: { id: corrected.observation.id },
    });
    expect(retryRuntime.requests).toEqual([]);
    expect(
      readdirSync(join(personalDataDirectory, "observations", "workout-log")),
    ).toHaveLength(2);
  });

  it("removes an externally deleted Observation from the active view without restoring a runtime copy", async () => {
    const personalDataDirectory = temporaryDirectory("stella-personal-");
    const runtimeDirectory = temporaryDirectory("stella-runtime-");
    const scenario = harness(
      personalDataDirectory,
      new ControlledExtractionRuntime([
        { parsed: workoutLogCandidate(), metadata: { provider: "controlled" } },
      ]),
      runtimeDirectory,
    );
    const recorded = await scenario.ingestWorkoutLog(request("delete-active"));
    if (recorded.status !== "recorded") {
      throw new Error("Expected the workout log to be recorded");
    }
    const observationFile = join(
      personalDataDirectory,
      "observations",
      "workout-log",
      `${recorded.observation.id}.json`,
    );
    writeFileSync(
      join(runtimeDirectory, "cached-observation.json"),
      readFileSync(observationFile),
    );
    rmSync(observationFile);

    await expect(scenario.trainingRecordView()).resolves.toEqual({
      schemaVersion: "stella-fitness/view/training-record/v0.1",
      records: [],
      errors: [],
    });
  });

  it("reports and excludes a schema-invalid manual edit", async () => {
    const personalDataDirectory = temporaryDirectory("stella-personal-");
    const scenario = harness(
      personalDataDirectory,
      new ControlledExtractionRuntime([
        { parsed: workoutLogCandidate(), metadata: { provider: "controlled" } },
      ]),
    );
    const recorded = await scenario.ingestWorkoutLog(request("invalid-edit"));
    if (recorded.status !== "recorded") {
      throw new Error("Expected the workout log to be recorded");
    }
    const relativeFile = join(
      "observations",
      "workout-log",
      `${recorded.observation.id}.json`,
    );
    const canonicalFile = join(personalDataDirectory, relativeFile);
    writeFileSync(
      canonicalFile,
      `${JSON.stringify({
        ...recorded.observation,
        stage: { value: 99, confidence: "high" },
      })}\n`,
    );

    await expect(scenario.trainingRecordView()).resolves.toEqual({
      schemaVersion: "stella-fitness/view/training-record/v0.1",
      records: [],
      errors: [
        {
          file: relativeFile,
          message: "Workout-log Observation is schema-invalid",
        },
      ],
    });
    expect(JSON.parse(readFileSync(canonicalFile, "utf8"))).toMatchObject({
      stage: { value: 99 },
    });
  });

  it("rebuilds canonical history after the Runtime Directory is deleted", async () => {
    const personalDataDirectory = temporaryDirectory("stella-personal-");
    const runtimeDirectory = temporaryDirectory("stella-runtime-");
    const scenario = harness(
      personalDataDirectory,
      new ControlledExtractionRuntime([
        { parsed: workoutLogCandidate(), metadata: { provider: "controlled" } },
      ]),
      runtimeDirectory,
    );
    const recorded = await scenario.ingestWorkoutLog(request("runtime-loss"));
    if (recorded.status !== "recorded") {
      throw new Error("Expected the workout log to be recorded");
    }
    mkdirSync(join(runtimeDirectory, "indexes"));
    writeFileSync(join(runtimeDirectory, "indexes", "training.json"), "{}\n");
    rmSync(runtimeDirectory, { recursive: true, force: true });

    await expect(scenario.trainingRecordView()).resolves.toMatchObject({
      records: [{ observation: { id: recorded.observation.id } }],
      errors: [],
    });
  });

  it("keeps an Observation active but reports source_missing after raw artifact deletion", async () => {
    const personalDataDirectory = temporaryDirectory("stella-personal-");
    const scenario = harness(
      personalDataDirectory,
      new ControlledExtractionRuntime([
        { parsed: workoutLogCandidate(), metadata: { provider: "controlled" } },
      ]),
    );
    const recorded = await scenario.ingestWorkoutLog(request("missing-source"));
    if (recorded.status !== "recorded") {
      throw new Error("Expected the workout log to be recorded");
    }
    rmSync(join(personalDataDirectory, recorded.observation.source.path));

    await expect(scenario.trainingRecordView()).resolves.toMatchObject({
      records: [
        {
          observation: { id: recorded.observation.id },
          sourceStatus: "source_missing",
        },
      ],
      errors: [],
    });
  });

  it("keeps the same week and weekday distinct across program cycles", async () => {
    const personalDataDirectory = temporaryDirectory("stella-personal-");
    const firstCycle = harness(
      personalDataDirectory,
      new ControlledExtractionRuntime([
        { parsed: plannedWorkoutLogCandidate(), metadata: { provider: "controlled" } },
      ]),
    );
    await activateProgramFixture({ personalDataDirectory, programSpec: programFixture() });
    await firstCycle.ingestWorkoutLog(request("cycle-one-workout"));
    const statePath = join(personalDataDirectory, "program", "state.json");
    const state = JSON.parse(readFileSync(statePath, "utf8")) as {
      cycle: { startDate: string };
    };
    state.cycle.startDate = "2026-11-02";
    writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
    const secondCycle = harness(
      personalDataDirectory,
      new ControlledExtractionRuntime([
        { parsed: plannedWorkoutLogCandidate(), metadata: { provider: "controlled" } },
      ]),
    );

    await secondCycle.ingestWorkoutLog({
      ...request("cycle-two-workout"),
      upload: rawMediaUploadFixture(
        Buffer.concat([rawMediaUploadFixture().bytes, Buffer.from([3])]),
      ),
    });

    await expect(secondCycle.trainingRecordView()).resolves.toMatchObject({
      records: [
        { observation: { programContext: { cycleStart: "2026-08-10" } } },
        { observation: { programContext: { cycleStart: "2026-11-02" } } },
      ],
      errors: [],
    });
  });

  it("deduplicates a re-upload after the original Raw Artifact directory was deleted", async () => {
    const personalDataDirectory = temporaryDirectory("stella-personal-");
    const recorded = await harness(
      personalDataDirectory,
      new ControlledExtractionRuntime([
        { parsed: workoutLogCandidate(), metadata: { provider: "controlled" } },
      ]),
    ).ingestWorkoutLog(request("deleted-artifact-original"));
    if (recorded.status !== "recorded") {
      throw new Error("Expected the workout log to be recorded");
    }
    rmSync(
      join(personalDataDirectory, dirname(recorded.observation.source.path)),
      { recursive: true, force: true },
    );
    const retryRuntime = new ControlledExtractionRuntime([]);

    const retry = await harness(personalDataDirectory, retryRuntime)
      .ingestWorkoutLog(request("deleted-artifact-reupload"));

    expect(retry).toMatchObject({
      status: "recorded",
      observation: {
        id: recorded.observation.id,
        source: { path: expect.not.stringMatching(recorded.observation.source.path) },
        sourceHistory: [
          expect.objectContaining({
            path: recorded.observation.source.path,
            runId: "deleted-artifact-reupload",
          }),
        ],
      },
    });
    expect(retryRuntime.requests).toEqual([]);
    await expect(
      harness(personalDataDirectory, new ControlledExtractionRuntime([]))
        .trainingRecordView(),
    ).resolves.toMatchObject({
      records: [
        {
          observation: { id: recorded.observation.id },
          sourceStatus: "available",
        },
      ],
      errors: [],
    });
  });

  it("isolates a malformed plannedSession manual edit", async () => {
    const personalDataDirectory = temporaryDirectory("stella-personal-");
    const scenario = harness(
      personalDataDirectory,
      new ControlledExtractionRuntime([
        { parsed: workoutLogCandidate(), metadata: { provider: "controlled" } },
      ]),
    );
    const recorded = await scenario.ingestWorkoutLog(request("invalid-session"));
    if (recorded.status !== "recorded") {
      throw new Error("Expected the workout log to be recorded");
    }
    const relativeFile = join(
      "observations",
      "workout-log",
      `${recorded.observation.id}.json`,
    );
    writeFileSync(
      join(personalDataDirectory, relativeFile),
      `${JSON.stringify({
        ...recorded.observation,
        schemaVersion:
          "stella-fitness/observation/workout-recovery-session/v0.1",
        kind: "workout-recovery-session",
        plannedSession: { recovery: true },
      })}\n`,
    );

    await expect(scenario.trainingRecordView()).resolves.toEqual({
      schemaVersion: "stella-fitness/view/training-record/v0.1",
      records: [],
      errors: [
        {
          file: relativeFile,
          message: "Workout-log Observation is schema-invalid",
        },
      ],
    });
  });

  it("isolates a Raw Artifact whose bytes no longer match its hash", async () => {
    const personalDataDirectory = temporaryDirectory("stella-personal-");
    const scenario = harness(
      personalDataDirectory,
      new ControlledExtractionRuntime([
        { parsed: workoutLogCandidate(), metadata: { provider: "controlled" } },
      ]),
    );
    const recorded = await scenario.ingestWorkoutLog(request("changed-artifact"));
    if (recorded.status !== "recorded") {
      throw new Error("Expected the workout log to be recorded");
    }
    writeFileSync(
      join(personalDataDirectory, recorded.observation.source.path),
      "changed bytes",
    );

    await expect(scenario.trainingRecordView()).resolves.toMatchObject({
      records: [],
      errors: [
        {
          file: join(
            "observations",
            "workout-log",
            `${recorded.observation.id}.json`,
          ),
          message: "Workout-log Observation has invalid Raw Artifact reference",
        },
      ],
    });
  });
});

function harness(
  personalDataDirectory: string,
  extractionRuntime: ControlledExtractionRuntime,
  runtimeDirectory = temporaryDirectory("stella-runtime-"),
) {
  return createScenarioHarness({
    extractionRuntime,
    personalDataDirectory: () => personalDataDirectory,
    runtimeDirectory: () => runtimeDirectory,
    preflight: (): ConfigurationPreflightResult => ({
      readiness: "READY",
      reasons: [],
    }),
  });
}

function request(runId: string) {
  return {
    runId,
    upload: rawMediaUploadFixture(),
    timeoutMs: 2_000,
  };
}

function temporaryDirectory(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  temporaryRoots.push(directory);
  return directory;
}

function programFixture(): unknown {
  return parse(
    readFileSync(
      join(
        process.cwd(),
        "knowledge",
        "programs",
        "zhuoshu-12-week",
        "program-spec.v0.2.yaml",
      ),
      "utf8",
    ),
  );
}

function plannedWorkoutLogCandidate() {
  const candidate = workoutLogCandidate();
  return {
    ...candidate,
    exercises: [
      ...candidate.exercises,
      workoutExercise("哑铃卧推", "dumbbell-bench-press"),
      workoutExercise("哑铃硬拉", "dumbbell-deadlift"),
      {
        ...workoutExercise("平板支撑", "plank"),
        load: field({ kind: "none", raw: "-" }),
      },
    ],
  };
}

function workoutExercise(rawLabel: string, exerciseId: string) {
  return {
    rawLabel: field(rawLabel),
    exerciseId: field(exerciseId),
    load: field({ kind: "kg", value: 20, unit: "kg", raw: "20" }),
    sets: [field(10), field(null)],
    actionQuality: field("高"),
    problemNote: field(null),
  };
}

function field<T>(value: T) {
  return { value, confidence: "high" as const };
}
