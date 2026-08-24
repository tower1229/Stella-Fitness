import {
  linkSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { parse } from "yaml";

import { publishFitnessContextProjection } from "../src/plugin.js";
import { parseWorkoutLogCandidate } from "../src/extraction/candidate.js";
import { readActiveProgram } from "../src/program/state.js";
import {
  persistBodyWeightCorrection,
  persistBodyWeightObservation,
} from "../src/storage/body-weight.js";
import { persistWorkoutLogObservation } from "../src/storage/workout-log.js";
import { activateProgramFixture } from "./support/program-state.js";
import { workoutLogCandidate } from "./support/workout-log-candidate.js";

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("Fitness Projection Publisher", () => {
  it("publishes one immutable complete desired set and reuses it on retry", async () => {
    const repository = temporaryRepository();
    const personalDataDirectory = join(repository, "stella", "fitness");
    const observation = await persistBodyWeightObservation({
      personalDataDirectory,
      amount: 68.4,
      unit: "kg",
      occurredAt: "2026-08-23T23:00:00.000Z",
      recordedAt: "2026-08-24T00:00:00.000Z",
      source: {
        kind: "user-text",
        text: "这是不能进入投影的个人原文：今天体重 68.4 kg",
        channel: "test",
        messageId: "weight-1",
      },
    });

    const first = await publishFitnessContextProjection({
      openclawConfig: locatorConfig(repository),
      generatedAt: "2026-08-24T00:01:00.000Z",
    });
    const activePath = join(
      repository,
      "stella",
      "projections",
      "stella",
      "active.json",
    );
    const firstPointerBytes = readFileSync(activePath);
    const pointer = JSON.parse(firstPointerBytes.toString("utf8")) as {
      projection_revision: string;
      source_revision: string;
      manifest_checksum: string;
    };
    const revisionDirectory = join(
      repository,
      "stella",
      "projections",
      "stella",
      "revisions",
      pointer.projection_revision,
    );
    const manifest = JSON.parse(
      readFileSync(join(revisionDirectory, "manifest.json"), "utf8"),
    ) as {
      capabilities: readonly { id: string; state: string }[];
      source_references: readonly { id: string; path: string }[];
    };
    const desiredSetBytes = readFileSync(
      join(revisionDirectory, "payloads", "fitness-history.json"),
    );
    const desiredSet = JSON.parse(desiredSetBytes.toString("utf8")) as {
      authoritative: boolean;
      documents: readonly {
        id: string;
        category: string;
        facts: Readonly<Record<string, unknown>>;
      }[];
    };

    expect(first).toMatchObject({ status: "published", reusedRevision: false });
    expect(pointer.projection_revision).toBe(first.projectionRevision);
    expect(pointer.source_revision).toBe(first.sourceRevision);
    expect(manifest.capabilities).toEqual([
      { id: "current_fitness_state", state: "unavailable" },
      { id: "fitness_history_context", state: "available" },
    ]);
    expect(manifest.source_references).toEqual([
      {
        id: `body-weight-${observation.id}`,
        path: `fitness/observations/body-weight/${observation.id}.json`,
        revision: expect.stringMatching(/^source-[a-f0-9]{64}$/u),
        checksum: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
      },
    ]);
    expect(desiredSet).toEqual({
      schema_version: "stella-fitness/fitness-history-context/v1",
      authoritative: false,
      source_revision: pointer.source_revision,
      source_as_of: "2026-08-24T00:00:00.000Z",
      documents: [{
        id: `body-weight:${observation.id}`,
        category: "body-weight",
        source_reference_ids: [`body-weight-${observation.id}`],
        facts: {
          amount: 68.4,
          occurred_at: "2026-08-23T23:00:00.000Z",
          unit: "kg",
        },
      }],
    });
    expect(desiredSetBytes.toString("utf8")).not.toContain("个人原文");

    const retry = await publishFitnessContextProjection({
      openclawConfig: locatorConfig(repository),
      generatedAt: "2026-08-24T12:00:00.000Z",
    });

    expect(retry).toMatchObject({
      status: "published",
      reusedRevision: true,
      projectionRevision: first.projectionRevision,
      sourceRevision: first.sourceRevision,
    });
    expect(readFileSync(activePath)).toEqual(firstPointerBytes);
  });

  it("publishes allowlisted Program and workout history without raw artifacts or personal text", async () => {
    const repository = temporaryRepository();
    const personalDataDirectory = join(repository, "stella", "fitness");
    const state = await activateProgramFixture({
      personalDataDirectory,
      programSpec: programFixture(),
      cycleStart: "2026-08-10",
    });
    const active = await readActiveProgram({ personalDataDirectory });
    const parsedCandidate = parseWorkoutLogCandidate(workoutLogCandidate());
    if (!("exercises" in parsedCandidate)) throw new Error("Expected workout");
    const candidate = {
      ...parsedCandidate,
      exercises: parsedCandidate.exercises.map((exercise, index) =>
        index === 0
          ? {
              ...exercise,
              problemNote: {
                value: "不能投影的私人训练备注",
                confidence: "high" as const,
              },
            }
          : exercise
      ),
    };
    const persisted = await persistWorkoutLogObservation({
      personalDataDirectory,
      candidate,
      artifact: {
        schemaVersion: "stella-fitness/raw-artifact/v0.1",
        id: "00000000-0000-4000-8000-000000000101",
        kind: "workout-log-image",
        path: "raw-artifacts/workout-log/00000000-0000-4000-8000-000000000101/original.png",
        sha256: "a".repeat(64),
        size: 123,
        originalFileName: "private-workout.png",
        mime: "image/png",
        provenance: {
          kind: "openclaw-media",
          receivedAt: "2026-08-10T08:00:00.000Z",
          channel: "test",
          messageId: "workout-1",
        },
      },
      runId: "publisher-workout-1",
      recordedAt: "2026-08-10T08:01:00.000Z",
      programContext: {
        stateId: state.id,
        programId: active.program.id,
        programVersion: active.program.version,
        cycleStart: state.cycle.startDate,
      },
    });

    const result = await publishFitnessContextProjection({
      openclawConfig: locatorConfig(repository),
      generatedAt: "2026-08-24T00:01:00.000Z",
    });
    const payloadPath = join(
      repository,
      "stella",
      "projections",
      "stella",
      "revisions",
      result.projectionRevision,
      "payloads",
      "fitness-history.json",
    );
    const payloadBytes = readFileSync(payloadPath);
    const searchPayloadBytes = readFileSync(join(
      dirname(payloadPath),
      "fitness-history.md",
    ));
    const payload = JSON.parse(payloadBytes.toString("utf8")) as {
      documents: readonly {
        id: string;
        category: string;
        facts: Readonly<Record<string, unknown>>;
      }[];
    };

    expect(payload.documents).toEqual([
      {
        id: `program:${state.id}`,
        category: "program",
        source_reference_ids: [
          `program-spec-${state.id}`,
          `program-state-${state.id}`,
        ],
        facts: {
          cycle_start: "2026-08-10",
          program_id: "zhuoshu-12-week",
          program_version: "0.2.0",
        },
      },
      {
        id: `workout:${persisted.observation.id}`,
        category: "workout",
        source_reference_ids: [`workout-${persisted.observation.id}`],
        facts: {
          exercises: [{
            exercise_id: "goblet-squat",
            load: { kind: "kg", unit: "kg", value: 20 },
            sets: [
              { semantic: "repetitions", value: 10 },
              { semantic: "repetitions", value: null },
            ],
          }],
          occurred_at: "2026-08-10T08:00:00.000Z",
          session_type: "full-body",
          stage: 1,
          week: 1,
          weekday: "monday",
        },
      },
    ]);
    expect(payloadBytes.toString("utf8")).not.toMatch(
      /raw-artifacts|private-workout|私人训练备注|messageId|problemNote|actionQuality/u,
    );
    expect(searchPayloadBytes.toString("utf8")).not.toMatch(
      /raw-artifacts|private-workout|私人训练备注|messageId|problemNote|actionQuality/u,
    );
    expect(searchPayloadBytes.toString("utf8")).toMatch(/[^\n]\n$/u);
    expect(searchPayloadBytes.toString("utf8")).not.toContain("\r");
  });

  it("holds an exclusive publish lock across concurrent producers", async () => {
    const repository = temporaryRepository();
    const personalDataDirectory = join(repository, "stella", "fitness");
    await persistBodyWeightObservation({
      personalDataDirectory,
      amount: 68.4,
      unit: "kg",
      occurredAt: "2026-08-23T23:00:00.000Z",
      recordedAt: "2026-08-24T00:00:00.000Z",
      source: { kind: "user-text", text: "68.4 kg" },
    });
    let releaseFirst!: () => void;
    const firstMayContinue = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let lockAcquired!: () => void;
    const firstHasLock = new Promise<void>((resolve) => {
      lockAcquired = resolve;
    });
    const first = publishFitnessContextProjection({
      openclawConfig: locatorConfig(repository),
      generatedAt: "2026-08-24T00:01:00.000Z",
      testHooks: {
        async afterLock() {
          lockAcquired();
          await firstMayContinue;
        },
      },
    });
    await firstHasLock;

    await expect(publishFitnessContextProjection({
      openclawConfig: locatorConfig(repository),
      generatedAt: "2026-08-24T00:01:01.000Z",
    })).rejects.toThrow("FITNESS_PROJECTION_LOCKED");

    releaseFirst();
    await expect(first).resolves.toMatchObject({ status: "published" });
    expect(
      readFileSync(join(
        repository,
        "stella",
        "projections",
        "stella",
        "active.json",
      )),
    ).toBeTruthy();
  });

  it.each([
    ["locked", false],
    ["candidate-written", false],
    ["revision-renamed", true],
    ["pointer-replaced", true],
    ["committed", true],
  ] as const)("recovers a dead owner after the %s crash phase", async (
    phase,
    reusedRevision,
  ) => {
    const repository = temporaryRepository();
    const personalDataDirectory = join(repository, "stella", "fitness");
    await persistBodyWeightObservation({
      personalDataDirectory,
      amount: 68.4,
      unit: "kg",
      occurredAt: "2026-08-23T23:00:00.000Z",
      recordedAt: "2026-08-24T00:00:00.000Z",
      source: { kind: "user-text", text: "68.4 kg" },
    });
    const firstNow = new Date("2026-08-24T01:00:00.000Z");

    await expect(publishFitnessContextProjection({
      openclawConfig: locatorConfig(repository),
      generatedAt: "2026-08-24T00:01:00.000Z",
      testHooks: {
        crashAfterPhase: phase,
        now: () => firstNow,
      },
    })).rejects.toThrow(`SIMULATED_FITNESS_PROJECTION_CRASH:${phase}`);

    const recovered = await publishFitnessContextProjection({
      openclawConfig: locatorConfig(repository),
      generatedAt: "2026-08-24T00:01:00.000Z",
      testHooks: {
        now: () => new Date("2026-08-24T01:01:00.000Z"),
        isProcessAlive: () => false,
      },
    });

    expect(recovered).toMatchObject({ status: "published", reusedRevision });
    const publicationRoot = join(
      repository,
      "stella",
      "projections",
      "stella",
    );
    expect(readdirSync(publicationRoot)).not.toContain(".publish.lock");
    expect(readdirSync(join(publicationRoot, "revisions"))).toEqual([
      recovered.projectionRevision,
    ]);
  });

  it("rejects a canonical source that changes while the desired set is built", async () => {
    const repository = temporaryRepository();
    const personalDataDirectory = join(repository, "stella", "fitness");
    const observation = await persistBodyWeightObservation({
      personalDataDirectory,
      amount: 68.4,
      unit: "kg",
      occurredAt: "2026-08-23T23:00:00.000Z",
      recordedAt: "2026-08-24T00:00:00.000Z",
      source: { kind: "user-text", text: "68.4 kg" },
    });
    const observationPath = join(
      personalDataDirectory,
      "observations",
      "body-weight",
      `${observation.id}.json`,
    );

    await expect(publishFitnessContextProjection({
      openclawConfig: locatorConfig(repository),
      testHooks: {
        afterSourceSnapshot() {
          const changed = JSON.parse(readFileSync(observationPath, "utf8")) as {
            source: { text: string };
          };
          changed.source.text = "source changed during build";
          writeFileSync(observationPath, `${JSON.stringify(changed, null, 2)}\n`);
        },
      },
    })).rejects.toThrow("FITNESS_PROJECTION_SOURCE_CHANGED");
    expect(readdirSync(join(repository, "stella", "projections", "stella")))
      .toEqual([]);
  });

  it.each(["symlink", "hardlink", "oversize"] as const)(
    "rejects a %s canonical source before publication",
    async (attack) => {
      const repository = temporaryRepository();
      const personalDataDirectory = join(repository, "stella", "fitness");
      const observation = await persistBodyWeightObservation({
        personalDataDirectory,
        amount: 68.4,
        unit: "kg",
        occurredAt: "2026-08-23T23:00:00.000Z",
        recordedAt: "2026-08-24T00:00:00.000Z",
        source: { kind: "user-text", text: "68.4 kg" },
      });
      const observationPath = join(
        personalDataDirectory,
        "observations",
        "body-weight",
        `${observation.id}.json`,
      );
      const outside = join(repository, "outside.json");
      writeFileSync(outside, readFileSync(observationPath));
      if (attack === "symlink") {
        unlinkSync(observationPath);
        symlinkSync(outside, observationPath);
      } else if (attack === "hardlink") {
        unlinkSync(observationPath);
        linkSync(outside, observationPath);
      } else {
        writeFileSync(observationPath, Buffer.alloc(1_048_577, 0x20));
      }

      await expect(publishFitnessContextProjection({
        openclawConfig: locatorConfig(repository),
      })).rejects.toThrow(
        attack === "oversize"
          ? "FITNESS_PROJECTION_SOURCE_OVERSIZE"
          : "FITNESS_PROJECTION_SOURCE_PATH_INVALID",
      );
    },
  );

  it("rejects projection path escape and immutable revision tamper", async () => {
    const escapedRepository = temporaryRepository();
    const escapedTarget = join(
      escapedRepository,
      "stella",
      "projections",
      "stella",
    );
    const outside = mkdtempSync(join(tmpdir(), "stella-projection-outside-"));
    temporaryRoots.push(outside);
    rmSync(escapedTarget, { recursive: true });
    symlinkSync(outside, escapedTarget);
    await expect(publishFitnessContextProjection({
      openclawConfig: locatorConfig(escapedRepository),
    })).rejects.toThrow("FITNESS_PROJECTION_PATH_INVALID");

    const repository = temporaryRepository();
    const personalDataDirectory = join(repository, "stella", "fitness");
    await persistBodyWeightObservation({
      personalDataDirectory,
      amount: 68.4,
      unit: "kg",
      occurredAt: "2026-08-23T23:00:00.000Z",
      recordedAt: "2026-08-24T00:00:00.000Z",
      source: { kind: "user-text", text: "68.4 kg" },
    });
    const published = await publishFitnessContextProjection({
      openclawConfig: locatorConfig(repository),
      generatedAt: "2026-08-24T00:01:00.000Z",
    });
    writeFileSync(join(
      repository,
      "stella",
      "projections",
      "stella",
      "revisions",
      published.projectionRevision,
      "payloads",
      "fitness-history.json",
    ), "{}", "utf8");

    await expect(publishFitnessContextProjection({
      openclawConfig: locatorConfig(repository),
      generatedAt: "2026-08-24T00:01:00.000Z",
    })).rejects.toThrow("FITNESS_PROJECTION_REVISION_TAMPERED");
  });

  it("replaces the prior domain desired set after a canonical correction", async () => {
    const repository = temporaryRepository();
    const personalDataDirectory = join(repository, "stella", "fitness");
    const original = await persistBodyWeightObservation({
      personalDataDirectory,
      amount: 68.4,
      unit: "kg",
      occurredAt: "2026-08-23T23:00:00.000Z",
      recordedAt: "2026-08-24T00:00:00.000Z",
      source: { kind: "user-text", text: "68.4 kg", messageId: "original" },
    });
    const first = await publishFitnessContextProjection({
      openclawConfig: locatorConfig(repository),
      generatedAt: "2026-08-24T00:01:00.000Z",
    });
    const correction = await persistBodyWeightCorrection({
      personalDataDirectory,
      replacesObservationId: original.id,
      amount: 68.8,
      unit: "kg",
      source: { kind: "user-text", text: "改为 68.8 kg", messageId: "correction" },
      recordedAt: "2026-08-24T01:00:00.000Z",
    });

    const second = await publishFitnessContextProjection({
      openclawConfig: locatorConfig(repository),
      generatedAt: "2026-08-24T01:01:00.000Z",
    });
    const secondPayload = readFileSync(join(
      repository,
      "stella",
      "projections",
      "stella",
      "revisions",
      second.projectionRevision,
      "payloads",
      "fitness-history.json",
    ), "utf8");

    expect(second.projectionRevision).not.toBe(first.projectionRevision);
    expect(secondPayload).toContain(`body-weight:${correction.id}`);
    expect(secondPayload).not.toContain(`body-weight:${original.id}`);
  });
});

function temporaryRepository(): string {
  const repository = mkdtempSync(join(tmpdir(), "stella-projection-"));
  temporaryRoots.push(repository);
  mkdirSync(join(repository, "stella", "fitness"), {
    recursive: true,
    mode: 0o700,
  });
  mkdirSync(join(repository, "stella", "projections", "stella"), {
    recursive: true,
    mode: 0o700,
  });
  return repository;
}

function locatorConfig(repository: string): unknown {
  return {
    plugins: {
      entries: {
        "cognitive-runtime": {
          config: {
            runtime: { instance_id: "instance-fitness-test" },
            stella: {
              schema_version: "stella.personal-data-locator/v1",
              instance_id: "instance-fitness-test",
              personal_data_repository: repository,
            },
          },
        },
      },
    },
  };
}

function programFixture(): unknown {
  return parse(readFileSync(
    join(
      process.cwd(),
      "knowledge",
      "programs",
      "zhuoshu-12-week",
      "program-spec.v0.2.yaml",
    ),
    "utf8",
  ));
}
