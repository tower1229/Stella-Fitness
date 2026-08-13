import type {
  SpecialSessionObservation,
  StrengthTestActual,
} from "../domain/observation.js";
import type {
  CycleCompletionRetest,
  PlannedSession,
  ProgramRecord,
  ProgramSpec,
  ResolvedWorkoutSession,
} from "../domain/program.js";
import type {
  OrdinaryWorkoutLogCandidate,
  SpecialSessionCandidate,
} from "../extraction/candidate.js";
import { resolvePlannedSession } from "./engine.js";
import type {
  AssistanceBinding,
  ProgramState,
  SymbolicLoadBinding,
} from "./state.js";

const WEEKDAY_OFFSET = {
  monday: 0,
  tuesday: 1,
  wednesday: 2,
  thursday: 3,
  friday: 4,
} as const;

export function resolveSpecialSession(options: {
  readonly candidate: SpecialSessionCandidate;
  readonly program: ProgramSpec;
  readonly state: ProgramState;
}): ResolvedWorkoutSession {
  if (options.candidate.sessionType.value === "end_of_cycle_retest") {
    return resolveCycleCompletionRetest(options);
  }
  const plannedSession = resolvePlannedSession({
    program: options.program,
    programVersion: options.state.program.version,
    cycleStart: options.state.cycle.startDate,
    date: sessionDate(options.state.cycle.startDate, options.candidate),
  });
  if (
    plannedSession === null ||
    plannedSession.type !== "strength-test" ||
    plannedSession.cycle.week !== options.candidate.week.value ||
    plannedSession.day !== options.candidate.weekday.value
  ) {
    throw new Error("Workout photo does not identify the planned strength test");
  }
  assertTestResultsMatch(
    plannedSession,
    options.candidate.testResults,
    options.candidate.uncertainFields.length === 0,
  );
  return plannedSession;
}

export function resolveOrdinarySession(options: {
  readonly candidate: OrdinaryWorkoutLogCandidate;
  readonly program: ProgramSpec;
  readonly state: ProgramState;
}): {
  readonly candidate: OrdinaryWorkoutLogCandidate;
  readonly plannedSession: PlannedSession;
} {
  const plannedSession = resolvePlannedSession({
    program: options.program,
    programVersion: options.state.program.version,
    cycleStart: options.state.cycle.startDate,
    date: sessionDate(options.state.cycle.startDate, options.candidate),
  });
  if (plannedSession?.type === "strength-test") {
    throw new Error("Strength-test photos must use the strength_test layout");
  }
  if (plannedSession === null) {
    throw new Error("Workout photo does not identify a planned session");
  }
  const expectedPhase = `phase-${options.candidate.stage.value}`;
  if (
    plannedSession.cycle.phase !== expectedPhase ||
    plannedSession.cycle.week !== options.candidate.week.value ||
    plannedSession.day !== options.candidate.weekday.value
  ) {
    throw new Error("Workout photo location does not match its planned session");
  }
  if (
    !plannedSession.recovery &&
    plannedSession.type !== options.candidate.sessionType.value
  ) {
    throw new Error("Workout photo type does not match its planned session");
  }
  const plannedExercises = new Set<string>(
    plannedSession.exercises.map(({ exerciseId }) => exerciseId),
  );
  const candidateExerciseIds = options.candidate.exercises.map(
    ({ exerciseId }) => exerciseId.value,
  );
  const candidateExercises = new Set(candidateExerciseIds);
  if (
    candidateExercises.size !== candidateExerciseIds.length ||
    candidateExercises.size !== plannedExercises.size ||
    candidateExerciseIds.some((exerciseId) => !plannedExercises.has(exerciseId))
  ) {
    throw new Error("Workout photo exercises do not match its planned session");
  }
  return {
    candidate: plannedSession.recovery
      ? {
          ...options.candidate,
          sessionType: {
            value: plannedSession.type,
            confidence: "high",
          },
        }
      : options.candidate,
    plannedSession,
  };
}

