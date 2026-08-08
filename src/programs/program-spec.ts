import { parse } from "yaml";

export type ProgramSpecStatus = "draft" | "canonical" | "deprecated";
export type ProgramSessionStatus = "resolved" | "unresolved";

export interface ParsedProgramSession {
  day: string;
  type: string;
  status: ProgramSessionStatus;
  reason?: string;
  template?: string;
  exercises?: unknown[] | null;
}

export interface ParsedProgramWeek {
  week: number;
  phase: string;
  sessions: ParsedProgramSession[];
}

export interface ParsedProgramSpec {
  schemaVersion: "stella-fitness/program/v0.1";
  id: string;
  version: string;
  status: ProgramSpecStatus;
  weeks: ParsedProgramWeek[];
  knownGapIds: string[];
}

export class ProgramSpecValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid ProgramSpec:\n- ${issues.join("\n- ")}`);
    this.name = "ProgramSpecValidationError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readNonEmptyString(
  record: Record<string, unknown>,
  key: string,
  path: string,
  issues: string[],
): string | undefined {
  const value = record[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    issues.push(`${path}.${key} must be a non-empty string`);
    return undefined;
  }

  return value;
}

function parseKnownGapIds(root: Record<string, unknown>, issues: string[]): string[] {
  const value = root.known_gaps;
  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value)) {
    issues.push("known_gaps must be an array when present");
    return [];
  }

  const ids: string[] = [];
  value.forEach((item, index) => {
    if (!isRecord(item)) {
      issues.push(`known_gaps[${index}] must be an object`);
      return;
    }

    const id = readNonEmptyString(item, "id", `known_gaps[${index}]`, issues);
    if (id) {
      ids.push(id);
    }
  });

  if (new Set(ids).size !== ids.length) {
    issues.push("known_gaps ids must be unique");
  }

  return ids;
}

function parseSession(
  value: unknown,
  path: string,
  issues: string[],
): ParsedProgramSession | undefined {
  if (!isRecord(value)) {
    issues.push(`${path} must be an object`);
    return undefined;
  }

  const day = readNonEmptyString(value, "day", path, issues);
  const type = readNonEmptyString(value, "type", path, issues);
  const rawStatus = readNonEmptyString(value, "status", path, issues);

  if (!day || !type || !rawStatus) {
    return undefined;
  }

  if (rawStatus !== "resolved" && rawStatus !== "unresolved") {
    issues.push(`${path}.status must be resolved or unresolved`);
    return undefined;
  }

  const template =
    typeof value.template === "string" && value.template.trim().length > 0
      ? value.template
      : undefined;
  const exercises = value.exercises;

  if (rawStatus === "resolved") {
    const hasExercises = Array.isArray(exercises) && exercises.length > 0;
    if (!hasExercises && !template) {
      issues.push(
        `${path} is resolved but has neither a non-empty exercises array nor a template`,
      );
    }
  } else {
    const reason = readNonEmptyString(value, "reason", path, issues);
    if (exercises !== undefined && exercises !== null) {
      issues.push(`${path} is unresolved and must not define exercises`);
    }

    return {
      day,
      type,
      status: rawStatus,
      ...(reason ? { reason } : {}),
    };
  }

  return {
    day,
    type,
    status: rawStatus,
    ...(template ? { template } : {}),
    ...(exercises !== undefined ? { exercises: exercises as unknown[] | null } : {}),
  };
}

function parseWeeks(root: Record<string, unknown>, issues: string[]): ParsedProgramWeek[] {
  const value = root.weeks;
  if (!Array.isArray(value)) {
    issues.push("weeks must be an array");
    return [];
  }

  const weeks: ParsedProgramWeek[] = [];
  value.forEach((item, index) => {
    const path = `weeks[${index}]`;
    if (!isRecord(item)) {
      issues.push(`${path} must be an object`);
      return;
    }

    const week = item.week;
    if (!Number.isInteger(week) || typeof week !== "number" || week < 1 || week > 12) {
      issues.push(`${path}.week must be an integer from 1 to 12`);
      return;
    }

    const phase = readNonEmptyString(item, "phase", path, issues);
    if (!phase) {
      return;
    }

    if (!Array.isArray(item.sessions) || item.sessions.length === 0) {
      issues.push(`${path}.sessions must be a non-empty array`);
      return;
    }

    const sessions = item.sessions
      .map((session, sessionIndex) =>
        parseSession(session, `${path}.sessions[${sessionIndex}]`, issues),
      )
      .filter((session): session is ParsedProgramSession => session !== undefined);

    const daySet = new Set<string>();
    for (const session of sessions) {
      if (daySet.has(session.day)) {
        issues.push(`${path} contains duplicate session day: ${session.day}`);
      }
      daySet.add(session.day);
    }

    weeks.push({ week, phase, sessions });
  });

  const weekNumbers = weeks.map((item) => item.week);
  if (new Set(weekNumbers).size !== weekNumbers.length) {
    issues.push("week numbers must be unique");
  }

  const expectedWeeks = Array.from({ length: 12 }, (_, index) => index + 1);
  const actualWeeks = [...new Set(weekNumbers)].sort((a, b) => a - b);
  if (
    actualWeeks.length !== expectedWeeks.length ||
    actualWeeks.some((week, index) => week !== expectedWeeks[index])
  ) {
    issues.push("weeks must contain each week from 1 through 12 exactly once");
  }

  return weeks;
}

export function validateProgramSpec(value: unknown): ParsedProgramSpec {
  const issues: string[] = [];
  if (!isRecord(value)) {
    throw new ProgramSpecValidationError(["root must be an object"]);
  }

  const schemaVersion = readNonEmptyString(value, "schema_version", "root", issues);
  if (schemaVersion && schemaVersion !== "stella-fitness/program/v0.1") {
    issues.push("root.schema_version must equal stella-fitness/program/v0.1");
  }

  const id = readNonEmptyString(value, "id", "root", issues);
  const version = readNonEmptyString(value, "version", "root", issues);
  const rawStatus = readNonEmptyString(value, "status", "root", issues);

  let status: ProgramSpecStatus | undefined;
  if (rawStatus === "draft" || rawStatus === "canonical" || rawStatus === "deprecated") {
    status = rawStatus;
  } else if (rawStatus) {
    issues.push("root.status must be draft, canonical, or deprecated");
  }

  const knownGapIds = parseKnownGapIds(value, issues);
  const weeks = parseWeeks(value, issues);
  const unresolved = weeks.flatMap((week) =>
    week.sessions
      .filter((session) => session.status === "unresolved")
      .map((session) => ({ week: week.week, day: session.day })),
  );

  if (status === "canonical" && unresolved.length > 0) {
    issues.push("canonical programs cannot contain unresolved sessions");
  }

  if (unresolved.length > 0 && knownGapIds.length === 0) {
    issues.push("programs with unresolved sessions must declare known_gaps");
  }

  if (issues.length > 0 || !schemaVersion || !id || !version || !status) {
    throw new ProgramSpecValidationError(issues);
  }

  return {
    schemaVersion: "stella-fitness/program/v0.1",
    id,
    version,
    status,
    weeks,
    knownGapIds,
  };
}

export function parseProgramSpecYaml(source: string): ParsedProgramSpec {
  let document: unknown;
  try {
    document = parse(source);
  } catch (error) {
    throw new ProgramSpecValidationError([
      `YAML parse failed: ${error instanceof Error ? error.message : String(error)}`,
    ]);
  }

  return validateProgramSpec(document);
}
