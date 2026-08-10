import type {
  PlannedExercise,
  PlannedLoad,
  PlannedPrescription,
  PlannedSession,
  PlannedTest,
  ProgramRecord,
  ProgramSession,
  ProgramSpec,
} from "../domain/program.js";

const MILLISECONDS_PER_DAY = 86_400_000;
const WEEKDAY_BY_OFFSET = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;

export class ProgramResolutionError extends Error {
  constructor(message: string) {
    super(`Program Engine failed closed: ${message}`);
    this.name = "ProgramResolutionError";
  }
}

export function resolvePlannedSession(input: {
  program: ProgramSpec;
  programVersion: string;
  cycleStart: string;
  date: string;
}): PlannedSession | null {
  if (input.program.version !== input.programVersion) {
    throw new ProgramResolutionError(
      `requested version ${input.programVersion} does not match ${input.program.version}`,
    );
  }
  const cycleStart = parseDate(input.cycleStart, "cycle start");
  const date = parseDate(input.date, "date");
  if (cycleStart.getUTCDay() !== 1) {
    throw new ProgramResolutionError("cycle start must be a Monday");
  }

  const dayOffset = Math.round(
    (date.getTime() - cycleStart.getTime()) / MILLISECONDS_PER_DAY,
  );
  if (dayOffset < 0 || dayOffset >= input.program.weeks.length * 7) {
    return null;
  }
  const weekNumber = Math.floor(dayOffset / 7) + 1;
  const day = WEEKDAY_BY_OFFSET[dayOffset % 7];
  if (day === undefined) {
    throw new ProgramResolutionError("date does not resolve to a weekday");
  }
  const week = input.program.weeks.find(({ week }) => week === weekNumber);
  if (week === undefined) {
    throw new ProgramResolutionError(`week ${weekNumber} is missing`);
  }
  const session = week.sessions.find((candidate) => candidate.day === day);
  if (session === undefined) {
    return null;
  }

  return {
    kind: "planned-session",
    program: {
      id: input.program.id,
      version: input.program.version,
      schemaVersion: input.program.schemaVersion,
    },
    cycle: {
      startDate: input.cycleStart,
      week: weekNumber,
      phase: week.phase,
    },
    date: input.date,
    day,
    type: session.type,
    recovery: session.type.includes("recovery"),
    exercises: resolveExercises(input.program, session),
    tests: resolveTests(input.program, session),
  };
}

function resolveExercises(
  program: ProgramSpec,
  session: ProgramSession,
): readonly PlannedExercise[] {
  const templateId = optionalText(session.template);
  if (templateId === undefined) {
    if (session.type === "strength-test") {
      return [];
    }
    throw new ProgramResolutionError(`${session.type} session has no template`);
  }
  const template = program.templates[templateId];
  if (template === undefined) {
    throw new ProgramResolutionError(`template ${templateId} is missing`);
  }
  const exercises = effectiveExercises(program, templateId, new Set());
  const assistance = resolveTemplateAssistance(program, templateId, new Set());
  return exercises.map((exercise) =>
    resolveExercise(program, template, session, exercise, assistance),
  );
}

function resolveTemplateAssistance(
  program: ProgramSpec,
  templateId: string,
  visited: Set<string>,
): ProgramRecord | undefined {
  if (visited.has(templateId)) {
    throw new ProgramResolutionError(`template cycle includes ${templateId}`);
  }
  visited.add(templateId);
  const template = program.templates[templateId];
  if (template === undefined) {
    throw new ProgramResolutionError(`template ${templateId} is missing`);
  }
  const assistance = requiredRecordOrUndefined(template.pullup_assistance);
  if (assistance !== undefined) {
    return assistance;
  }
  const basedOn = optionalText(template.based_on);
  return basedOn === undefined
    ? undefined
    : resolveTemplateAssistance(program, basedOn, visited);
}

