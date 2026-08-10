import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";
import { parse } from "yaml";

import {
  ControlledExtractionRuntime,
  createScenarioHarness,
} from "../src/scenario/harness.js";
import type { ConfigurationPreflightResult } from "../src/preflight.js";
import {
  alternateRawMediaUploadFixture,
  rawMediaUploadFixture,
} from "./support/sanitized-media.js";

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("scenario-level Plugin harness", () => {
  it("injects a controlled extraction result without a live provider", async () => {
    const runtime = new ControlledExtractionRuntime([
      {
        parsed: candidate(),
        metadata: {
          provider: "controlled",
          model: "fixture-v1",
          contentType: "json",
        },
      },
    ]);
    const harness = readyHarness(runtime);

    const output = await harness.ingestWorkoutLog({
      runId: "scenario-1",
      upload: rawUploadFixture(),
      timeoutMs: 2_000,
    });

    expect(output).toMatchObject({
      status: "candidate",
      candidate: candidate(),
      execution: {
        provider: "controlled",
        model: "fixture-v1",
        contentType: "json",
      },
    });
    expect(runtime.requests).toEqual([
      expect.objectContaining({
        runId: "scenario-1",
        media: expect.objectContaining({
          fileName: expect.stringMatching(/\.png$/u),
          mime: "image/png",
        }),
        timeoutMs: 2_000,
        signal: expect.any(AbortSignal),
      }),
    ]);
  });

  it("rejects cancellation and never emits a candidate", async () => {
    const runtime = new ControlledExtractionRuntime([], { pending: true });
    const harness = readyHarness(runtime);
    const controller = new AbortController();
    controller.abort("user-cancelled");

    await expect(
      harness.ingestWorkoutLog({
        runId: "scenario-cancelled",
        upload: rawUploadFixture(),
        timeoutMs: 2_000,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("rejects when cancellation arrives while controlled extraction is pending", async () => {
    const runtime = new ControlledExtractionRuntime([], { pending: true });
    const harness = readyHarness(runtime);
    const controller = new AbortController();
    const extraction = harness.ingestWorkoutLog({
      runId: "scenario-pending",
      upload: rawUploadFixture(),
      timeoutMs: 2_000,
      signal: controller.signal,
    });

    controller.abort("user-cancelled");

    await expect(extraction).rejects.toMatchObject({ name: "AbortError" });
  });

  it("deduplicates repeated run IDs before invoking extraction again", async () => {
    const runtime = new ControlledExtractionRuntime([
      { parsed: candidate(), metadata: { provider: "controlled" } },
    ]);
    const harness = readyHarness(runtime);
    const input = {
      runId: "scenario-idempotent",
      upload: rawUploadFixture(),
      timeoutMs: 2_000,
    };

    const first = await harness.ingestWorkoutLog(input);
    const second = await harness.ingestWorkoutLog(input);

    expect(second).toEqual(first);
    await vi.waitFor(() => expect(runtime.requests).toHaveLength(1));
  });

  it("rejects a run ID reused for different raw media", async () => {
    const runtime = new ControlledExtractionRuntime([
      { parsed: candidate(), metadata: { provider: "controlled" } },
    ]);
    const harness = readyHarness(runtime);

    await harness.ingestWorkoutLog({
      runId: "scenario-collision",
      upload: rawUploadFixture(),
      timeoutMs: 2_000,
    });
    await expect(
      harness.ingestWorkoutLog({
        runId: "scenario-collision",
        upload: alternateRawMediaUploadFixture(),
        timeoutMs: 2_000,
      }),
    ).rejects.toThrow("reused for different media");
    expect(runtime.requests).toHaveLength(1);
  });

  it("applies each caller's cancellation gate to an idempotent run", async () => {
    const runtime = new ControlledExtractionRuntime([], { pending: true });
    const harness = readyHarness(runtime);
    void harness.ingestWorkoutLog({
      runId: "scenario-shared-pending",
      upload: rawUploadFixture(),
      timeoutMs: 2_000,
    });
    const controller = new AbortController();
    controller.abort("second-caller-cancelled");

    await expect(
      harness.ingestWorkoutLog({
        runId: "scenario-shared-pending",
        upload: rawUploadFixture(),
        timeoutMs: 2_000,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    await vi.waitFor(() => expect(runtime.requests).toHaveLength(1));
  });

  it("rejects schema-invalid controlled output", async () => {
    const runtime = new ControlledExtractionRuntime([
      { parsed: { stage: 1 }, metadata: { provider: "controlled" } },
    ]);
    const harness = readyHarness(runtime);

    await expect(
      harness.ingestWorkoutLog({
        runId: "scenario-invalid",
        upload: rawUploadFixture(),
        timeoutMs: 2_000,
      }),
    ).rejects.toMatchObject({ name: "InvalidWorkoutLogCandidateError" });
  });

  it("preserves conflicts as structured uncertainty instead of choosing a value", async () => {
    const conflict = {
      path: "exercises[0].load",
      kind: "conflict",
      candidates: ["20 kg", "25 kg"],
    } as const;
    const runtime = new ControlledExtractionRuntime([
      {
        parsed: { ...candidate(), uncertainFields: [conflict] },
        metadata: { provider: "controlled" },
      },
    ]);
    const harness = readyHarness(runtime);

    await expect(
      harness.ingestWorkoutLog({
        runId: "scenario-conflict",
        upload: rawUploadFixture(),
        timeoutMs: 2_000,
      }),
    ).resolves.toMatchObject({
      candidate: { uncertainFields: [conflict] },
    });
  });

  it("rejects personal input at the harness seam while configuration is blocked", async () => {
    const runtime = new ControlledExtractionRuntime([
      { parsed: candidate(), metadata: { provider: "controlled" } },
    ]);
    const harness = createScenarioHarness({
      extractionRuntime: runtime,
      preflight: () => ({
        readiness: "BLOCKED_CONFIGURATION",
        reasons: [
          {
            code: "PERSONAL_DATA_DIRECTORY_REQUIRED",
            message: "Configure an absolute Personal Data Directory",
          },
        ],
      }),
    });

    await expect(
      harness.ingestWorkoutLog({
        runId: "scenario-blocked",
        upload: rawUploadFixture(),
        timeoutMs: 2_000,
      }),
    ).rejects.toThrow("PERSONAL_DATA_DIRECTORY_REQUIRED");
    expect(runtime.requests).toEqual([]);
  });

  it("records a clear body-weight Observation and returns a factual time-series view", async () => {
    const personalDataDirectory = temporaryPersonalDataDirectory();
    const harness = readyHarness(
      new ControlledExtractionRuntime([]),
      personalDataDirectory,
    );

    const result = await harness.recordBodyWeight({
      text: "今天体重 68.4 kg",
      receivedAt: "2026-08-10T07:30:00.000Z",
      source: { channel: "test", messageId: "message-1" },
    });

    expect(result).toMatchObject({
      status: "recorded",
      observation: {
        schemaVersion: "stella-fitness/observation/body-weight/v0.1",
        id: expect.stringMatching(/^[0-9a-f-]{36}$/),
        kind: "body-weight",
        value: { amount: 68.4, unit: "kg" },
        occurredAt: "2026-08-10T07:30:00.000Z",
        source: {
          kind: "user-text",
          text: "今天体重 68.4 kg",
          channel: "test",
          messageId: "message-1",
        },
        provenance: {
          kind: "body-weight-recording",
          recordedAt: "2026-08-10T07:30:00.000Z",
        },
      },
      view: {
        schemaVersion: "stella-fitness/view/body-weight/v0.1",
        points: [
          expect.objectContaining({
            amount: 68.4,
            unit: "kg",
            occurredAt: "2026-08-10T07:30:00.000Z",
          }),
        ],
        errors: [],
      },
    });
    expect(JSON.stringify(result)).not.toMatch(
      /trend|ideal|training adjustment|nutrition|health conclusion/i,
    );
  });

  it("normalizes an explicit Chinese kilogram unit without evaluating the value", async () => {
    const harness = readyHarness(
      new ControlledExtractionRuntime([]),
      temporaryPersonalDataDirectory(),
    );

    await expect(
      harness.recordBodyWeight({
        text: "今天体重 68.4 公斤",
        receivedAt: "2026-08-10T07:30:00.000Z",
      }),
    ).resolves.toMatchObject({
      status: "recorded",
      observation: { value: { amount: 68.4, unit: "kg" } },
    });
  });

  it("uses an explicit RFC 3339 measurement time instead of the message time", async () => {
    const harness = readyHarness(
      new ControlledExtractionRuntime([]),
      temporaryPersonalDataDirectory(),
    );

    await expect(
      harness.recordBodyWeight({
        text: "2026-08-09T07:00:00+08:00 体重 68.4 kg",
        receivedAt: "2026-08-10T07:30:00.000Z",
      }),
    ).resolves.toMatchObject({
      status: "recorded",
      observation: { occurredAt: "2026-08-08T23:00:00.000Z" },
    });
  });

  it("asks for the occurrence time when an explicit calendar timestamp is invalid", async () => {
    const personalDataDirectory = temporaryPersonalDataDirectory();
    const harness = readyHarness(
      new ControlledExtractionRuntime([]),
      personalDataDirectory,
    );

    await expect(
      harness.recordBodyWeight({
        text: "2026-02-30T07:00:00Z 体重 68.4 kg",
        receivedAt: "2026-08-10T07:30:00.000Z",
      }),
    ).resolves.toEqual({
      status: "clarification",
      field: "occurrence-time",
      question: "请确认这次测量的发生时间。",
    });
    expect(readdirSync(personalDataDirectory)).toEqual([]);
  });

  it("asks only for the occurrence time when a relative date is ambiguous", async () => {
    const personalDataDirectory = temporaryPersonalDataDirectory();
    const harness = readyHarness(
      new ControlledExtractionRuntime([]),
      personalDataDirectory,
    );

    await expect(
      harness.recordBodyWeight({
        text: "昨天体重 68.4 kg",
        receivedAt: "2026-08-10T07:30:00.000Z",
      }),
    ).resolves.toEqual({
      status: "clarification",
      field: "occurrence-time",
      question: "请确认这次测量的发生时间。",
    });
    expect(readdirSync(personalDataDirectory)).toEqual([]);
  });

  it.each([
    ["今天体重 68.4", "unit", "请确认体重单位：kg 还是 lb？"],
    ["今天体重 68.4 kg 或 69.0 kg", "value", "请确认一个体重数值。"],
  ] as const)(
    "asks only for the ambiguous field in %s",
    async (text, field, question) => {
      const personalDataDirectory = temporaryPersonalDataDirectory();
      const harness = readyHarness(
        new ControlledExtractionRuntime([]),
        personalDataDirectory,
      );

      await expect(
        harness.recordBodyWeight({
          text,
          receivedAt: "2026-08-10T07:30:00.000Z",
        }),
      ).resolves.toEqual({ status: "clarification", field, question });
      expect(readdirSync(personalDataDirectory)).toEqual([]);
    },
  );

  it("corrects by explicit lineage and rebuilds the same factual view after restart", async () => {
    const personalDataDirectory = temporaryPersonalDataDirectory();
    const options = {
      extractionRuntime: new ControlledExtractionRuntime([]),
      personalDataDirectory: () => personalDataDirectory,
      preflight: (): ConfigurationPreflightResult => ({
        readiness: "READY_FOR_SETUP",
        reasons: [],
      }),
    };
    const firstHarness = createScenarioHarness(options);
    const recorded = await firstHarness.recordBodyWeight({
      text: "今天体重 68.4 kg",
      receivedAt: "2026-08-10T07:30:00.000Z",
    });
    if (recorded.status !== "recorded") {
      throw new Error("Expected the original body weight to be recorded");
    }

    const corrected = await firstHarness.correctBodyWeight({
      replacesObservationId: recorded.observation.id,
      text: "纠正为 67.9 kg",
      receivedAt: "2026-08-10T08:00:00.000Z",
    });
    if (corrected.status !== "recorded") {
      throw new Error("Expected the body-weight correction to be recorded");
    }

    expect(corrected).toMatchObject({
      status: "recorded",
      observation: {
        id: expect.not.stringMatching(recorded.observation.id),
        value: { amount: 67.9, unit: "kg" },
        occurredAt: "2026-08-10T07:30:00.000Z",
        provenance: {
          kind: "body-weight-correction",
          recordedAt: "2026-08-10T08:00:00.000Z",
          replacesObservationId: recorded.observation.id,
        },
      },
      view: {
        points: [
          expect.objectContaining({
            amount: 67.9,
            occurredAt: "2026-08-10T07:30:00.000Z",
          }),
        ],
        errors: [],
      },
    });
    expect(
      readdirSync(join(personalDataDirectory, "observations", "body-weight")),
    ).toHaveLength(2);

    const restartedView = await createScenarioHarness(
      options,
    ).bodyWeightTimeline();
    expect(restartedView).toEqual(corrected.view);
  });

  it("deduplicates the same source identity across restart", async () => {
    const personalDataDirectory = temporaryPersonalDataDirectory();
    const options = {
      extractionRuntime: new ControlledExtractionRuntime([]),
      personalDataDirectory: () => personalDataDirectory,
      preflight: (): ConfigurationPreflightResult => ({
        readiness: "READY_FOR_SETUP",
        reasons: [],
      }),
    };
    const input = {
      text: "今天体重 68.4 kg",
      receivedAt: "2026-08-10T07:30:00.000Z",
      source: { channel: "test", messageId: "message-dedupe" },
    };

    const first = await createScenarioHarness(options).recordBodyWeight(input);
    const retried = await createScenarioHarness(options).recordBodyWeight(input);

    expect(retried).toEqual(first);
    expect(
      readdirSync(join(personalDataDirectory, "observations", "body-weight")),
    ).toHaveLength(1);
    await expect(
      createScenarioHarness(options).recordBodyWeight({
        ...input,
        text: "今天体重 69.0 kg",
      }),
    ).rejects.toThrow("source identity was reused for different facts");
  });

  it("respects external Observation deletion when rebuilding after restart", async () => {
    const personalDataDirectory = temporaryPersonalDataDirectory();
    const options = {
      extractionRuntime: new ControlledExtractionRuntime([]),
      personalDataDirectory: () => personalDataDirectory,
      preflight: (): ConfigurationPreflightResult => ({
        readiness: "READY_FOR_SETUP",
        reasons: [],
      }),
    };
    const recorded = await createScenarioHarness(options).recordBodyWeight({
      text: "今天体重 68.4 kg",
      receivedAt: "2026-08-10T07:30:00.000Z",
    });
    if (recorded.status !== "recorded") {
      throw new Error("Expected the body weight to be recorded");
    }
    rmSync(
      join(
        personalDataDirectory,
        "observations",
        "body-weight",
        `${recorded.observation.id}.json`,
      ),
    );

    await expect(
      createScenarioHarness(options).bodyWeightTimeline(),
    ).resolves.toEqual({
      schemaVersion: "stella-fitness/view/body-weight/v0.1",
      points: [],
      errors: [],
    });
  });

  it("corrects an occurrence time through the same explicit lineage", async () => {
    const personalDataDirectory = temporaryPersonalDataDirectory();
    const harness = readyHarness(
      new ControlledExtractionRuntime([]),
      personalDataDirectory,
    );
    const recorded = await harness.recordBodyWeight({
      text: "今天体重 68.4 kg",
      receivedAt: "2026-08-10T07:30:00.000Z",
    });
    if (recorded.status !== "recorded") {
      throw new Error("Expected the original body weight to be recorded");
    }

    await expect(
      harness.correctBodyWeight({
        replacesObservationId: recorded.observation.id,
        text: "2026-08-09T07:00:00+08:00 纠正为 68.4 kg",
        receivedAt: "2026-08-10T08:00:00.000Z",
      }),
    ).resolves.toMatchObject({
      status: "recorded",
      observation: {
        occurredAt: "2026-08-08T23:00:00.000Z",
        provenance: {
          kind: "body-weight-correction",
          replacesObservationId: recorded.observation.id,
        },
      },
      view: {
        points: [
          expect.objectContaining({ occurredAt: "2026-08-08T23:00:00.000Z" }),
        ],
      },
    });
  });

  it("reports and excludes a schema-invalid manual edit from the rebuilt view", async () => {
    const personalDataDirectory = temporaryPersonalDataDirectory();
    const harness = readyHarness(
      new ControlledExtractionRuntime([]),
      personalDataDirectory,
    );
    const recorded = await harness.recordBodyWeight({
      text: "今天体重 68.4 kg",
      receivedAt: "2026-08-10T07:30:00.000Z",
    });
    if (recorded.status !== "recorded") {
      throw new Error("Expected the body weight to be recorded");
    }
    const relativeFile = join(
      "observations",
      "body-weight",
      `${recorded.observation.id}.json`,
    );
    const canonicalFile = join(personalDataDirectory, relativeFile);
    writeFileSync(
      canonicalFile,
      `${JSON.stringify({
        ...recorded.observation,
        value: { amount: 0, unit: "kg" },
      })}\n`,
    );

    await expect(harness.bodyWeightTimeline()).resolves.toEqual({
      schemaVersion: "stella-fitness/view/body-weight/v0.1",
      points: [],
      errors: [
        {
          file: relativeFile,
          message: "Body-weight Observation is schema-invalid",
        },
      ],
    });
  });

  it("does not start Program setup while configuration preflight is blocked", async () => {
    const personalDataDirectory = temporaryPersonalDataDirectory();
    const harness = createScenarioHarness({
      extractionRuntime: new ControlledExtractionRuntime([]),
      personalDataDirectory: () => personalDataDirectory,
      preflight: () => ({
        readiness: "BLOCKED_CONFIGURATION",
        reasons: [
          {
            code: "CONVERSATION_ACCESS_REQUIRED",
            message: "Enable Plugin conversation access",
          },
        ],
      }),
    });

    await expect(harness.selectProgram({ id: "program" })).rejects.toThrow(
      "CONVERSATION_ACCESS_REQUIRED",
    );
    expect(readdirSync(personalDataDirectory)).toEqual([]);
  });

  it("validates the selected ProgramSpec and stores a resumable setup only in Personal Data Directory", async () => {
    const personalDataDirectory = temporaryPersonalDataDirectory();
    const harness = createScenarioHarness({
      extractionRuntime: new ControlledExtractionRuntime([]),
      personalDataDirectory: () => personalDataDirectory,
      preflight: () => ({ readiness: "READY_FOR_SETUP", reasons: [] }),
    });

    const setup = await harness.selectProgram(await programFixture());

    expect(setup).toMatchObject({
      schemaVersion: "stella-fitness/program-selection/v0.1",
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      program: {
        id: "zhuoshu-12-week",
        version: "0.2.0",
        schemaVersion: "stella-fitness/program/v0.1",
        specSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      },
      provenance: {
        kind: "program-spec-selection",
        selectedAt: expect.any(String),
      },
    });
    expect(readdirSync(personalDataDirectory)).toEqual(["program"]);
    expect(
      JSON.parse(
        readFileSync(
          join(personalDataDirectory, "program", "selection.json"),
          "utf8",
        ),
      ),
    ).toEqual(setup);
  });

  it("fails closed on an invalid ProgramSpec without creating setup state", async () => {
    const personalDataDirectory = temporaryPersonalDataDirectory();
    const programSpec = (await programFixture()) as {
      weeks: Array<{ sessions: Array<{ status: string }> }>;
    };
    programSpec.weeks[0]!.sessions[0]!.status = "unresolved";
    const harness = createScenarioHarness({
      extractionRuntime: new ControlledExtractionRuntime([]),
      personalDataDirectory: () => personalDataDirectory,
      preflight: () => ({ readiness: "READY_FOR_SETUP", reasons: [] }),
    });

    await expect(harness.selectProgram(programSpec)).rejects.toThrow(
      "status must be resolved",
    );
    expect(readdirSync(personalDataDirectory)).toEqual([]);
  });

  it("resumes interrupted setup idempotently and confirms the canonical Program State", async () => {
    const personalDataDirectory = temporaryPersonalDataDirectory();
    const options = {
      extractionRuntime: new ControlledExtractionRuntime([]),
      personalDataDirectory: () => personalDataDirectory,
      preflight: (): ConfigurationPreflightResult => ({
        readiness: "READY_FOR_SETUP",
        reasons: [],
      }),
    };
    const programSpec = await programFixture();
    const interruptedSetup = await createScenarioHarness(options).selectProgram(
      programSpec,
    );

    const resumedHarness = createScenarioHarness(options);
    expect(await resumedHarness.selectProgram(programSpec)).toEqual(
      interruptedSetup,
    );
    const state = await resumedHarness.confirmCycleStart("2026-08-10");

    expect(state).toEqual({
      schemaVersion: "stella-fitness/program-state/v0.1",
      id: interruptedSetup.id,
      program: interruptedSetup.program,
      cycle: { startDate: "2026-08-10" },
      symbolicLoadBindings: {},
      provenance: {
        kind: "program-selection-confirmation",
        selectionId: interruptedSetup.id,
        selectedAt: interruptedSetup.provenance.selectedAt,
        cycleStartConfirmedAt: expect.any(String),
      },
    });
    expect(
      JSON.parse(
        readFileSync(join(personalDataDirectory, "program", "state.json"), "utf8"),
      ),
    ).toEqual(state);
    expect(readdirSync(join(personalDataDirectory, "program"))).toEqual([
      "state.json",
    ]);
    expect(JSON.stringify(state)).not.toMatch(
      /body.profile|health|nutrition|performance/i,
    );
    await expect(
      resumedHarness.confirmCycleStart("2026-08-10"),
    ).resolves.toEqual(state);
    await expect(resumedHarness.selectProgram(programSpec)).resolves.toEqual(
      interruptedSetup,
    );
  });

  it("keeps the resumable setup when the cycle start confirmation is invalid", async () => {
    const personalDataDirectory = temporaryPersonalDataDirectory();
    const harness = createScenarioHarness({
      extractionRuntime: new ControlledExtractionRuntime([]),
      personalDataDirectory: () => personalDataDirectory,
      preflight: () => ({ readiness: "READY_FOR_SETUP", reasons: [] }),
    });
    await harness.selectProgram(await programFixture());

    await expect(harness.confirmCycleStart("2026-08-11")).rejects.toThrow(
      "Cycle start must be a Monday",
    );
    expect(readdirSync(join(personalDataDirectory, "program"))).toEqual([
      "selection.json",
    ]);
  });
});

function readyHarness(
  extractionRuntime: ControlledExtractionRuntime,
  personalDataDirectory?: string,
) {
  const directory = personalDataDirectory ?? temporaryPersonalDataDirectory();
  return createScenarioHarness({
    extractionRuntime,
    personalDataDirectory: () => directory,
    runtimeDirectory: () => join(directory, "..", "runtime"),
    preflight: (): ConfigurationPreflightResult => ({
      readiness: "READY",
      reasons: [],
    }),
  });
}

function candidate() {
  return {
    stage: 1,
    week: 1,
    weekday: "monday",
    exercises: [],
    uncertainFields: [],
  };
}

function rawUploadFixture() {
  return rawMediaUploadFixture();
}

function temporaryPersonalDataDirectory(): string {
  const root = mkdtempSync(join(tmpdir(), "stella-scenario-"));
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
