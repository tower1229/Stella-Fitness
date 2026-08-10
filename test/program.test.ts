import { readFile } from "node:fs/promises";

import { parse } from "yaml";
import { describe, expect, it } from "vitest";

import {
  InvalidProgramSpecError,
  validateProgramSpec,
} from "../src/program/validator.js";
import { resolvePlannedSession } from "../src/program/engine.js";

describe("ProgramSpec validator", () => {
  it("validates the complete source-reconciled v0.2 program", async () => {
    const program = validateProgramSpec(await programFixture());

    expect(program).toMatchObject({
      schemaVersion: "stella-fitness/program/v0.1",
      id: "zhuoshu-12-week",
      version: "0.2.0",
    });
    expect(program.weeks).toHaveLength(12);
    expect(program.weeks.flatMap(({ sessions }) => sessions)).toHaveLength(44);
    expect(
      program.weeks
        .flatMap(({ sessions }) => sessions)
        .filter(({ type }) => type.includes("recovery")),
    ).toHaveLength(4);
    expect(
      program.weeks
        .flatMap(({ sessions }) => sessions)
        .find(({ type }) => type === "strength-test"),
    ).toMatchObject({ day: "friday", tests: expect.any(Array) });
    expect(program.exerciseAliases["dumbbell-overhead-press"]).toMatchObject({
      canonical_display_name: "哑铃推肩",
      aliases: ["哑铃推肩", "哑铃推举"],
    });
  });

  it.each([
    [
      "unsupported schema",
      (program: Fixture) => {
        program.schema_version = "stella-fitness/program/v9";
      },
      "unsupported schema_version stella-fitness/program/v9",
    ],
    [
      "unresolved session",
      (program: Fixture) => {
        program.weeks[0]!.sessions[0]!.status = "unresolved";
      },
      "status must be resolved",
    ],
    [
      "missing planned session",
      (program: Fixture) => {
        program.weeks[4]!.sessions.pop();
      },
      "week 5 must contain 4 sessions for phase phase-2",
    ],
    [
      "missing template",
      (program: Fixture) => {
        program.weeks[0]!.sessions[0]!.template = "missing-template";
      },
      "references unknown template missing-template",
    ],
    [
      "absent template",
      (program: Fixture) => {
        delete program.weeks[0]!.sessions[0]!.template;
      },
      "resolved non-test session requires a template",
    ],
    [
      "missing testing protocol",
      (program: Fixture) => {
        program.weeks[3]!.sessions[2]!.tests![0]!.protocol_ref =
          "missing-protocol";
      },
      "references unknown testing protocol missing-protocol",
    ],
    [
      "unresolved test binding",
      (program: Fixture) => {
        program.weeks[3]!.sessions[2]!.tests![0]!.result_binding =
          "missing-binding";
      },
      "result_binding references unknown relationship missing-binding",
    ],
    [
      "unresolved cycle transition",
      (program: Fixture) => {
        program.phase_transitions.cycle_end!.bind_results_to_next_cycle =
          "missing-symbol";
      },
      "bind_results_to_next_cycle references unknown load symbol missing-symbol",
    ],
    [
      "non-exercise load symbol",
      (program: Fixture) => {
        program.load_symbols.A!.per_exercise = false;
      },
      "load_symbols.A.per_exercise must be true",
    ],
    [
      "invented pull-up rest",
      (program: Fixture) => {
        program.templates["phase2-torso"]!.exercises![0]!.rest = [60, 90];
      },
      "ordinary pull-up rest must be self_selected",
    ],
    [
      "template inheritance cycle",
      (program: Fixture) => {
        program.templates["phase2-torso-recovery"]!.based_on =
          "phase2-limbs-recovery";
        program.templates["phase2-limbs-recovery"]!.based_on =
          "phase2-torso-recovery";
      },
      "template inheritance cycle",
    ],
  ])("fails closed for %s", async (_label, corrupt, expected) => {
    const program = (await programFixture()) as Fixture;
    corrupt(program);

    expect(() => validateProgramSpec(program)).toThrow(InvalidProgramSpecError);
    expect(() => validateProgramSpec(program)).toThrow(expected);
  });
});

