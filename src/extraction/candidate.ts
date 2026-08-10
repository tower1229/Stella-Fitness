import type {
  ObservationField,
  WorkoutExerciseActual,
  WorkoutLoad,
  WorkoutLogFacts,
} from "../domain/observation.js";

export type CandidateField<T> = ObservationField<T>;

export type WorkoutSetCandidate = ObservationField<number | null>;

export type WorkoutExerciseCandidate = WorkoutExerciseActual;

export type WorkoutLogCandidate = WorkoutLogFacts & {
  readonly uncertainFields: readonly {
    readonly path: string;
    readonly kind: "unknown" | "low-confidence" | "conflict";
    readonly candidates?: readonly string[];
  }[];
};

const CONFIDENCE_FIELD_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["value", "confidence"],
  properties: {
    confidence: { type: "number", minimum: 0, maximum: 1 },
  },
} as const;

function fieldSchema(value: Readonly<Record<string, unknown>>) {
  return {
    ...CONFIDENCE_FIELD_SCHEMA,
    properties: { ...CONFIDENCE_FIELD_SCHEMA.properties, value },
  } as const;
}

const NULLABLE_STRING = { type: ["string", "null"] } as const;
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

export const WORKOUT_LOG_CANDIDATE_SCHEMA = {
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
    sessionType: fieldSchema({ type: "string", minLength: 1 }),
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
          exerciseId: fieldSchema({ type: "string", minLength: 1 }),
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
          path: { type: "string", minLength: 1 },
          kind: {
            type: "string",
            enum: ["unknown", "low-confidence", "conflict"],
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

export class InvalidWorkoutLogCandidateError extends Error {
  constructor() {
    super("Structured extraction did not match the workout-log candidate schema");
    this.name = "InvalidWorkoutLogCandidateError";
  }
}

export function parseWorkoutLogCandidate(value: unknown): WorkoutLogCandidate {
  if (!isRecord(value) || !hasOnlyKeys(value, [
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
    !uncertainPaths.every((path) => isCorrectablePath(path, exercises))
  ) {
    throw new InvalidWorkoutLogCandidateError();
  }

  return {
    layout: value.layout as WorkoutLogCandidate["layout"],
    stage,
    week,
    weekday: value.weekday as WorkoutLogCandidate["weekday"],
    sessionType: value.sessionType as WorkoutLogCandidate["sessionType"],
    exercises,
    uncertainFields: uncertainFields as WorkoutLogCandidate["uncertainFields"],
  };
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
    typeof value.confidence === "number" &&
    Number.isFinite(value.confidence) &&
    value.confidence >= 0 &&
    value.confidence <= 1;
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
    (value.kind === "unknown" || value.kind === "low-confidence" || value.kind === "conflict") &&
    (value.candidates === undefined ||
      (Array.isArray(value.candidates) && value.candidates.every(isNonEmptyString)));
}

function isCorrectablePath(
  path: string,
  exercises: readonly WorkoutExerciseCandidate[],
): boolean {
  if (/^(layout|stage|week|weekday|sessionType)\.value$/u.test(path)) {
    return true;
  }
  const exerciseField = /^exercises\[(\d+)\]\.(rawLabel|exerciseId|load|actionQuality|problemNote)\.value$/u.exec(path);
  if (exerciseField !== null) {
    return exercises[Number(exerciseField[1])] !== undefined;
  }
  const setField = /^exercises\[(\d+)\]\.sets\[(\d+)\]\.value$/u.exec(path);
  if (setField === null) return false;
  return exercises[Number(setField[1])]?.sets[Number(setField[2])] !== undefined;
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
