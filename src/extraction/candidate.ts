import type {
  ObservationField,
  SpecialSessionFacts,
  StrengthTestActual,
  StrengthTestResult,
  WorkoutExerciseActual,
  WorkoutLoad,
  WorkoutLogFacts,
} from "../domain/observation.js";

export type CandidateField<T> = ObservationField<T>;

export type WorkoutSetCandidate = ObservationField<number | null>;

export type WorkoutExerciseCandidate = WorkoutExerciseActual;

type CandidateUncertainty = {
  readonly path: string;
  readonly kind:
    | "unknown"
    | "low-confidence"
    | "conflict"
    | "confirmation-required";
  readonly candidates?: readonly string[];
};

export type OrdinaryWorkoutLogCandidate = WorkoutLogFacts & {
  readonly uncertainFields: readonly CandidateUncertainty[];
};

export type SpecialSessionCandidate = SpecialSessionFacts & {
  readonly uncertainFields: readonly CandidateUncertainty[];
};

export type WorkoutLogCandidate =
  | OrdinaryWorkoutLogCandidate
  | SpecialSessionCandidate;

export type WorkoutLogFieldLocation =
  | {
      readonly kind: "top-level";
      readonly key: "layout" | "stage" | "week" | "weekday" | "sessionType";
    }
  | {
      readonly kind: "exercise";
      readonly exerciseIndex: number;
      readonly key:
        | "rawLabel"
        | "exerciseId"
        | "load"
        | "actionQuality"
        | "problemNote";
    }
  | {
      readonly kind: "set";
      readonly exerciseIndex: number;
      readonly setIndex: number;
    }
  | {
      readonly kind: "test-result";
      readonly testResultIndex: number;
      readonly key: "exerciseId" | "result";
    };

const CONFIDENCE_FIELD_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["value", "confidence"],
  properties: {
    confidence: { type: "string", enum: ["high", "low"] },
  },
} as const;

function fieldSchema(value: Readonly<Record<string, unknown>>) {
  return {
    ...CONFIDENCE_FIELD_SCHEMA,
    properties: { ...CONFIDENCE_FIELD_SCHEMA.properties, value },
  } as const;
}

const NULLABLE_STRING = { type: ["string", "null"] } as const;
const ORDINARY_SESSION_TYPES = [
  "full-body",
  "torso",
  "limbs",
  "torso-recovery",
  "limbs-recovery",
] as const;
const CANONICAL_EXERCISE_IDS = [
  "goblet-squat",
  "dumbbell-bench-press",
  "dumbbell-deadlift",
  "plank",
  "pull-up",
  "dumbbell-overhead-press",
  "dumbbell-lateral-raise",
  "push-up",
  "one-arm-dumbbell-row",
  "dumbbell-curl",
  "dumbbell-hammer-curl",
] as const;
const UNCERTAINTY_PATH_PATTERN =
  "^(layout|stage|week|weekday|sessionType)\\.value$|^exercises\\[\\d+\\]\\.(rawLabel|exerciseId|load|actionQuality|problemNote)\\.value$|^exercises\\[\\d+\\]\\.sets\\[\\d+\\]\\.value$|^testResults\\[\\d+\\]\\.(exerciseId|result)\\.value$";