function effectiveExercises(
  program: ProgramSpec,
  templateId: string,
  visited: Set<string>,
): readonly (string | ProgramRecord)[] {
  if (visited.has(templateId)) {
    throw new ProgramResolutionError(`template cycle includes ${templateId}`);
  }
  visited.add(templateId);
  const template = program.templates[templateId];
  if (template === undefined) {
    throw new ProgramResolutionError(`template ${templateId} is missing`);
  }
  if (Array.isArray(template.exercises)) {
    return template.exercises.map((value, index) =>
      typeof value === "string"
        ? value
        : requiredRecord(value, `${templateId}.exercises[${index}]`),
    );
  }
  const basedOn = requiredText(template.based_on, `${templateId}.based_on`);
  return effectiveExercises(program, basedOn, visited).map((exercise) =>
    applyRecoveryOverride(exercise, template.overrides),
  );
}

function applyRecoveryOverride(
  exercise: string | ProgramRecord,
  input: unknown,
): string | ProgramRecord {
  if (typeof exercise === "string") {
    return exercise;
  }
  const overrides = requiredRecord(input, "recovery overrides");
  const exerciseId = requiredText(exercise.exercise, "exercise.exercise");
  const updated: Record<string, unknown> = { ...exercise };

  if (
    exerciseId === "dumbbell-bench-press" &&
    typeof overrides.bench_effort === "string"
  ) {
    updated.effort = overrides.bench_effort;
  }
  if (
    (exercise.role === "main" ||
      exerciseId === "goblet-squat" ||
      exerciseId === "dumbbell-deadlift") &&
    typeof overrides.main_effort === "string"
  ) {
    updated.effort = overrides.main_effort;
  }
  const named =
    exerciseId === "dumbbell-overhead-press"
      ? overrides.overhead_press
      : exerciseId === "dumbbell-lateral-raise"
        ? overrides.lateral_raise
        : undefined;
  if (named !== undefined) {
    const values = requiredRecord(named, `override for ${exerciseId}`);
    updated.prescription = {
      type: "sets_reps",
      sets: values.sets,
      reps: values.reps,
    };
    updated.load = historicalReference(values.load_reference);
    updated.effort = values.effort;
  }
  return updated;
}

function resolveExercise(
  program: ProgramSpec,
  template: ProgramRecord,
  session: ProgramSession,
  input: string | ProgramRecord,
  assistance: ProgramRecord | undefined,
): PlannedExercise {
  if (typeof input === "string") {
    return resolveStringExercise(program, template, session, input);
  }
  const exerciseId = requiredText(input.exercise, "template exercise id");
  const role = optionalText(input.role);
  const prescription = resolvePrescription(
    input,
    template,
    session,
    exerciseId,
    role,
  );
  const displayName =
    optionalText(input.display_name) ??
    optionalText(program.exerciseAliases[exerciseId]?.canonical_display_name);
  const load =
    role === "main"
      ? normalizeLoad(session.load, program)
      : normalizeLoad(input.load, program);
  const restSeconds = numberArray(
    role === "main"
      ? (session.main_rest ?? input.rest_seconds)
      : input.rest_seconds,
  );
  const result: PlannedExercise = {
    exerciseId,
    ...(displayName === undefined ? {} : { displayName }),
    ...(load === undefined ? {} : { load }),
    prescription,
    ...(input.sets === "self_selected" ||
    requiredRecordOrUndefined(input.prescription)?.sets === "self_selected"
      ? { sets: "self_selected" as const }
      : {}),
    ...(input.rest === "self_selected"
      ? { rest: "self_selected" as const }
      : {}),
    ...(restSeconds === undefined ? {} : { restSeconds }),
    ...(optionalText(input.effort) === undefined
      ? {}
      : { effort: optionalText(input.effort)! }),
    ...(requiredRecordOrUndefined(input.progression) === undefined
      ? {}
      : { progression: requiredRecordOrUndefined(input.progression)! }),
    ...(exerciseId === "pull-up" && assistance !== undefined
      ? { assistance }
      : {}),
  };
  return result;
}

