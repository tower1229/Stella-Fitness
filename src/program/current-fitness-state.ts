import type { WorkoutLogObservation } from "../domain/observation.js";
import type { PlannedSession } from "../domain/program.js";
import type { ProgramJourneyStatus } from "./journey.js";
import { resolvePlannedSession } from "./engine.js";
import {
  readActiveProgramContexts,
  readActiveProgramIfPresent,
} from "./state.js";
import { rebuildCurrentFitnessTrainingRecordView } from "../storage/training-record.js";

type SessionIdentity = {
  readonly date: string;
  readonly weekday: string;
  readonly sessionType: string;
};

type RecordedSession = SessionIdentity & {
  readonly occurredAt: string;
  readonly exercises: readonly {
    readonly exerciseId: string;
    readonly sets: readonly (number | null)[];
  }[];
};

export type CurrentFitnessState =
  | {
      readonly kind: "program-journey";
      readonly asOf: { readonly localDate: string; readonly timeZone: string };
      readonly program: { readonly id: string; readonly version: string };
      readonly pendingConfirmations: number;
      readonly nextStep: { readonly message: string };
    }
  | {
      readonly kind: "conflict";
      readonly asOf: { readonly localDate: string; readonly timeZone: string };
      readonly message: string;
    }
  | {
      readonly kind: "active";
      readonly asOf: { readonly localDate: string; readonly timeZone: string };
      readonly program: {
        readonly id: string;
        readonly version: string;
        readonly cycleStart: string;
      };
      readonly position?: { readonly phase: string; readonly week: number };
      readonly dueSessions: readonly (SessionIdentity & {
        readonly record: "recorded" | "no-record-found";
      })[];
      readonly recordedSessions: readonly RecordedSession[];
      readonly pendingConfirmations: number;
      readonly latestRecord?: RecordedSession;
      readonly nextStep:
        | {
            readonly kind: "review-unrecorded-session";
            readonly date: string;
            readonly message: string;
          }
        | {
            readonly kind: "view-next-session";
            readonly date: string;
            readonly message: string;
          }
        | {
            readonly kind: "program-journey";
            readonly message: string;
          };
    };

export class CurrentFitnessTimeZoneError extends Error {
  constructor() {
    super("Current Fitness State requires a confirmed IANA timezone");
    this.name = "CurrentFitnessTimeZoneError";
  }
}

export async function buildCurrentFitnessState(options: {
  readonly personalDataDirectory: string;
  readonly timeZone: string | undefined;
  readonly receivedAt: string;
  readonly programJourneyStatus: (
    input: {
      readonly date?: string;
      readonly includePendingConfirmations?: true;
    },
  ) => Promise<ProgramJourneyStatus>;
}): Promise<CurrentFitnessState> {
  const timeZone = requireTimeZone(options.timeZone);
  const localDate = localDateInTimeZone(options.receivedAt, timeZone);
  const asOf = { localDate, timeZone };
  const [journey, view] = await Promise.all([
    options.programJourneyStatus({
      date: localDate,
      includePendingConfirmations: true,
    }),
    rebuildCurrentFitnessTrainingRecordView(options.personalDataDirectory),
  ]);
  const pendingConfirmations =
    (journey.pendingConfirmationCount ?? 0) + view.pendingConfirmationCount;
  const activeContexts = await readActiveProgramContexts({
    personalDataDirectory: options.personalDataDirectory,
  });
  if (activeContexts.length > 1) {
    return {
      kind: "conflict",
      asOf,
      message: "检测到多个 Active Program，无法确定唯一的当前训练状态。",
    };
  }
  const active = activeContexts[0];
  if (active === undefined) {
    return {
      kind: "program-journey",
      asOf,
      program: journey.program,
      pendingConfirmations,
      nextStep: { message: journeyNextStep(journey) },
    };
  }

  const planned = plannedSessionsThrough(active, localDate);
  const activeRecords = view.records
    .map(({ observation }) => observation)
    .filter((observation) =>
      observation.programContext?.stateId === active.state.id &&
      observation.programContext.cycleStart === active.state.cycle.startDate &&
      workoutSessionDate(active.state.cycle.startDate, observation) <= localDate
    );
  const recordsBySession = new Map(
    activeRecords.map((observation) => [
      workoutSessionKey(observation.week.value, observation.weekday.value),
      observation,
    ] as const),
  );
  const recordedSessions = activeRecords
    .map((observation) => recordedSession(active.state.cycle.startDate, observation))
    .sort((left, right) => left.date.localeCompare(right.date));
  const dueSessions = planned.due.map((session) => ({
    ...sessionIdentity(session),
    record: recordsBySession.has(
      workoutSessionKey(session.cycle.week, session.day),
    ) ? "recorded" as const : "no-record-found" as const,
  }));
  const firstUnrecorded = dueSessions.find(({ record }) =>
    record === "no-record-found"
  );
  const nextPlanned = planned.future[0];

  return {
    kind: "active",
    asOf,
    program: {
      id: active.program.id,
      version: active.program.version,
      cycleStart: active.state.cycle.startDate,
    },
    ...currentPosition(active.program.weeks, active.state.cycle.startDate, localDate),
    dueSessions,
    recordedSessions,
    pendingConfirmations,
    ...(recordedSessions.at(-1) === undefined
      ? {}
      : { latestRecord: recordedSessions.at(-1)! }),
    nextStep: firstUnrecorded !== undefined
      ? {
          kind: "review-unrecorded-session",
          date: firstUnrecorded.date,
          message: `未找到 ${firstUnrecorded.date} 计划训练的记录；这不表示没有训练。`,
        }
      : nextPlanned !== undefined
        ? {
            kind: "view-next-session",
            date: nextPlanned.date,
            message: `下一次计划训练是 ${nextPlanned.date}。`,
          }
        : {
            kind: "program-journey",
            message: journeyNextStep(journey),
          },
  };
}