const LOAD_SCHEMA = {
  anyOf: [
    { type: "null" },
    {
      type: "object",
      additionalProperties: false,
      required: ["kind", "value", "unit", "raw"],
      properties: {
        kind: { const: "kg" },
        value: { type: "number", exclusiveMinimum: 0 },
        unit: { const: "kg" },
        raw: { type: "string", minLength: 1 },
      },
    },
    ...(["bodyweight", "none"] as const).map((kind) => ({
      type: "object",
      additionalProperties: false,
      required: ["kind", "raw"],
      properties: {
        kind: { const: kind },
        raw: { type: "string", minLength: 1 },
      },
    })),
    {
      type: "object",
      additionalProperties: false,
      required: ["kind", "mode", "raw"],
      properties: {
        kind: { const: "assistance" },
        mode: { const: "resistance-band" },
        raw: { type: "string", minLength: 1 },
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["kind", "variant", "raw"],
      properties: {
        kind: { const: "variant" },
        variant: { type: "string", minLength: 1 },
        raw: { type: "string", minLength: 1 },
      },
    },
  ],
} as const;

const ORDINARY_WORKOUT_LOG_CANDIDATE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "layout",
    "stage",
    "week",
    "weekday",
    "sessionType",
    "exercises",
    "uncertainFields",
  ],
  properties: {
    layout: fieldSchema({ const: "zhuoshu-three-stage-workbook" }),
    stage: fieldSchema({ type: "integer", minimum: 1, maximum: 3 }),
    week: fieldSchema({ type: "integer", minimum: 1, maximum: 12 }),
    weekday: fieldSchema({
      type: "string",
      enum: ["monday", "tuesday", "wednesday", "thursday", "friday"],
    }),
    sessionType: fieldSchema({ type: "string", enum: ORDINARY_SESSION_TYPES }),
    exercises: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "rawLabel",
          "exerciseId",
          "load",
          "sets",
          "actionQuality",
          "problemNote",
        ],
        properties: {
          rawLabel: fieldSchema({ type: "string", minLength: 1 }),
          exerciseId: fieldSchema({
            type: "string",
            enum: CANONICAL_EXERCISE_IDS,
          }),
          load: fieldSchema(LOAD_SCHEMA),
          sets: {
            type: "array",
            minItems: 1,
            maxItems: 6,
            items: fieldSchema({
              anyOf: [{ type: "number", minimum: 0 }, { type: "null" }],
            }),
          },
          actionQuality: fieldSchema({
            anyOf: [{ enum: ["高", "中", "低"] }, { type: "null" }],
          }),
          problemNote: fieldSchema(NULLABLE_STRING),
        },
      },
    },
    uncertainFields: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["path", "kind"],
        properties: {
          path: { type: "string", pattern: UNCERTAINTY_PATH_PATTERN },
          kind: {
            type: "string",
            enum: [
              "unknown",
              "low-confidence",
              "conflict",
              "confirmation-required",
            ],
          },
          candidates: {
            type: "array",
            items: { type: "string", minLength: 1 },
          },
        },
      },
    },
  },
} as const;

const STRENGTH_TEST_RESULT_SCHEMA = {
  anyOf: [
    { type: "null" },
    {
      type: "object",
      additionalProperties: false,
      required: ["kind", "value", "unit", "raw"],
      properties: {
        kind: { const: "kg" },
        value: { type: "number", exclusiveMinimum: 0 },
        unit: { const: "kg" },
        raw: { type: "string", minLength: 1 },
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["kind", "value", "raw"],
      properties: {
        kind: { const: "repetitions" },
        value: { type: "integer", minimum: 0 },
        raw: { type: "string", minLength: 1 },
      },
    },
  ],
} as const;

const SPECIAL_SESSION_CANDIDATE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "layout",
    "stage",
    "week",
    "weekday",
    "sessionType",
    "testResults",
    "uncertainFields",
  ],
  properties: {
    layout: fieldSchema({ const: "zhuoshu-strength-test-block" }),
    stage: fieldSchema({ type: "integer", minimum: 1, maximum: 3 }),
    week: fieldSchema({ type: "integer", minimum: 1, maximum: 12 }),
    weekday: fieldSchema({
      type: "string",
      enum: ["monday", "tuesday", "wednesday", "thursday", "friday"],
    }),
    sessionType: fieldSchema({
      type: "string",
      enum: ["strength_test", "end_of_cycle_retest"],
    }),
    testResults: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["exerciseId", "test", "result"],
        properties: {
          exerciseId: fieldSchema({ type: "string", minLength: 1 }),
          test: {
            type: "string",
            enum: ["12RM", "max_reps_first_set"],
          },
          result: fieldSchema(STRENGTH_TEST_RESULT_SCHEMA),
        },
      },
    },
    uncertainFields:
      ORDINARY_WORKOUT_LOG_CANDIDATE_SCHEMA.properties.uncertainFields,
  },
} as const;

const MULTI_SESSION_PAGE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["layout", "reason"],
  properties: {
    layout: { const: "multi-session-page" },
    reason: { const: "multiple-session-blocks" },
  },
} as const;

export const WORKOUT_LOG_CANDIDATE_SCHEMA = {
  oneOf: [
    ORDINARY_WORKOUT_LOG_CANDIDATE_SCHEMA,
    SPECIAL_SESSION_CANDIDATE_SCHEMA,
    MULTI_SESSION_PAGE_SCHEMA,
  ],
} as const;

