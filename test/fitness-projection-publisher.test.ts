import {
  cpSync,
  existsSync,
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
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { parse } from "yaml";

import {
  inspectFitnessContextProjectionSource,
  publishFitnessContextProjection,
  publishFitnessContextProjectionPointerStatus,
  readFitnessContextProjectionPointer,
  restoreFitnessContextProjectionPointer,
} from "../src/plugin.js";
import { createFitnessContextSyncCoordinator } from "../src/context/sync-coordinator.js";
import { parseWorkoutLogCandidate } from "../src/extraction/candidate.js";
import { readActiveProgram } from "../src/program/state.js";
import {
  persistBodyWeightCorrection,
  persistBodyWeightDeletion,
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
      payloads: readonly {
        stable_id: string;
        path: string;
        media_type: string;
      }[];
    };
    const desiredSetText = readProjectionPayloadText(repository, first.projectionRevision);

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
    expect(manifest.payloads).toEqual([
      {
        stable_id: expect.stringMatching(/^fitness-history-[0-9]{2}$/u),
        path: expect.stringMatching(/^payloads\/fitness-history-[0-9]{2}\.md$/u),
        media_type: "text/markdown",
        byte_length: expect.any(Number),
        checksum: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
      },
    ]);
    expect(desiredSetText).toContain("authoritative: false");
    expect(desiredSetText).toContain(`source_revision: ${pointer.source_revision}`);
    expect(desiredSetText).toContain("source_as_of: 2026-08-24T00:00:00.000Z");
    expect(desiredSetText).toContain(`## body-weight:${observation.id}`);
    expect(desiredSetText).toContain("category: body-weight");
    expect(desiredSetText).toContain(
      `source_reference_ids: body-weight-${observation.id}`,
    );
    expect(desiredSetText).toContain(
      'facts: {"amount":68.4,"occurred_at":"2026-08-23T23:00:00.000Z","unit":"kg"}',
    );
    expect(desiredSetText).not.toContain("个人原文");

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
    const payloadText = readProjectionPayloadText(repository, result.projectionRevision);
    expect(payloadText).toContain(`## program:${state.id}`);
    expect(payloadText).toContain(
      'facts: {"cycle_start":"2026-08-10","program_id":"zhuoshu-12-week","program_version":"0.2.0"}',
    );
    expect(payloadText).toContain(`## workout:${persisted.observation.id}`);
    expect(payloadText).toContain(
      'facts: {"exercises":[{"exercise_id":"goblet-squat","load":{"kind":"kg","unit":"kg","value":20},"sets":[{"semantic":"repetitions","value":10},{"semantic":"repetitions","value":null}]}],"occurred_at":"2026-08-10T08:00:00.000Z","session_type":"full-body","stage":1,"week":1,"weekday":"monday"}',
    );
    expect(payloadText).not.toMatch(
      /raw-artifacts|private-workout|私人训练备注|messageId|problemNote|actionQuality/u,
    );
    expect(payloadText).toMatch(/[^\n]\n$/u);
    expect(payloadText).not.toContain("\r");
  });

  it("keeps a complete history in at most 32 stable index-document shards", async () => {
    const repository = temporaryRepository();
    const personalDataDirectory = join(repository, "stella", "fitness");
    const observationIds: string[] = [];
    for (let index = 0; index < 64; index += 1) {
      const occurredAt = new Date(Date.UTC(2026, 7, 23, 22, index)).toISOString();
      const recordedAt = new Date(Date.UTC(2026, 7, 23, 23, index)).toISOString();
      const observation = await persistBodyWeightObservation({
        personalDataDirectory,
        amount: 68 + index / 10,
        unit: "kg",
        occurredAt,
        recordedAt,
        source: { kind: "user-text", text: `${68 + index / 10} kg` },
      });
      observationIds.push(observation.id);
    }

    const published = await publishFitnessContextProjection({
      openclawConfig: locatorConfig(repository),
      generatedAt: "2026-08-24T02:00:00.000Z",
    });
    const manifest = readProjectionManifest(repository, published.projectionRevision);
    const payloadText = readProjectionPayloadText(repository, published.projectionRevision);

    expect(manifest.payloads.length).toBeLessThanOrEqual(32);
    expect(new Set(manifest.payloads.map(({ stable_id }) => stable_id)).size)
      .toBe(manifest.payloads.length);
    expect(manifest.payloads.every(({ stable_id, path, media_type, byte_length }) =>
      /^fitness-history-[0-9]{2}$/u.test(stable_id) &&
      path === `payloads/${stable_id}.md` &&
      media_type === "text/markdown" &&
      byte_length > 0 && byte_length <= 1_048_576
    )).toBe(true);
    for (const id of observationIds) {
      expect(payloadText.match(new RegExp(`## body-weight:${id}`, "gu"))).toHaveLength(1);
    }
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

  it("revalidates the source after taking the exclusive lock", async () => {
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
        afterLock() {
          const changed = JSON.parse(readFileSync(observationPath, "utf8")) as {
            source: { text: string };
          };
          changed.source.text = "source changed after lock";
          writeFileSync(observationPath, `${JSON.stringify(changed, null, 2)}\n`);
        },
      },
    })).rejects.toThrow("FITNESS_PROJECTION_SOURCE_CHANGED");
    expect(readdirSync(join(repository, "stella", "projections", "stella")))
      .toEqual([]);
  });

  it("recovers an old renamed revision before publishing changed source", async () => {
    const repository = temporaryRepository();
    const personalDataDirectory = join(repository, "stella", "fitness");
    const original = await persistBodyWeightObservation({
      personalDataDirectory,
      amount: 68.4,
      unit: "kg",
      occurredAt: "2026-08-23T23:00:00.000Z",
      recordedAt: "2026-08-24T00:00:00.000Z",
      source: { kind: "user-text", text: "68.4 kg" },
    });
    await expect(publishFitnessContextProjection({
      openclawConfig: locatorConfig(repository),
      generatedAt: "2026-08-24T00:01:00.000Z",
      testHooks: {
        crashAfterPhase: "revision-renamed",
        now: () => new Date("2026-08-24T01:00:00.000Z"),
      },
    })).rejects.toThrow("SIMULATED_FITNESS_PROJECTION_CRASH:revision-renamed");
    await persistBodyWeightCorrection({
      personalDataDirectory,
      replacesObservationId: original.id,
      amount: 68.8,
      unit: "kg",
      source: { kind: "user-text", text: "68.8 kg" },
      recordedAt: "2026-08-24T01:00:00.000Z",
    });

    const recovered = await publishFitnessContextProjection({
      openclawConfig: locatorConfig(repository),
      generatedAt: "2026-08-24T01:01:00.000Z",
      testHooks: {
        now: () => new Date("2026-08-24T01:01:00.000Z"),
        isProcessAlive: () => false,
      },
    });

    expect(recovered).toMatchObject({ status: "published", reusedRevision: false });
    expect(readdirSync(join(
      repository,
      "stella",
      "projections",
      "stella",
      "revisions",
    ))).toHaveLength(2);
  });

  it("removes a partial candidate left while the lock phase is still locked", async () => {
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
    await expect(publishFitnessContextProjection({
      openclawConfig: locatorConfig(repository),
      testHooks: {
        crashDuringCandidateWrite: true,
        now: () => new Date("2026-08-24T01:00:00.000Z"),
      },
    })).rejects.toThrow("SIMULATED_FITNESS_PROJECTION_CRASH:locked");

    const recovered = await publishFitnessContextProjection({
      openclawConfig: locatorConfig(repository),
      testHooks: {
        now: () => new Date("2026-08-24T01:01:00.000Z"),
        isProcessAlive: () => false,
      },
    });

    expect(readdirSync(join(
      repository,
      "stella",
      "projections",
      "stella",
      "revisions",
    ))).toEqual([recovered.projectionRevision]);
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

  it("rejects a detached cyclic 12RM correction lineage", async () => {
    const repository = temporaryRepository();
    const directory = join(
      repository,
      "stella",
      "fitness",
      "observations",
      "special-session",
    );
    mkdirSync(directory, { recursive: true });
    const firstId = "00000000-0000-4000-8000-000000000201";
    const secondId = "00000000-0000-4000-8000-000000000202";
    for (const [id, replacesObservationId, minute] of [
      [firstId, secondId, "00"],
      [secondId, firstId, "01"],
    ] as const) {
      writeFileSync(join(directory, `${id}.json`), `${JSON.stringify({
        schemaVersion: "stella-fitness/observation/course-start-12rm/v0.1",
        id,
        kind: "course-start-12rm",
        exerciseId: "goblet-squat",
        result: { test: "12RM", unit: "kg", value: 32 },
        occurredAt: `2026-08-24T00:${minute}:00.000Z`,
        source: { kind: "user-text", text: "32 kg" },
        provenance: {
          kind: "course-start-12rm-correction",
          confirmationId: `00000000-0000-4000-8000-0000000003${minute}`,
          recordedAt: `2026-08-24T00:${minute}:00.000Z`,
          replacesObservationId,
        },
      }, null, 2)}\n`);
    }

    await expect(publishFitnessContextProjection({
      openclawConfig: locatorConfig(repository),
    })).rejects.toThrow("FITNESS_PROJECTION_SOURCE_INVALID");
  });

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
    const publishedManifest = readProjectionManifest(repository, published.projectionRevision);
    writeFileSync(join(
      repository,
      "stella",
      "projections",
      "stella",
      "revisions",
      published.projectionRevision,
      publishedManifest.payloads[0]!.path,
    ), "{}", "utf8");

    await expect(publishFitnessContextProjection({
      openclawConfig: locatorConfig(repository),
      generatedAt: "2026-08-24T00:01:00.000Z",
    })).rejects.toThrow("FITNESS_PROJECTION_REVISION_TAMPERED");
  });

  it.each([
    "revision-symlink",
    "manifest-hardlink",
    "active-symlink",
    "active-hardlink",
  ] as const)(
    "rejects the %s immutable-boundary attack",
    async (attack) => {
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
      const revisionDirectory = join(
        repository,
        "stella",
        "projections",
        "stella",
        "revisions",
        published.projectionRevision,
      );
      const publicationRoot = join(repository, "stella", "projections", "stella");
      if (attack === "revision-symlink") {
        const outside = mkdtempSync(join(tmpdir(), "stella-revision-outside-"));
        temporaryRoots.push(outside);
        cpSync(revisionDirectory, outside, { recursive: true });
        rmSync(revisionDirectory, { recursive: true });
        symlinkSync(outside, revisionDirectory);
      } else if (attack === "manifest-hardlink") {
        const manifestPath = join(revisionDirectory, "manifest.json");
        const outside = join(repository, "manifest-hardlink.json");
        linkSync(manifestPath, outside);
      } else {
        const activePath = join(publicationRoot, "active.json");
        const outside = join(repository, `${attack}.json`);
        if (attack === "active-symlink") {
          writeFileSync(outside, readFileSync(activePath));
          unlinkSync(activePath);
          symlinkSync(outside, activePath);
        } else {
          linkSync(activePath, outside);
        }
      }

      await expect(publishFitnessContextProjection({
        openclawConfig: locatorConfig(repository),
        generatedAt: "2026-08-24T00:01:00.000Z",
      })).rejects.toThrow("FITNESS_PROJECTION_REVISION_TAMPERED");
    },
  );

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
    const secondPayload = readProjectionPayloadText(repository, second.projectionRevision);
    const secondManifest = readProjectionManifest(repository, second.projectionRevision);

    expect(second.projectionRevision).not.toBe(first.projectionRevision);
    expect(secondPayload).toContain(`body-weight:${correction.id}`);
    expect(secondPayload).not.toContain(`body-weight:${original.id}`);
    expect(JSON.stringify(secondManifest)).toContain(`body-weight-${correction.id}`);
    expect(JSON.stringify(secondManifest)).not.toContain(`body-weight-${original.id}`);
  });

  it("publishes an empty complete desired set after the last fact is deleted", async () => {
    const repository = temporaryRepository();
    const personalDataDirectory = join(repository, "stella", "fitness");
    const original = await persistBodyWeightObservation({
      personalDataDirectory,
      amount: 68.4,
      unit: "kg",
      occurredAt: "2026-08-23T23:00:00.000Z",
      recordedAt: "2026-08-24T00:00:00.000Z",
      source: { kind: "user-text", text: "68.4 kg" },
    });
    const first = await publishFitnessContextProjection({
      openclawConfig: locatorConfig(repository),
      generatedAt: "2026-08-24T00:01:00.000Z",
    });
    await persistBodyWeightDeletion({
      personalDataDirectory,
      observationId: original.id,
      source: { kind: "user-text", text: "删除体重" },
      recordedAt: "2026-08-24T01:00:00.000Z",
    });

    const second = await publishFitnessContextProjection({
      openclawConfig: locatorConfig(repository),
      generatedAt: "2026-08-24T01:01:00.000Z",
    });
    const payload = readProjectionPayloadText(repository, second.projectionRevision);

    expect(second.projectionRevision).not.toBe(first.projectionRevision);
    expect(payload).toContain("source_as_of: 2026-08-24T01:00:00.000Z");
    expect(payload).not.toContain("\n## ");
    expect(readProjectionManifest(repository, second.projectionRevision).payloads)
      .toMatchObject([{
        stable_id: "fitness-history-empty",
        path: "payloads/fitness-history-empty.md",
      }]);
  });

  it("atomically blocks retraction and restores only the last verified tuple", async () => {
    const repository = temporaryRepository();
    const personalDataDirectory = join(repository, "stella", "fitness");
    await persistBodyWeightObservation({
      personalDataDirectory,
      amount: 68.4,
      unit: "kg",
      occurredAt: "2026-08-24T00:00:00.000Z",
      recordedAt: "2026-08-24T00:00:00.000Z",
      source: { kind: "user-text", text: "68.4 kg" },
    });
    await publishFitnessContextProjection({
      openclawConfig: locatorConfig(repository),
      generatedAt: "2026-08-24T00:01:00.000Z",
    });
    const verified = await readFitnessContextProjectionPointer({
      openclawConfig: locatorConfig(repository),
    });
    expect(verified).toMatchObject({ status: "active" });
    if (verified?.status !== "active") throw new Error("expected active pointer");

    await publishFitnessContextProjectionPointerStatus({
      openclawConfig: locatorConfig(repository),
      status: "blocked",
      reasonCode: "CANONICAL_RETRACTION_IN_PROGRESS",
      sourceRevision: verified.sourceRevision,
      changedAt: "2026-08-24T00:02:00.000Z",
    });
    expect(await readFitnessContextProjectionPointer({
      openclawConfig: locatorConfig(repository),
    })).toEqual({
      status: "blocked",
      sourceRevision: verified.sourceRevision,
    });
    await expect(publishFitnessContextProjection({
      openclawConfig: locatorConfig(repository),
      generatedAt: "2026-08-24T00:02:30.000Z",
    })).rejects.toThrow("FITNESS_PROJECTION_POINTER_BLOCKED");

    await restoreFitnessContextProjectionPointer({
      openclawConfig: locatorConfig(repository),
      pointer: verified,
      expectedSourceRevision: verified.sourceRevision,
      changedAt: "2026-08-24T00:03:00.000Z",
    });
    expect(await readFitnessContextProjectionPointer({
      openclawConfig: locatorConfig(repository),
    })).toEqual(verified);
  });

  it("blocks before the first projection and restores pointer absence after a failed mutation", async () => {
    const repository = temporaryRepository();
    const config = locatorConfig(repository);
    await persistBodyWeightObservation({
      personalDataDirectory: join(repository, "stella", "fitness"),
      amount: 68.4,
      unit: "kg",
      occurredAt: "2026-08-24T00:00:00.000Z",
      recordedAt: "2026-08-24T00:00:00.000Z",
      source: { kind: "user-text", text: "68.4 kg" },
    });
    const source = await inspectFitnessContextProjectionSource({
      openclawConfig: config,
    });

    await publishFitnessContextProjectionPointerStatus({
      openclawConfig: config,
      status: "blocked",
      reasonCode: "CANONICAL_RETRACTION_IN_PROGRESS",
      sourceRevision: source.sourceRevision,
      changedAt: "2026-08-24T00:02:00.000Z",
    });
    expect(await readFitnessContextProjectionPointer({
      openclawConfig: config,
    })).toEqual({
      status: "blocked",
      sourceRevision: source.sourceRevision,
    });

    await restoreFitnessContextProjectionPointer({
      openclawConfig: config,
      pointer: undefined,
      expectedSourceRevision: source.sourceRevision,
      changedAt: "2026-08-24T00:03:00.000Z",
    });
    expect(await readFitnessContextProjectionPointer({
      openclawConfig: config,
    })).toBeUndefined();
  });

  it("completes blocked-first correction through the real coordinator and publisher", async () => {
    const repository = temporaryRepository();
    const config = locatorConfig(repository);
    const personalDataDirectory = join(repository, "stella", "fitness");
    const original = await persistBodyWeightObservation({
      personalDataDirectory,
      amount: 68.4,
      unit: "kg",
      occurredAt: "2026-08-24T00:00:00.000Z",
      recordedAt: "2026-08-24T00:00:00.000Z",
      source: { kind: "user-text", text: "68.4 kg" },
    });
    const first = await publishFitnessContextProjection({
      openclawConfig: config,
      generatedAt: "2026-08-24T00:01:00.000Z",
    });
    const coordinator = createFitnessContextSyncCoordinator({
      runtimeDirectory: join(repository, "runtime"),
      publish: async ({ trigger }) => await publishFitnessContextProjection({
        openclawConfig: config,
        generatedAt: "2026-08-24T01:01:00.000Z",
        allowBlockedReplacement: trigger === "retraction-recovery",
      }),
      inspectSource: () => inspectFitnessContextProjectionSource({
        openclawConfig: config,
      }),
      readPointer: () => readFitnessContextProjectionPointer({
        openclawConfig: config,
      }),
      publishPointerStatus: (input) =>
        publishFitnessContextProjectionPointerStatus({
          openclawConfig: config,
          ...input,
        }),
      restorePointer: (input) => restoreFitnessContextProjectionPointer({
        openclawConfig: config,
        ...input,
      }),
    });

    const correction = await coordinator.withRetraction(
      { kind: "correction" },
      () => persistBodyWeightCorrection({
        personalDataDirectory,
        replacesObservationId: original.id,
        amount: 68.8,
        unit: "kg",
        source: { kind: "user-text", text: "改为 68.8 kg" },
        recordedAt: "2026-08-24T01:00:00.000Z",
      }),
    );
    const active = await readFitnessContextProjectionPointer({
      openclawConfig: config,
    });

    expect(active).toMatchObject({ status: "active" });
    if (active?.status !== "active") throw new Error("expected active pointer");
    expect(active.projectionRevision).not.toBe(first.projectionRevision);
    const payload = readProjectionPayloadText(repository, active.projectionRevision);
    expect(payload).toContain(`body-weight:${correction.id}`);
    expect(payload).not.toContain(`body-weight:${original.id}`);
    expect(existsSync(join(
      repository,
      "runtime",
      "context-sync",
      "journal.json",
    ))).toBe(false);
  });

  it("publishes stale using only the last verified revision and as-of", async () => {
    const repository = temporaryRepository();
    const personalDataDirectory = join(repository, "stella", "fitness");
    await persistBodyWeightObservation({
      personalDataDirectory,
      amount: 68.4,
      unit: "kg",
      occurredAt: "2026-08-24T00:00:00.000Z",
      recordedAt: "2026-08-24T00:00:00.000Z",
      source: { kind: "user-text", text: "68.4 kg" },
    });
    await publishFitnessContextProjection({
      openclawConfig: locatorConfig(repository),
      generatedAt: "2026-08-24T00:01:00.000Z",
    });
    const verified = await readFitnessContextProjectionPointer({
      openclawConfig: locatorConfig(repository),
    });
    if (verified?.status !== "active") throw new Error("expected active pointer");

    await publishFitnessContextProjectionPointerStatus({
      openclawConfig: locatorConfig(repository),
      status: "stale",
      reasonCode: "PROJECTION_REFRESH_FAILED",
      sourceRevision: "ignored-current-source-revision",
      changedAt: "2026-08-24T00:02:00.000Z",
    });

    expect(await readFitnessContextProjectionPointer({
      openclawConfig: locatorConfig(repository),
    })).toEqual({ ...verified, status: "stale" });
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

function readProjectionManifest(
  repository: string,
  projectionRevision: string,
): {
  readonly payloads: readonly {
    readonly stable_id: string;
    readonly path: string;
    readonly media_type: string;
    readonly byte_length: number;
    readonly checksum: string;
  }[];
} {
  return JSON.parse(readFileSync(join(
    repository,
    "stella",
    "projections",
    "stella",
    "revisions",
    projectionRevision,
    "manifest.json",
  ), "utf8")) as {
    readonly payloads: readonly {
      readonly stable_id: string;
      readonly path: string;
      readonly media_type: string;
      readonly byte_length: number;
      readonly checksum: string;
    }[];
  };
}

function readProjectionPayloadText(
  repository: string,
  projectionRevision: string,
): string {
  const revisionDirectory = join(
    repository,
    "stella",
    "projections",
    "stella",
    "revisions",
    projectionRevision,
  );
  const manifest = readProjectionManifest(repository, projectionRevision);
  return manifest.payloads.map(({ path }) =>
    readFileSync(join(revisionDirectory, path), "utf8")
  ).join("\n");
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