describe("Program Engine", () => {
  it("deterministically resolves an ordinary session from version, cycle start and date", async () => {
    const program = validateProgramSpec(await programFixture());
    const input = {
      program,
      programVersion: "0.2.0",
      cycleStart: "2026-08-10",
      date: "2026-09-07",
    };

    const first = resolvePlannedSession(input);
    const second = resolvePlannedSession(input);

    expect(second).toEqual(first);
    expect(first).toMatchObject({
      kind: "planned-session",
      program: {
        id: "zhuoshu-12-week",
        version: "0.2.0",
        schemaVersion: "stella-fitness/program/v0.1",
      },
      cycle: { startDate: "2026-08-10", week: 5, phase: "phase-2" },
      date: "2026-09-07",
      day: "monday",
      type: "torso",
      exercises: [
        {
          exerciseId: "pull-up",
          prescription: { type: "total_reps", reps: 20 },
          sets: "self_selected",
          rest: "self_selected",
        },
        {
          exerciseId: "dumbbell-bench-press",
          load: { mode: "symbolic", symbol: "N", scope: "per_exercise" },
          prescription: { type: "sets_reps", sets: 3, reps: 10 },
          restSeconds: [60, 90],
        },
        {
          exerciseId: "dumbbell-overhead-press",
          displayName: "哑铃推肩",
        },
        { exerciseId: "plank" },
      ],
    });
    expect(JSON.stringify(first)).not.toMatch(
      /diagnosis|evaluation|recommendation|kilograms/i,
    );
  });

  it("resolves all 44 sessions including strength tests and recovery facts", async () => {
    const program = validateProgramSpec(await programFixture());
    const sessions = Array.from({ length: 84 }, (_unused, dayOffset) =>
      resolvePlannedSession({
        program,
        programVersion: "0.2.0",
        cycleStart: "2026-08-10",
        date: isoDate(dayOffset),
      }),
    ).filter((session) => session !== null);

    expect(sessions).toHaveLength(44);
    expect(new Set(sessions.map(({ cycle }) => cycle.week))).toEqual(
      new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]),
    );

    expect(sessionOn(program, "2026-09-04")).toMatchObject({
      type: "strength-test",
      recovery: false,
      exercises: [],
      tests: [
        {
          exerciseId: "goblet-squat",
          test: "12RM",
          resultBinding: "N",
          bindingScope: "per_exercise",
        },
        {
          exerciseId: "dumbbell-bench-press",
          resultBinding: "N",
          bindingScope: "per_exercise",
        },
        {
          exerciseId: "dumbbell-deadlift",
          resultBinding: "N",
          bindingScope: "per_exercise",
        },
        {
          exerciseId: "pull-up",
          test: "max_reps_first_set",
          resultBinding: "phase2_pullup_assistance_baseline",
          bindingScope: "per_exercise",
        },
      ],
    });

    expect(sessionOn(program, "2026-10-01")).toMatchObject({
      type: "torso-recovery",
      recovery: true,
      exercises: [
        {
          exerciseId: "pull-up",
          prescription: { type: "total_reps", reps: 15 },
          sets: "self_selected",
          rest: "self_selected",
          assistance: {
            source_baseline: "phase2_pullup_assistance_baseline",
            preserve_programmed_total_reps: true,
          },
        },
        {
          exerciseId: "dumbbell-bench-press",
          load: { mode: "symbolic", symbol: "N", scope: "per_exercise" },
          prescription: { type: "sets_reps", sets: 3, reps: 8 },
          effort: "complete_prescribed_reps",
        },
        {
          exerciseId: "dumbbell-overhead-press",
          load: { mode: "historical_reference", week: 5 },
          prescription: { type: "sets_reps", sets: 3, reps: 12 },
        },
        {
          exerciseId: "plank",
          prescription: { type: "duration", sets: 3, seconds: 30 },
        },
      ],
    });
  });

  it("returns no session on rest days and fails closed for invalid resolution input", async () => {
    const program = validateProgramSpec(await programFixture());

    expect(sessionOn(program, "2026-08-15")).toBeNull();
    expect(() =>
      resolvePlannedSession({
        program,
        programVersion: "0.1.0",
        cycleStart: "2026-08-10",
        date: "2026-08-10",
      }),
    ).toThrow("requested version 0.1.0 does not match 0.2.0");
    expect(() =>
      resolvePlannedSession({
        program,
        programVersion: "0.2.0",
        cycleStart: "2026-08-11",
        date: "2026-08-11",
      }),
    ).toThrow("cycle start must be a Monday");
  });
});

function sessionOn(
  program: ReturnType<typeof validateProgramSpec>,
  date: string,
) {
  return resolvePlannedSession({
    program,
    programVersion: "0.2.0",
    cycleStart: "2026-08-10",
    date,
  });
}

function isoDate(dayOffset: number): string {
  const date = new Date(Date.UTC(2026, 7, 10 + dayOffset));
  return date.toISOString().slice(0, 10);
}

type Fixture = {
  schema_version: string;
  weeks: Array<{
    sessions: Array<{
      status: string;
      template?: string;
      tests?: Array<{ protocol_ref: string; result_binding: string }>;
    }>;
  }>;
  load_symbols: Record<string, { per_exercise: boolean }>;
  templates: Record<
    string,
    { based_on?: string; exercises?: Array<Record<string, unknown>> }
  >;
  phase_transitions: Record<string, { bind_results_to_next_cycle?: string }>;
};

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