const SESSION_TYPE_ALIASES: Readonly<Record<string, string>> = {
  full_body: "full-body",
  full_body_training: "full-body",
  "full-body-training": "full-body",
  全身训练: "full-body",
  躯干训练: "torso",
  四肢训练: "limbs",
};

const CANONICAL_EXERCISE_ID_SET = new Set<string>(CANONICAL_EXERCISE_IDS);

export function normalizeWorkoutLogExtraction(value: unknown): unknown {
  if (!isRecord(value)) return value;
  const normalized = structuredClone(value);
  if (!isRecord(normalized)) return value;
  normalizeFieldAlias(normalized.sessionType, SESSION_TYPE_ALIASES);
  if (Array.isArray(normalized.exercises)) {
    for (const exercise of normalized.exercises) {
      if (!isRecord(exercise) || !isRecord(exercise.exerciseId)) continue;
      const exerciseId = exercise.exerciseId.value;
      if (typeof exerciseId !== "string") continue;
      const hyphenated = exerciseId.replaceAll("_", "-");
      if (CANONICAL_EXERCISE_ID_SET.has(hyphenated)) {
        exercise.exerciseId.value = hyphenated;
      }
    }
  }
  if (Array.isArray(normalized.uncertainFields)) {
    for (const uncertainty of normalized.uncertainFields) {
      if (!isRecord(uncertainty) || typeof uncertainty.path !== "string") continue;
      uncertainty.path = normalizeUncertaintyPath(uncertainty.path);
      if (
        uncertainty.path === "sessionType.value" &&
        Array.isArray(uncertainty.candidates)
      ) {
        uncertainty.candidates = uncertainty.candidates.map((candidate) =>
          typeof candidate === "string"
            ? (SESSION_TYPE_ALIASES[candidate] ?? candidate)
            : candidate
        );
      }
    }
  }
  return normalized;
}

function normalizeFieldAlias(
  field: unknown,
  aliases: Readonly<Record<string, string>>,
): void {
  if (!isRecord(field) || typeof field.value !== "string") return;
  field.value = aliases[field.value] ?? field.value;
}

function normalizeUncertaintyPath(path: string): string {
  if (parseWorkoutLogFieldPath(path) !== undefined) return path;
  const candidate = `${path}.value`;
  return parseWorkoutLogFieldPath(candidate) === undefined ? path : candidate;
}

export class InvalidWorkoutLogCandidateError extends Error {
  constructor() {
    super("Structured extraction did not match the workout-log candidate schema");
    this.name = "InvalidWorkoutLogCandidateError";
  }
}

export class MultiSessionWorkoutLogPageError extends Error {
  constructor() {
    super("Workout-log image contains multiple session blocks; crop to exactly one session");
    this.name = "MultiSessionWorkoutLogPageError";
  }
}

export function parseWorkoutLogCandidate(value: unknown): WorkoutLogCandidate {
  if (!isRecord(value)) {
    throw new InvalidWorkoutLogCandidateError();
  }
  if (
    value.layout === "multi-session-page" &&
    value.reason === "multiple-session-blocks"
  ) {
    throw new MultiSessionWorkoutLogPageError();
  }
  if (value.layout !== undefined && isCandidateField(
    value.layout,
    (input): input is "zhuoshu-strength-test-block" =>
      input === "zhuoshu-strength-test-block",
  )) {
    return parseSpecialSessionCandidate(value);
  }
  if (!hasOnlyKeys(value, [
    "layout",
    "stage",
    "week",
    "weekday",
    "sessionType",
    "exercises",
    "uncertainFields",
  ])) {
    throw new InvalidWorkoutLogCandidateError();
  }

  const stage = candidateField(value.stage, isStage);
  const week = candidateField(value.week, isWeek);
  const expectedStage = Math.ceil(week.value / 4);
  const exercises = Array.isArray(value.exercises)
    ? value.exercises.map(parseExercise)
    : invalid();
  const uncertainFields = Array.isArray(value.uncertainFields)
    ? value.uncertainFields
    : invalid();
  const uncertainPaths = uncertainFields
    .filter(isUncertainField)
    .map((field) => field.path);
  const lowConfidencePaths = candidateFieldPaths({
    layout: value.layout,
    stage,
    week,
    weekday: value.weekday,
    sessionType: value.sessionType,
    exercises,
  }).filter(({ confidence }) => confidence === "low").map(({ path }) => path);
  if (
    candidateField(value.layout, (input) => input === "zhuoshu-three-stage-workbook").value !==
      "zhuoshu-three-stage-workbook" ||
    stage.value !== expectedStage ||
    !isCandidateField(value.weekday, isWeekday) ||
    !isCandidateField(value.sessionType, isNonEmptyString) ||
    exercises.length === 0 ||
    !uncertainFields.every(isUncertainField) ||
    uncertainPaths.length !== uncertainFields.length ||
    new Set(uncertainPaths).size !== uncertainPaths.length ||
    !uncertainPaths.every((path) => isCorrectablePath(path, exercises)) ||
    !lowConfidencePaths.every((path) => uncertainPaths.includes(path))
  ) {
    throw new InvalidWorkoutLogCandidateError();
  }

  return {
    layout: value.layout as OrdinaryWorkoutLogCandidate["layout"],
    stage,
    week,
    weekday: value.weekday as OrdinaryWorkoutLogCandidate["weekday"],
    sessionType: value.sessionType as OrdinaryWorkoutLogCandidate["sessionType"],
    exercises,
    uncertainFields: uncertainFields as OrdinaryWorkoutLogCandidate["uncertainFields"],
  };
}

