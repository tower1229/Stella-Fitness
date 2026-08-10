export type WorkoutLogCandidate = {
  stage: number;
  week: number;
  weekday: string;
  sessionType?: string;
  exercises: Array<{ rawLabel: string }>;
  uncertainFields: Array<{
    path: string;
    kind: "unknown" | "low-confidence" | "conflict";
    candidates?: string[];
  }>;
};

export const WORKOUT_LOG_CANDIDATE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["stage", "week", "weekday", "exercises", "uncertainFields"],
  properties: {
    stage: { type: "integer", minimum: 1, maximum: 3 },
    week: { type: "integer", minimum: 1, maximum: 12 },
    weekday: { type: "string", minLength: 1 },
    sessionType: { type: "string", minLength: 1 },
    exercises: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["rawLabel"],
        properties: {
          rawLabel: { type: "string", minLength: 1 },
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
  if (!isRecord(value)) {
    throw new InvalidWorkoutLogCandidateError();
  }

  const allowedKeys = new Set([
    "stage",
    "week",
    "weekday",
    "sessionType",
    "exercises",
    "uncertainFields",
  ]);
  const validExercises =
    Array.isArray(value.exercises) &&
    value.exercises.every(
      (exercise) =>
        isRecord(exercise) &&
        Object.keys(exercise).length === 1 &&
        isNonEmptyString(exercise.rawLabel),
    );

  if (
    Object.keys(value).some((key) => !allowedKeys.has(key)) ||
    typeof value.stage !== "number" ||
    !Number.isInteger(value.stage) ||
    value.stage < 1 ||
    value.stage > 3 ||
    typeof value.week !== "number" ||
    !Number.isInteger(value.week) ||
    value.week < 1 ||
    value.week > 12 ||
    !isNonEmptyString(value.weekday) ||
    (value.sessionType !== undefined && !isNonEmptyString(value.sessionType)) ||
    !validExercises ||
    !Array.isArray(value.uncertainFields) ||
    !value.uncertainFields.every(isUncertainField)
  ) {
    throw new InvalidWorkoutLogCandidateError();
  }

  return value as WorkoutLogCandidate;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isUncertainField(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }
  const allowedKeys = new Set(["path", "kind", "candidates"]);
  return (
    !Object.keys(value).some((key) => !allowedKeys.has(key)) &&
    isNonEmptyString(value.path) &&
    (value.kind === "unknown" ||
      value.kind === "low-confidence" ||
      value.kind === "conflict") &&
    (value.candidates === undefined ||
      (Array.isArray(value.candidates) &&
        value.candidates.every(isNonEmptyString)))
  );
}