function resolveStringExercise(
  program: ProgramSpec,
  template: ProgramRecord,
  session: ProgramSession,
  exerciseId: string,
): PlannedExercise {
  const displayName = optionalText(
    program.exerciseAliases[exerciseId]?.canonical_display_name,
  );
  if (exerciseId === "plank") {
    return {
      exerciseId,
      ...(displayName === undefined ? {} : { displayName }),
      load: { mode: "none" },
      prescription: {
        type: "duration",
        sets: requiredPositiveInteger(template.plank_sets, "plank sets"),
        seconds: requiredPositiveInteger(
          session.plank_seconds,
          "plank seconds",
        ),
      },
      restSeconds: requiredNumberArray(
        template.plank_rest_seconds,
        "plank rest seconds",
      ),
      effort: requiredText(template.plank_effort, "plank effort"),
    };
  }
  return {
    exerciseId,
    ...(displayName === undefined ? {} : { displayName }),
    load: symbolicLoad(session.load),
    prescription: {
      type: "sets_reps",
      sets: requiredPositiveInteger(session.sets, "session sets"),
      reps: requiredPositiveInteger(session.reps, "session reps"),
    },
    restSeconds: requiredNumberArray(
      template.main_rest_seconds,
      "main rest seconds",
    ),
    effort: requiredText(template.main_effort, "main effort"),
  };
}

function resolvePrescription(
  exercise: ProgramRecord,
  template: ProgramRecord,
  session: ProgramSession,
  exerciseId: string,
  role: string | undefined,
): PlannedPrescription {
  if (role === "main") {
    return {
      type: "sets_reps",
      sets: requiredPositiveInteger(session.main_sets, "main sets"),
      reps: requiredPositiveInteger(session.main_reps, "main reps"),
    };
  }
  if (exercise.prescription === "total_reps") {
    return {
      type: "total_reps",
      reps: requiredPositiveInteger(session.pullup_total, "pull-up total reps"),
    };
  }
  if (exercise.prescription === "duration") {
    return {
      type: "duration",
      sets: requiredPositiveInteger(
        exercise.sets ?? template.plank_sets,
        "duration sets",
      ),
      seconds: requiredPositiveInteger(
        session.plank_seconds,
        "duration seconds",
      ),
    };
  }
  const prescription = requiredRecord(
    exercise.prescription,
    `${exerciseId} prescription`,
  );
  const type = requiredText(
    prescription.type,
    `${exerciseId} prescription type`,
  );
  if (type === "sets_reps") {
    return {
      type,
      sets: requiredPositiveInteger(prescription.sets, `${exerciseId} sets`),
      reps: requiredPositiveInteger(prescription.reps, `${exerciseId} reps`),
    };
  }
  if (type === "rep_range") {
    return {
      type,
      sets: requiredPositiveInteger(prescription.sets, `${exerciseId} sets`),
      minReps: requiredPositiveInteger(
        prescription.min_reps,
        `${exerciseId} minimum reps`,
      ),
      maxReps: requiredPositiveInteger(
        prescription.max_reps,
        `${exerciseId} maximum reps`,
      ),
    };
  }
  if (type === "total_reps") {
    return {
      type,
      reps: requiredPositiveInteger(
        prescription.reps ?? session.pullup_total,
        `${exerciseId} total reps`,
      ),
    };
  }
  if (type === "to_failure") {
    return {
      type,
      sets: requiredPositiveInteger(prescription.sets, `${exerciseId} sets`),
    };
  }
  throw new ProgramResolutionError(
    `${exerciseId} has unsupported prescription ${type}`,
  );
}