function parseSpecialSessionCandidate(
  value: Record<string, unknown>,
): SpecialSessionCandidate {
  if (!hasOnlyKeys(value, [
    "layout",
    "stage",
    "week",
    "weekday",
    "sessionType",
    "testResults",
    "uncertainFields",
  ])) {
    return invalid();
  }
  const stage = candidateField(value.stage, isStage);
  const week = candidateField(value.week, isWeek);
  const testResults = Array.isArray(value.testResults)
    ? value.testResults.map(parseTestResult)
    : invalid();
  const uncertainFields = Array.isArray(value.uncertainFields)
    ? value.uncertainFields
    : invalid();
  const uncertainPaths = uncertainFields
    .filter(isUncertainField)
    .map(({ path }) => path);
  const lowConfidencePaths = specialCandidateFieldPaths({
    layout: value.layout,
    stage,
    week,
    weekday: value.weekday,
    sessionType: value.sessionType,
    testResults,
  })
    .filter(({ confidence }) => confidence === "low")
    .map(({ path }) => path);
  if (
    stage.value !== Math.ceil(week.value / 4) ||
    !isCandidateField(value.weekday, isWeekday) ||
    !isCandidateField(value.sessionType, isSpecialSessionType) ||
    testResults.length === 0 ||
    !uncertainFields.every(isUncertainField) ||
    uncertainPaths.length !== uncertainFields.length ||
    new Set(uncertainPaths).size !== uncertainPaths.length ||
    !uncertainPaths.every((path) => isCorrectableSpecialPath(path, testResults)) ||
    !lowConfidencePaths.every((path) => uncertainPaths.includes(path))
  ) {
    return invalid();
  }
  return {
    layout: value.layout as SpecialSessionCandidate["layout"],
    stage,
    week,
    weekday: value.weekday as SpecialSessionCandidate["weekday"],
    sessionType: value.sessionType as SpecialSessionCandidate["sessionType"],
    testResults,
    uncertainFields: uncertainFields as SpecialSessionCandidate["uncertainFields"],
  };
}

function parseTestResult(value: unknown): StrengthTestActual {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["exerciseId", "test", "result"]) ||
    !isCandidateField(value.exerciseId, isNonEmptyString) ||
    (value.test !== "12RM" && value.test !== "max_reps_first_set") ||
    !isCandidateField(value.result, isStrengthTestResultOrNull)
  ) {
    return invalid();
  }
  return value as StrengthTestActual;
}

function parseExercise(value: unknown): WorkoutExerciseCandidate {
  if (!isRecord(value) || !hasOnlyKeys(value, [
    "rawLabel",
    "exerciseId",
    "load",
    "sets",
    "actionQuality",
    "problemNote",
  ])) {
    return invalid();
  }
  const exerciseId = candidateField(value.exerciseId, isNonEmptyString);
  if (
    !isCandidateField(value.rawLabel, isNonEmptyString) ||
    !isCandidateField(value.load, isWorkoutLoadOrNull) ||
    !Array.isArray(value.sets) ||
    value.sets.length === 0 ||
    value.sets.length > 6 ||
    !value.sets.every((set) => isCandidateField(set, isSetValue)) ||
    !isCandidateField(value.actionQuality, isActionQuality) ||
    !isCandidateField(value.problemNote, isNullableString)
  ) {
    return invalid();
  }
  const semantic = exerciseId.value === "plank"
    ? "duration-seconds" as const
    : "repetitions" as const;
  return {
    rawLabel: value.rawLabel as WorkoutExerciseCandidate["rawLabel"],
    exerciseId,
    load: value.load as WorkoutExerciseCandidate["load"],
    sets: value.sets.map((set) => ({
      ...(set as WorkoutSetCandidate),
      semantic,
    })),
    actionQuality: value.actionQuality as WorkoutExerciseCandidate["actionQuality"],
    problemNote: value.problemNote as WorkoutExerciseCandidate["problemNote"],
  };
}