function plannedSessionsThrough(
  active: NonNullable<Awaited<ReturnType<typeof readActiveProgramIfPresent>>>,
  localDate: string,
): { readonly due: PlannedSession[]; readonly future: PlannedSession[] } {
  const due: PlannedSession[] = [];
  const future: PlannedSession[] = [];
  for (let offset = 0; offset < active.program.weeks.length * 7; offset += 1) {
    const date = addIsoDays(active.state.cycle.startDate, offset);
    const session = resolvePlannedSession({
      program: active.program,
      programVersion: active.state.program.version,
      cycleStart: active.state.cycle.startDate,
      date,
    });
    if (session === null) continue;
    (date <= localDate ? due : future).push(session);
  }
  return { due, future };
}

function recordedSession(
  cycleStart: string,
  observation: WorkoutLogObservation,
): RecordedSession {
  const date = workoutSessionDate(cycleStart, observation);
  return {
    date,
    weekday: observation.weekday.value,
    sessionType: observation.sessionType.value,
    occurredAt: observation.occurredAt,
    exercises: "exercises" in observation
      ? observation.exercises.map((exercise) => ({
          exerciseId: exercise.exerciseId.value,
          sets: exercise.sets.map(({ value }) => value),
        }))
      : [],
  };
}

function workoutSessionDate(
  cycleStart: string,
  observation: WorkoutLogObservation,
): string {
  return addIsoDays(
    cycleStart,
    (observation.week.value - 1) * 7 + weekdayOffset(observation.weekday.value),
  );
}

function sessionIdentity(session: PlannedSession): SessionIdentity {
  return {
    date: session.date,
    weekday: session.day,
    sessionType: session.type,
  };
}

function currentPosition(
  weeks: readonly { readonly week: number; readonly phase: string }[],
  cycleStart: string,
  localDate: string,
): { readonly position?: { readonly phase: string; readonly week: number } } {
  const offset = isoDayOffset(cycleStart, localDate);
  if (offset < 0) return {};
  const weekNumber = Math.floor(offset / 7) + 1;
  const week = weeks.find(({ week }) => week === weekNumber);
  return week === undefined
    ? {}
    : { position: { phase: week.phase, week: week.week } };
}

function journeyNextStep(status: ProgramJourneyStatus): string {
  if (status.state === "PREREQUISITES_REQUIRED") {
    return "请先确认训练计划所需的准备项目。";
  }
  if (status.state === "BASELINE_WEIGHT_REQUIRED") {
    return "请记录明确的初始体重。";
  }
  if (status.state === "INITIAL_12RM_REQUIRED") {
    return "请记录尚缺的初始 12RM。";
  }
  if (status.state === "READY_TO_ACTIVATE") {
    return "请确认一个周一作为训练周期开始日期。";
  }
  if (status.state === "PHASE_CHECKPOINT_REQUIRED") {
    return `请记录第 ${status.requiredCheckpointWeek} 周体重。`;
  }
  return "查看当前计划训练。";
}

function requireTimeZone(timeZone: string | undefined): string {
  if (timeZone === undefined || timeZone.trim().length === 0) {
    throw new CurrentFitnessTimeZoneError();
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(0);
  } catch {
    throw new CurrentFitnessTimeZoneError();
  }
  return timeZone;
}

export function localDateInTimeZone(
  timestamp: string,
  timeZone: string,
): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    throw new Error("Current Fitness State receivedAt must be a valid timestamp");
  }
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    calendar: "iso8601",
    numberingSystem: "latn",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = (type: "year" | "month" | "day") =>
    parts.find((part) => part.type === type)?.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function workoutSessionKey(week: number, weekday: string): string {
  return `${week}:${weekday}`;
}

function weekdayOffset(weekday: string): number {
  const offset = [
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday",
  ].indexOf(weekday);
  if (offset < 0) throw new Error("Workout record has an invalid weekday");
  return offset;
}

function addIsoDays(start: string, offset: number): string {
  const date = new Date(`${start}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function isoDayOffset(start: string, end: string): number {
  return Math.round(
    (Date.parse(`${end}T00:00:00.000Z`) -
      Date.parse(`${start}T00:00:00.000Z`)) /
      86_400_000,
  );
}