function resolveTests(
  program: ProgramSpec,
  session: ProgramSession,
): readonly PlannedTest[] {
  if (session.tests === undefined) {
    return [];
  }
  if (!Array.isArray(session.tests)) {
    throw new ProgramResolutionError("session tests must be an array");
  }
  return session.tests.map((input, index) => {
    const test = requiredRecord(input, `tests[${index}]`);
    const resultBinding = requiredText(
      test.result_binding,
      `tests[${index}].result_binding`,
    );
    const exerciseId = requiredText(test.exercise, `tests[${index}].exercise`);
    if (!isKnownResultBinding(program, resultBinding)) {
      throw new ProgramResolutionError(
        `${exerciseId} has unresolved result binding ${resultBinding}`,
      );
    }
    return {
      exerciseId,
      test: requiredText(test.test, `tests[${index}].test`),
      protocolRef: requiredText(
        test.protocol_ref,
        `tests[${index}].protocol_ref`,
      ),
      resultBinding,
      bindingScope: "per_exercise",
    };
  });
}

function isKnownResultBinding(program: ProgramSpec, binding: string): boolean {
  if (program.loadSymbols[binding] !== undefined) {
    return true;
  }
  return Object.values(program.templates).some(
    (template) =>
      requiredRecordOrUndefined(template.pullup_assistance)?.source_baseline ===
      binding,
  );
}

function normalizeLoad(
  input: unknown,
  program: ProgramSpec,
): PlannedLoad | undefined {
  if (input === undefined) {
    return undefined;
  }
  if (input === "self_selected") {
    return { mode: "self_selected" };
  }
  if (input === "none") {
    return { mode: "none" };
  }
  if (typeof input === "string") {
    if (program.loadSymbols[input] === undefined) {
      throw new ProgramResolutionError(`unknown load symbol ${input}`);
    }
    return { mode: "symbolic", symbol: input, scope: "per_exercise" };
  }
  const record = requiredRecord(input, "exercise load");
  if (record.mode === "historical_reference") {
    return {
      mode: "historical_reference",
      week: requiredPositiveInteger(record.week, "historical reference week"),
    };
  }
  throw new ProgramResolutionError("unsupported exercise load");
}

function symbolicLoad(input: unknown): PlannedLoad {
  const symbol = requiredText(input, "symbolic load");
  return { mode: "symbolic", symbol, scope: "per_exercise" };
}

function historicalReference(input: unknown): PlannedLoad {
  const value = requiredText(input, "historical load reference");
  const match = /^week-(\d+)$/.exec(value);
  if (match === null) {
    throw new ProgramResolutionError(
      `invalid historical load reference ${value}`,
    );
  }
  return {
    mode: "historical_reference",
    week: Number(match[1]),
  };
}

function parseDate(input: string, label: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input)) {
    throw new ProgramResolutionError(`${label} must use YYYY-MM-DD`);
  }
  const date = new Date(`${input}T00:00:00.000Z`);
  if (
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== input
  ) {
    throw new ProgramResolutionError(`${label} is not a real calendar date`);
  }
  return date;
}

function requiredRecord(input: unknown, label: string): ProgramRecord {
  const value = requiredRecordOrUndefined(input);
  if (value === undefined) {
    throw new ProgramResolutionError(`${label} must be an object`);
  }
  return value;
}

function requiredRecordOrUndefined(input: unknown): ProgramRecord | undefined {
  return typeof input === "object" && input !== null && !Array.isArray(input)
    ? (input as ProgramRecord)
    : undefined;
}

function requiredText(input: unknown, label: string): string {
  const value = optionalText(input);
  if (value === undefined) {
    throw new ProgramResolutionError(`${label} must be a non-empty string`);
  }
  return value;
}

function optionalText(input: unknown): string | undefined {
  return typeof input === "string" && input.trim().length > 0
    ? input
    : undefined;
}

function requiredPositiveInteger(input: unknown, label: string): number {
  if (!Number.isInteger(input) || (input as number) <= 0) {
    throw new ProgramResolutionError(`${label} must be a positive integer`);
  }
  return input as number;
}

function requiredNumberArray(input: unknown, label: string): readonly number[] {
  const value = numberArray(input);
  if (value === undefined) {
    throw new ProgramResolutionError(`${label} must contain numbers`);
  }
  return value;
}

function numberArray(input: unknown): readonly number[] | undefined {
  return Array.isArray(input) &&
    input.every((value) => typeof value === "number")
    ? input
    : undefined;
}