function candidateField<T>(
  value: unknown,
  accepts: (input: unknown) => input is T,
): CandidateField<T> {
  if (!isCandidateField(value, accepts)) {
    return invalid();
  }
  return value;
}

function isCandidateField<T>(
  value: unknown,
  accepts: (input: unknown) => input is T,
): value is CandidateField<T> {
  return isRecord(value) &&
    hasOnlyKeys(value, ["value", "confidence"]) &&
    accepts(value.value) &&
    (value.confidence === "high" || value.confidence === "low");
}

function isWorkoutLoadOrNull(value: unknown): value is WorkoutLoad | null {
  if (value === null) return true;
  if (!isRecord(value) || !isNonEmptyString(value.raw)) return false;
  if (value.kind === "kg") {
    return hasOnlyKeys(value, ["kind", "value", "unit", "raw"]) &&
      typeof value.value === "number" && value.value > 0 && value.unit === "kg";
  }
  if (value.kind === "bodyweight" || value.kind === "none") {
    return hasOnlyKeys(value, ["kind", "raw"]);
  }
  if (value.kind === "assistance") {
    return hasOnlyKeys(value, ["kind", "mode", "raw"]) &&
      value.mode === "resistance-band";
  }
  return value.kind === "variant" &&
    hasOnlyKeys(value, ["kind", "variant", "raw"]) &&
    isNonEmptyString(value.variant);
}

function isStrengthTestResultOrNull(
  value: unknown,
): value is StrengthTestResult | null {
  if (value === null) return true;
  if (!isRecord(value) || !isNonEmptyString(value.raw)) return false;
  if (value.kind === "kg") {
    return hasOnlyKeys(value, ["kind", "value", "unit", "raw"]) &&
      typeof value.value === "number" &&
      value.value > 0 &&
      value.unit === "kg";
  }
  return value.kind === "repetitions" &&
    hasOnlyKeys(value, ["kind", "value", "raw"]) &&
    Number.isInteger(value.value) &&
    typeof value.value === "number" &&
    value.value >= 0;
}

function isStage(value: unknown): value is 1 | 2 | 3 {
  return Number.isInteger(value) && typeof value === "number" && value >= 1 && value <= 3;
}

function isWeek(value: unknown): value is number {
  return Number.isInteger(value) && typeof value === "number" && value >= 1 && value <= 12;
}

function isWeekday(value: unknown): value is WorkoutLogCandidate["weekday"]["value"] {
  return ["monday", "tuesday", "wednesday", "thursday", "friday"].includes(
    value as string,
  );
}

function isSpecialSessionType(
  value: unknown,
): value is SpecialSessionCandidate["sessionType"]["value"] {
  return value === "strength_test" || value === "end_of_cycle_retest";
}

function isSetValue(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value) && value >= 0);
}

