import { readFile } from "node:fs/promises";

import { parse } from "yaml";
import { describe, expect, it } from "vitest";

import {
  InvalidProgramSpecError,
  validateProgramSpec,
} from "../src/program/validator.js";
import {
  ControlledExtractionRuntime,
  createScenarioHarness,
} from "../src/scenario/harness.js";

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
      "mismatched strength-test semantics",
      (program: Fixture) => {
        program.weeks[3]!.sessions[2]!.tests![0]!.test = "max_reps_first_set";
      },
      "test max_reps_first_set does not match protocol main-12rm type 12RM",
    ],
    [
      "main test bound to the wrong symbol",
      (program: Fixture) => {
        program.weeks[3]!.sessions[2]!.tests![1]!.result_binding = "A";
      },
      "dumbbell-bench-press must bind main-12rm results to N",
    ],
    [
      "missing main strength tests",
      (program: Fixture) => {
        program.weeks[3]!.sessions[2]!.tests!.splice(1, 2);
      },
      "dumbbell-bench-press must bind main-12rm results to N",
    ],
    [
      "pull-up test bound to a load symbol",
      (program: Fixture) => {
        program.weeks[3]!.sessions[2]!.tests![3]!.result_binding = "N";
      },
      "pull-up protocol pullup-first-set-max must bind its assistance relationship",
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
      "changed course-start binding",
      (program: Fixture) => {
        program.phase_transitions.course_start!.bind_results_to = "N";
      },
      "phase_transitions.course_start.bind_results_to must be A",
    ],
    [
      "missing phase transition",
      (program: Fixture) => {
        delete program.phase_transitions.phase1_to_phase2;
      },
      "phase_transitions.phase1_to_phase2 is required",
    ],
    [
      "transition targeting an ordinary session",
      (program: Fixture) => {
        program.phase_transitions.phase1_to_phase2!.day = "monday";
      },
      "phase_transitions.phase1_to_phase2 must reference a strength-test session",
    ],
    [
      "transition protocol not represented by its test session",
      (program: Fixture) => {
        program.phase_transitions.phase1_to_phase2!.main_protocol_ref =
          "pullup-first-set-max";
      },
      "main protocol pullup-first-set-max must bind test results to N",
    ],
    [
      "changed phase transition binding",
      (program: Fixture) => {
        program.phase_transitions.phase1_to_phase2!.bind_main_results_to = "A";
        for (const test of program.weeks[3]!.sessions[2]!.tests!.slice(0, 3)) {
          test.result_binding = "A";
        }
      },
      "phase_transitions.phase1_to_phase2.bind_main_results_to must be N",
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
    [
      "invalid recovery override",
      (program: Fixture) => {
        program.templates[
          "phase2-torso-recovery"
        ]!.overrides!.overhead_press!.sets = "three";
      },
      "overrides.overhead_press.sets must be a positive integer",
    ],
    [
      "recovery inheriting the wrong split",
      (program: Fixture) => {
        program.templates["phase2-torso-recovery"]!.based_on = "phase2-limbs";
      },
      "torso-recovery must inherit the phase-2 torso template phase2-torso",
    ],
    [
      "invalid weekday",
      (program: Fixture) => {
        program.weeks[0]!.sessions[0]!.day = "monday-ish";
      },
      "day must be a supported weekday",
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
    const programSpec = await programFixture();
    const harness = programHarness();
    const input = {
      programSpec,
      programVersion: "0.2.0",
      cycleStart: "2026-08-10",
      date: "2026-09-07",
    };

    const first = harness.resolvePlannedSession(input);
    const second = harness.resolvePlannedSession(input);

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
    const programSpec = await programFixture();
    const harness = programHarness();
    const sessions = Array.from({ length: 84 }, (_unused, dayOffset) =>
      harness.resolvePlannedSession({
        programSpec,
        programVersion: "0.2.0",
        cycleStart: "2026-08-10",
        date: isoDate(dayOffset),
      }),
    ).filter((session) => session !== null);

    expect(sessions).toHaveLength(44);
    expect(new Set(sessions.map(({ cycle }) => cycle.week))).toEqual(
      new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]),
    );

    expect(sessionOn(harness, programSpec, "2026-09-04")).toMatchObject({
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

    expect(sessionOn(harness, programSpec, "2026-10-01")).toMatchObject({
      type: "torso-recovery",
      recovery: true,
      exercises: [
        {
          exerciseId: "pull-up",
          prescription: { type: "total_reps", reps: 15 },
          sets: "self_selected",
          rest: "self_selected",
          assistance: {
            sourceBaseline: "phase2_pullup_assistance_baseline",
            preserveProgrammedTotalReps: true,
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
    const programSpec = await programFixture();
    const harness = programHarness();

    expect(sessionOn(harness, programSpec, "2026-08-15")).toBeNull();
    expect(() =>
      harness.resolvePlannedSession({
        programSpec,
        programVersion: "0.1.0",
        cycleStart: "2026-08-10",
        date: "2026-08-10",
      }),
    ).toThrow("requested version 0.1.0 does not match 0.2.0");
    expect(() =>
      harness.resolvePlannedSession({
        programSpec,
        programVersion: "0.2.0",
        cycleStart: "2026-08-11",
        date: "2026-08-11",
      }),
    ).toThrow("cycle start must be a Monday");

    const invalidSpec = (await programFixture()) as Fixture;
    invalidSpec.weeks[0]!.sessions[0]!.status = "unresolved";
    expect(() =>
      harness.resolvePlannedSession({
        programSpec: invalidSpec,
        programVersion: "0.2.0",
        cycleStart: "2026-08-10",
        date: "2026-08-10",
      }),
    ).toThrow(InvalidProgramSpecError);
  });
});

function sessionOn(
  harness: ReturnType<typeof programHarness>,
  programSpec: unknown,
  date: string,
) {
  return harness.resolvePlannedSession({
    programSpec,
    programVersion: "0.2.0",
    cycleStart: "2026-08-10",
    date,
  });
}

function programHarness() {
  return createScenarioHarness({
    extractionRuntime: new ControlledExtractionRuntime([]),
    preflight: () => ({ readiness: "READY", reasons: [] }),
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
      day: string;
      status: string;
      template?: string;
      tests?: Array<{
        exercise: string;
        test: string;
        protocol_ref: string;
        result_binding: string;
      }>;
    }>;
  }>;
  load_symbols: Record<string, { per_exercise: boolean }>;
  templates: Record<
    string,
    {
      based_on?: string;
      exercises?: Array<Record<string, unknown>>;
      overrides?: { overhead_press?: { sets: unknown } };
    }
  >;
  phase_transitions: Record<
    string,
    {
      bind_results_to_next_cycle?: string;
      bind_results_to?: string;
      day?: string;
      main_protocol_ref?: string;
      bind_main_results_to?: string;
    }
  >;
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
