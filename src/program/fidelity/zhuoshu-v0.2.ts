import { createHash } from "node:crypto";

import type { ProgramRecord, ProgramSpec } from "../../domain/program.js";

const MAIN_EXERCISES = [
  "goblet-squat",
  "dumbbell-bench-press",
  "dumbbell-deadlift",
] as const;
const SESSION_FIXTURE_SHA256 =
  "abb2e4872b7e237c1bb439454751ead6b9ca75b2be4af0b42524849d09fba76e";
const TEMPLATE_FIXTURE_SHA256 =
  "2464f2d628a0f2c2d9d0fd6401f8705e2f9d5c7de4fea348c0a20d5a893abdd8";

export function validateZhuoshuV02Fidelity(
  program: ProgramSpec,
): readonly string[] {
  if (program.id !== "zhuoshu-12-week" || program.version !== "0.2.0") {
    return [];
  }

  const issues: string[] = [];
  const sessions = program.weeks.flatMap(({ sessions }) => sessions);
  if (program.weeks.length !== 12 || sessions.length !== 44) {
    issues.push("zhuoshu v0.2 must contain 12 weeks and 44 sessions");
  }
  if (fidelityHash(program.weeks) !== SESSION_FIXTURE_SHA256) {
    issues.push(
      "zhuoshu v0.2 session prescriptions do not match the canonical fixture",
    );
  }
  if (fidelityHash(program.templates) !== TEMPLATE_FIXTURE_SHA256) {
    issues.push("zhuoshu v0.2 templates do not match the canonical fixture");
  }

  const mainProtocol = program.testingProtocols["main-12rm"];
  if (mainProtocol?.type !== "12RM") {
    issues.push("zhuoshu v0.2 main-12rm protocol type must be 12RM");
  }
  if (!sameStringSet(mainProtocol?.applies_to, MAIN_EXERCISES)) {
    issues.push(
      "zhuoshu v0.2 main-12rm must apply to the three settled main exercises",
    );
  }
  const pullupProtocol = program.testingProtocols["pullup-first-set-max"];
  if (
    pullupProtocol?.type !== "max_reps_first_set" ||
    pullupProtocol.exercise !== "pull-up"
  ) {
    issues.push(
      "zhuoshu v0.2 pullup-first-set-max must test pull-up max_reps_first_set",
    );
  }

  const assistance = asRecord(
    program.templates["phase2-torso"]?.pullup_assistance,
  );
  if (assistance?.source_baseline !== "phase2_pullup_assistance_baseline") {
    issues.push(
      "zhuoshu v0.2 pull-up assistance must use phase2_pullup_assistance_baseline",
    );
  }

  validateStrengthTest(program, issues);
  validateSessionTemplates(program, issues);
  validateRecoveryTemplates(program, issues);
  validateSettledTransitions(program, issues);
  validateSettledAliases(program, issues);
  return issues;
}

function validateSettledAliases(program: ProgramSpec, issues: string[]): void {
  const overheadPress = program.exerciseAliases["dumbbell-overhead-press"];
  if (
    overheadPress?.canonical_display_name !== "哑铃推肩" ||
    !sameStringSet(overheadPress.aliases, ["哑铃推肩", "哑铃推举"])
  ) {
    issues.push(
      "zhuoshu v0.2 overhead press aliases do not match settled identity",
    );
  }
  const curl = program.exerciseAliases["dumbbell-curl"];
  if (
    curl?.canonical_display_name !== "哑铃弯举" ||
    !sameStringSet(curl.aliases, ["哑铃弯举"])
  ) {
    issues.push("zhuoshu v0.2 curl aliases do not match settled identity");
  }
}

function validateStrengthTest(program: ProgramSpec, issues: string[]): void {
  const session = program.weeks
    .find(({ week }) => week === 4)
    ?.sessions.find(({ day }) => day === "friday");
  const tests = Array.isArray(session?.tests)
    ? session.tests
        .map(asRecord)
        .filter((test): test is ProgramRecord => test !== undefined)
    : [];

  for (const exercise of MAIN_EXERCISES) {
    if (
      !tests.some(
        (test) =>
          test.exercise === exercise &&
          test.test === "12RM" &&
          test.protocol_ref === "main-12rm" &&
          test.result_binding === "N",
      )
    ) {
      issues.push(`zhuoshu v0.2 ${exercise} must bind main-12rm results to N`);
    }
  }
  if (
    !tests.some(
      (test) =>
        test.exercise === "pull-up" &&
        test.test === "max_reps_first_set" &&
        test.protocol_ref === "pullup-first-set-max" &&
        test.result_binding === "phase2_pullup_assistance_baseline",
    )
  ) {
    issues.push(
      "zhuoshu v0.2 pull-up result must bind phase2_pullup_assistance_baseline",
    );
  }
  if (tests.length !== 4) {
    issues.push("zhuoshu v0.2 week 4 friday must contain exactly four tests");
  }
}