export function applyStrengthTestBindings(options: {
  readonly state: ProgramState;
  readonly observation: SpecialSessionObservation;
}): ProgramState {
  const symbolicLoadBindings = structuredClone(
    options.state.symbolicLoadBindings,
  ) as Record<string, Record<string, SymbolicLoadBinding>>;
  const assistanceBindings = structuredClone(
    options.state.assistanceBindings,
  ) as Record<string, AssistanceBinding>;
  const plannedByExercise = new Map(
    options.observation.plannedSession.tests.map((test) => [
      test.exerciseId,
      test,
    ]),
  );
  if (options.observation.sessionType.value === "end_of_cycle_retest") {
    const nextCycleBindings: Record<
      string,
      Record<"A", SymbolicLoadBinding>
    > = {};
    for (const actual of options.observation.testResults) {
      const planned = plannedByExercise.get(actual.exerciseId.value);
      const result = actual.result.value;
      if (
        planned?.resultBinding !== "A" ||
        actual.test !== "12RM" ||
        result?.kind !== "kg"
      ) {
        throw new Error("Next-cycle A requires each confirmed 12RM result");
      }
      nextCycleBindings[actual.exerciseId.value] = {
        A: {
          value: result.value,
          unit: "kg",
          test: "12RM",
          observationId: options.observation.id,
          recordedAt: options.observation.provenance.recordedAt,
        },
      };
    }
    return {
      ...options.state,
      nextCycle: {
        restartFromWeek: 1,
        symbolicLoadBindings: nextCycleBindings,
        sourceObservationId: options.observation.id,
      },
    };
  }
  for (const actual of options.observation.testResults) {
    const planned = plannedByExercise.get(actual.exerciseId.value);
    const result = actual.result.value;
    if (planned === undefined || result === null) {
      throw new Error("Strength-test Observation is incomplete");
    }
    if (planned.resultBinding === "N") {
      if (actual.test !== "12RM" || result.kind !== "kg") {
        throw new Error("N requires a confirmed per-exercise 12RM result");
      }
      symbolicLoadBindings[actual.exerciseId.value] = {
        ...(symbolicLoadBindings[actual.exerciseId.value] ?? {}),
        N: {
          value: result.value,
          unit: "kg",
          test: "12RM",
          observationId: options.observation.id,
          recordedAt: options.observation.provenance.recordedAt,
        },
      };
      continue;
    }
    if (
      actual.exerciseId.value !== "pull-up" ||
      actual.test !== "max_reps_first_set" ||
      result.kind !== "repetitions"
    ) {
      throw new Error("Assistance relationship requires the pull-up max result");
    }
    assistanceBindings[planned.resultBinding] = {
      exerciseId: "pull-up",
      result: { value: result.value, unit: "repetitions" },
      test: "max_reps_first_set",
      observationId: options.observation.id,
      recordedAt: options.observation.provenance.recordedAt,
    };
  }
  return {
    ...options.state,
    symbolicLoadBindings,
    assistanceBindings,
  };
}

function resolveCycleCompletionRetest(options: {
  readonly candidate: SpecialSessionCandidate;
  readonly program: ProgramSpec;
  readonly state: ProgramState;
}): CycleCompletionRetest {
  if (options.candidate.week.value !== 12 || options.candidate.stage.value !== 3) {
    throw new Error("End-of-cycle retest requires a completed 12-week cycle");
  }
  const completion = options.program.cycleCompletion;
  if (
    completion.retest !== "12RM" ||
    completion.bind_to !== "A" ||
    completion.restart_from_week !== 1
  ) {
    throw new Error("ProgramSpec cycle completion is unsupported");
  }
  const protocolRef = requiredText(completion.protocol_ref, "cycle protocol");
  const protocol = requiredRecord(
    options.program.testingProtocols[protocolRef],
    `testing protocol ${protocolRef}`,
  );
  const exercises = stringArray(protocol.applies_to, `${protocolRef}.applies_to`);
  const planned: CycleCompletionRetest = {
    kind: "cycle-completion-retest",
    program: {
      id: options.program.id,
      version: options.program.version,
      schemaVersion: options.program.schemaVersion,
    },
    cycle: {
      startDate: options.state.cycle.startDate,
      completedWeek: 12,
    },
    type: "end-of-cycle-retest",
    tests: exercises.map((exerciseId) => ({
      exerciseId,
      test: "12RM",
      protocolRef,
      resultBinding: "A",
      bindingScope: "per_exercise",
    })),
    restartFromWeek: 1,
  };
  assertTestResultsMatch(
    planned,
    options.candidate.testResults,
    options.candidate.uncertainFields.length === 0,
  );
  return planned;
}

function assertTestResultsMatch(
  plannedSession: Pick<ResolvedWorkoutSession, "tests">,
  actuals: readonly StrengthTestActual[],
  requireConfirmedResults: boolean,
): void {
  if (actuals.length !== plannedSession.tests.length) {
    throw new Error("Strength test must include every planned test result");
  }
  const actualByExercise = new Map(
    actuals.map((actual) => [actual.exerciseId.value, actual]),
  );
  if (actualByExercise.size !== actuals.length) {
    throw new Error("Strength test contains a duplicate exercise result");
  }
  for (const planned of plannedSession.tests) {
    const actual = actualByExercise.get(planned.exerciseId);
    if (
      actual === undefined ||
      actual.test !== planned.test ||
      (requireConfirmedResults && actual.result.value === null) ||
      (actual.result.value !== null &&
        planned.test === "12RM" &&
        actual.result.value.kind !== "kg") ||
      (planned.test === "max_reps_first_set" &&
        actual.result.value !== null &&
        actual.result.value.kind !== "repetitions")
    ) {
      throw new Error(`Strength-test result does not match ${planned.exerciseId}`);
    }
  }
}

function requiredRecord(value: unknown, path: string): ProgramRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${path} must be an object`);
  }
  return value as ProgramRecord;
}

function requiredText(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${path} must be a non-empty string`);
  }
  return value;
}

function stringArray(value: unknown, path: string): readonly string[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    !value.every((entry) => typeof entry === "string" && entry.length > 0)
  ) {
    throw new Error(`${path} must contain exercise IDs`);
  }
  return value;
}

function sessionDate(
  cycleStart: string,
  candidate: Pick<
    SpecialSessionCandidate | OrdinaryWorkoutLogCandidate,
    "week" | "weekday"
  >,
): string {
  const date = new Date(`${cycleStart}T00:00:00.000Z`);
  date.setUTCDate(
    date.getUTCDate() +
      (candidate.week.value - 1) * 7 +
      WEEKDAY_OFFSET[candidate.weekday.value],
  );
  return date.toISOString().slice(0, 10);
}
