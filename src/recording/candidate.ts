export type FitnessWriteCandidate =
  | {
      readonly kind: "body-weight";
      readonly amount: number;
      readonly unit: "kg" | "lb";
      readonly occurredAt: string;
    }
  | {
      readonly kind: "initial-12rm";
      readonly exerciseId:
        | "goblet-squat"
        | "dumbbell-bench-press"
        | "dumbbell-deadlift";
      readonly valueKg: number;
      readonly occurredAt: string;
    };

export function parseFitnessWriteCandidate(
  value: unknown,
): FitnessWriteCandidate | undefined {
  if (!isRecord(value) || !hasOnlyCandidateKeys(value)) return undefined;
  if (
    value.kind === "body-weight" &&
    typeof value.amount === "number" &&
    Number.isFinite(value.amount) &&
    value.amount > 0 &&
    (value.unit === "kg" || value.unit === "lb") &&
    isTimestamp(value.occurredAt)
  ) {
    return {
      kind: value.kind,
      amount: value.amount,
      unit: value.unit,
      occurredAt: value.occurredAt,
    };
  }
  const exerciseId = parseInitial12RMExerciseId(value.exerciseId);
  if (
    value.kind === "initial-12rm" &&
    exerciseId !== undefined &&
    typeof value.valueKg === "number" &&
    Number.isFinite(value.valueKg) &&
    value.valueKg > 0 &&
    isTimestamp(value.occurredAt)
  ) {
    return {
      kind: value.kind,
      exerciseId,
      valueKg: value.valueKg,
      occurredAt: value.occurredAt,
    };
  }
  return undefined;
}

export function fitnessWriteCandidateFields(
  candidate: FitnessWriteCandidate,
): Readonly<Record<string, string | number>> {
  return candidate.kind === "body-weight"
    ? {
        amount: candidate.amount,
        unit: candidate.unit,
        occurredAt: candidate.occurredAt,
      }
    : {
        exerciseId: candidate.exerciseId,
        valueKg: candidate.valueKg,
        occurredAt: candidate.occurredAt,
      };
}

function hasOnlyCandidateKeys(value: Readonly<Record<string, unknown>>): boolean {
  const allowed = value.kind === "body-weight"
    ? new Set(["kind", "amount", "unit", "occurredAt"])
    : value.kind === "initial-12rm"
      ? new Set(["kind", "exerciseId", "valueKg", "occurredAt"])
      : new Set<string>();
  return allowed.size > 0 && Object.keys(value).every((key) => allowed.has(key));
}

function parseInitial12RMExerciseId(
  value: unknown,
): Extract<FitnessWriteCandidate, { kind: "initial-12rm" }>["exerciseId"] | undefined {
  return value === "goblet-squat" ||
      value === "dumbbell-bench-press" ||
      value === "dumbbell-deadlift"
    ? value
    : undefined;
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