function validateSessionTemplates(
  program: ProgramSpec,
  issues: string[],
): void {
  const expectedTemplates: Readonly<Record<string, string>> = {
    "phase-1/full-body": "phase1-main",
    "phase-2/torso": "phase2-torso",
    "phase-2/limbs": "phase2-limbs",
    "phase-2/torso-recovery": "phase2-torso-recovery",
    "phase-2/limbs-recovery": "phase2-limbs-recovery",
    "phase-3/torso": "phase3-torso",
    "phase-3/limbs": "phase3-limbs",
    "phase-3/torso-recovery": "phase3-torso-recovery",
    "phase-3/limbs-recovery": "phase3-limbs-recovery",
  };
  for (const week of program.weeks) {
    for (const session of week.sessions) {
      const expected = expectedTemplates[`${week.phase}/${session.type}`];
      if (expected !== undefined && session.template !== expected) {
        issues.push(
          `zhuoshu v0.2 ${week.phase} ${session.type} sessions must use ${expected}`,
        );
      }
    }
  }
}

function validateRecoveryTemplates(
  program: ProgramSpec,
  issues: string[],
): void {
  const expectedBases: Readonly<Record<string, string>> = {
    "phase2-torso-recovery": "phase2-torso",
    "phase2-limbs-recovery": "phase2-limbs",
  };
  for (const [templateId, expectedBase] of Object.entries(expectedBases)) {
    if (program.templates[templateId]?.based_on !== expectedBase) {
      issues.push(`zhuoshu v0.2 ${templateId} must inherit ${expectedBase}`);
    }
  }
}

function validateSettledTransitions(
  program: ProgramSpec,
  issues: string[],
): void {
  const courseStart = program.phaseTransitions.course_start;
  if (
    courseStart?.action !== "test_main_12rm" ||
    courseStart.protocol_ref !== "main-12rm" ||
    courseStart.bind_results_to !== "A"
  ) {
    issues.push("zhuoshu v0.2 course_start must run main-12rm and bind A");
  }
  const phaseChange = program.phaseTransitions.phase1_to_phase2;
  if (
    phaseChange?.week !== 4 ||
    phaseChange.day !== "friday" ||
    phaseChange.main_protocol_ref !== "main-12rm" ||
    phaseChange.pullup_protocol_ref !== "pullup-first-set-max" ||
    phaseChange.bind_main_results_to !== "N" ||
    !sameStringSet(phaseChange.actions, [
      "test_main_12rm",
      "test_pullup_first_set_max",
    ])
  ) {
    issues.push(
      "zhuoshu v0.2 phase1_to_phase2 transition does not match settled semantics",
    );
  }
  const cycleEnd = program.phaseTransitions.cycle_end;
  if (
    cycleEnd?.action !== "test_main_12rm" ||
    cycleEnd.protocol_ref !== "main-12rm" ||
    cycleEnd.bind_results_to_next_cycle !== "A" ||
    cycleEnd.restart_from_week !== 1
  ) {
    issues.push(
      "zhuoshu v0.2 cycle_end must retest main-12rm, bind A and restart week 1",
    );
  }
}

function sameStringSet(input: unknown, expected: readonly string[]): boolean {
  return (
    Array.isArray(input) &&
    input.length === expected.length &&
    input.every((value) => typeof value === "string") &&
    new Set(input).size === expected.length &&
    expected.every((value) => input.includes(value))
  );
}

function asRecord(input: unknown): ProgramRecord | undefined {
  return typeof input === "object" && input !== null && !Array.isArray(input)
    ? (input as ProgramRecord)
    : undefined;
}

function fidelityHash(input: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(sortKeys(input)))
    .digest("hex");
}

function sortKeys(input: unknown): unknown {
  if (Array.isArray(input)) {
    return input.map(sortKeys);
  }
  const record = asRecord(input);
  if (record === undefined) {
    return input;
  }
  return Object.fromEntries(
    Object.keys(record)
      .sort()
      .map((key) => [key, sortKeys(record[key])]),
  );
}