function isActionQuality(value: unknown): value is "高" | "中" | "低" | null {
  return value === null || value === "高" || value === "中" || value === "低";
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isUncertainField(value: unknown): value is WorkoutLogCandidate["uncertainFields"][number] {
  return isRecord(value) &&
    hasOnlyKeys(value, ["path", "kind", "candidates"]) &&
    isNonEmptyString(value.path) &&
    (value.kind === "unknown" ||
      value.kind === "low-confidence" ||
      value.kind === "conflict" ||
      value.kind === "confirmation-required") &&
    (value.candidates === undefined ||
      (Array.isArray(value.candidates) && value.candidates.every(isNonEmptyString)));
}

function isCorrectablePath(
  path: string,
  exercises: readonly WorkoutExerciseCandidate[],
): boolean {
  const location = parseWorkoutLogFieldPath(path);
  if (location === undefined || location.kind === "top-level") {
    return location !== undefined;
  }
  if (location.kind === "exercise") {
    return exercises[location.exerciseIndex] !== undefined;
  }
  if (location.kind === "test-result") {
    return false;
  }
  return exercises[location.exerciseIndex]?.sets[location.setIndex] !== undefined;
}

function isCorrectableSpecialPath(
  path: string,
  testResults: readonly StrengthTestActual[],
): boolean {
  const location = parseWorkoutLogFieldPath(path);
  if (location === undefined) return false;
  if (location.kind === "top-level") {
    return true;
  }
  return location.kind === "test-result" &&
    testResults[location.testResultIndex] !== undefined;
}

export function parseWorkoutLogFieldPath(
  path: string,
): WorkoutLogFieldLocation | undefined {
  const topLevel = /^(layout|stage|week|weekday|sessionType)\.value$/u.exec(path);
  if (topLevel !== null) {
    return {
      kind: "top-level",
      key: topLevel[1] as Extract<WorkoutLogFieldLocation, { kind: "top-level" }>["key"],
    };
  }
  const exercise = /^exercises\[(\d+)\]\.(rawLabel|exerciseId|load|actionQuality|problemNote)\.value$/u.exec(path);
  if (exercise !== null) {
    return {
      kind: "exercise",
      exerciseIndex: Number(exercise[1]),
      key: exercise[2] as Extract<WorkoutLogFieldLocation, { kind: "exercise" }>["key"],
    };
  }
  const set = /^exercises\[(\d+)\]\.sets\[(\d+)\]\.value$/u.exec(path);
  if (set !== null) {
    return {
        kind: "set",
        exerciseIndex: Number(set[1]),
        setIndex: Number(set[2]),
      };
  }
  const testResult = /^testResults\[(\d+)\]\.(exerciseId|result)\.value$/u.exec(
    path,
  );
  return testResult === null
    ? undefined
    : {
        kind: "test-result",
        testResultIndex: Number(testResult[1]),
        key: testResult[2] as "exerciseId" | "result",
      };
}

function candidateFieldPaths(input: {
  readonly layout: unknown;
  readonly stage: unknown;
  readonly week: unknown;
  readonly weekday: unknown;
  readonly sessionType: unknown;
  readonly exercises: readonly WorkoutExerciseCandidate[];
}): readonly { readonly path: string; readonly confidence: "high" | "low" }[] {
  const fields: Array<{ path: string; confidence: "high" | "low" }> = [];
  for (const key of ["layout", "stage", "week", "weekday", "sessionType"] as const) {
    const field = input[key];
    if (isRecord(field) && (field.confidence === "high" || field.confidence === "low")) {
      fields.push({ path: `${key}.value`, confidence: field.confidence });
    }
  }
  input.exercises.forEach((exercise, exerciseIndex) => {
    for (const key of [
      "rawLabel",
      "exerciseId",
      "load",
      "actionQuality",
      "problemNote",
    ] as const) {
      fields.push({
        path: `exercises[${exerciseIndex}].${key}.value`,
        confidence: exercise[key].confidence,
      });
    }
    exercise.sets.forEach((set, setIndex) => {
      fields.push({
        path: `exercises[${exerciseIndex}].sets[${setIndex}].value`,
        confidence: set.confidence,
      });
    });
  });
  return fields;
}

function specialCandidateFieldPaths(input: {
  readonly layout: unknown;
  readonly stage: unknown;
  readonly week: unknown;
  readonly weekday: unknown;
  readonly sessionType: unknown;
  readonly testResults: readonly StrengthTestActual[];
}): readonly { readonly path: string; readonly confidence: "high" | "low" }[] {
  const fields: Array<{ path: string; confidence: "high" | "low" }> = [];
  for (const key of ["layout", "stage", "week", "weekday", "sessionType"] as const) {
    const field = input[key];
    if (isRecord(field) && (field.confidence === "high" || field.confidence === "low")) {
      fields.push({ path: `${key}.value`, confidence: field.confidence });
    }
  }
  input.testResults.forEach((result, index) => {
    fields.push({
      path: `testResults[${index}].exerciseId.value`,
      confidence: result.exerciseId.confidence,
    });
    fields.push({
      path: `testResults[${index}].result.value`,
      confidence: result.result.confidence,
    });
  });
  return fields;
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.filter((key) => key in value).length &&
    Object.keys(value).every((key) => keys.includes(key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalid(): never {
  throw new InvalidWorkoutLogCandidateError();
}
