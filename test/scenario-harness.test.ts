import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { parse } from "yaml";

import {
  ControlledExtractionRuntime,
  createScenarioHarness,
} from "../src/scenario/harness.js";
import type { ConfigurationPreflightResult } from "../src/preflight.js";
import { sanitizedMediaFixture } from "./support/sanitized-media.js";

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

    const output = await harness.extract({
      runId: "scenario-1",
      media: sanitizedFixture(),
      timeoutMs: 2_000,
    });

    expect(output).toEqual({
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
          fileName: "workout.jpg",
          mime: "image/jpeg",
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
      harness.extract({
        runId: "scenario-cancelled",
        media: sanitizedFixture(),
        timeoutMs: 2_000,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("rejects when cancellation arrives while controlled extraction is pending", async () => {
    const runtime = new ControlledExtractionRuntime([], { pending: true });
    const harness = readyHarness(runtime);
    const controller = new AbortController();
    const extraction = harness.extract({
      runId: "scenario-pending",
      media: sanitizedFixture(),
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
      media: sanitizedFixture(),
      timeoutMs: 2_000,
    };

    const first = await harness.extract(input);
    const second = await harness.extract(input);

    expect(second).toEqual(first);
    expect(runtime.requests).toHaveLength(1);
  });

  it("rejects a run ID reused for different sanitized media", async () => {
    const runtime = new ControlledExtractionRuntime([
      { parsed: candidate(), metadata: { provider: "controlled" } },
    ]);
    const harness = readyHarness(runtime);

    await harness.extract({
      runId: "scenario-collision",
      media: sanitizedFixture(),
      timeoutMs: 2_000,
    });
    await expect(
      harness.extract({
        runId: "scenario-collision",
        media: sanitizedMediaFixture(Buffer.from("different-image")),
        timeoutMs: 2_000,
      }),
    ).rejects.toThrow("reused for different media");
    expect(runtime.requests).toHaveLength(1);
  });

  it("applies each caller's cancellation gate to an idempotent run", async () => {
    const runtime = new ControlledExtractionRuntime([], { pending: true });
    const harness = readyHarness(runtime);
    void harness.extract({
      runId: "scenario-shared-pending",
      media: sanitizedFixture(),
      timeoutMs: 2_000,
    });
    const controller = new AbortController();
    controller.abort("second-caller-cancelled");

    await expect(
      harness.extract({
        runId: "scenario-shared-pending",
        media: sanitizedFixture(),
        timeoutMs: 2_000,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(runtime.requests).toHaveLength(1);
  });

  it("rejects schema-invalid controlled output", async () => {
    const runtime = new ControlledExtractionRuntime([
      { parsed: { stage: 1 }, metadata: { provider: "controlled" } },
    ]);
    const harness = readyHarness(runtime);

    await expect(
      harness.extract({
        runId: "scenario-invalid",
        media: sanitizedFixture(),
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
      harness.extract({
        runId: "scenario-conflict",
        media: sanitizedFixture(),
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
      harness.extract({
        runId: "scenario-blocked",
        media: sanitizedFixture(),
        timeoutMs: 2_000,
      }),
    ).rejects.toThrow("PERSONAL_DATA_DIRECTORY_REQUIRED");
    expect(runtime.requests).toEqual([]);
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

function readyHarness(extractionRuntime: ControlledExtractionRuntime) {
  return createScenarioHarness({
    extractionRuntime,
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

function sanitizedFixture() {
  return sanitizedMediaFixture();
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
