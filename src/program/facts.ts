import type { PlannedExercise, PlannedSession } from "../domain/program.js";
import { resolvePlannedSession } from "./engine.js";
import { readActiveProgram } from "./state.js";

export type ProgramFactsQuery =
  | { readonly kind: "today"; readonly date: string }
  | { readonly kind: "next"; readonly date: string }
  | { readonly kind: "week"; readonly date: string }
  | { readonly kind: "symbol"; readonly exerciseId: string; readonly symbol: "A" | "N" }
  | { readonly kind: "unsupported"; readonly question: string };

type PlannedSessionFacts = Omit<PlannedSession, "exercises"> & {
  readonly exercises: readonly (PlannedExercise & {
    readonly resolvedLoad?: {
      readonly symbol: string;
      readonly value: number;
      readonly unit: "kg";
      readonly observationId: string;
    };
    readonly unresolvedLoad?: UnresolvedLoad;
  })[];
};

export type ProgramFactsResult =
  | {
      readonly kind: "planned-session-facts";
      readonly relation: "today" | "next";
      readonly session: PlannedSessionFacts;
    }
  | {
      readonly kind: "planned-week-facts";
      readonly startDate: string;
      readonly endDate: string;
      readonly days: readonly {
        readonly date: string;
        readonly day: Weekday;
        readonly session: PlannedSessionFacts | null;
      }[];
    }
  | {
      readonly kind: "symbol-fact";
      readonly exerciseId: string;
      readonly symbol: "A" | "N";
      readonly value: number;
      readonly unit: "kg";
      readonly observationId: string;
    }
  | {
      readonly kind: "symbol-binding-pending";
      readonly exerciseId: string;
      readonly symbol: "A" | "N";
      readonly nextStep: string;
    }
  | { readonly kind: "no-session"; readonly relation: "today" | "next" }
  | { readonly kind: "unsupported"; readonly scope: string };

const RECORDING_ONLY_SCOPE =
  "Stella Fitness only reports source-program, Program State and recorded facts; it does not diagnose, advise or adjust the plan.";

type ResolvedLoad = {
  readonly symbol: string;
  readonly value: number;
  readonly unit: "kg";
  readonly observationId: string;
};

type UnresolvedLoad = {
  readonly symbol: "A" | "N";
  readonly nextStep: string;
};

const MILLISECONDS_PER_DAY = 86_400_000;
const WEEKDAYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;
type Weekday = (typeof WEEKDAYS)[number];

export async function queryProgramFacts(options: {
  readonly personalDataDirectory: string;
  readonly query: ProgramFactsQuery;
}): Promise<ProgramFactsResult> {
  if (options.query.kind === "unsupported") {
    return { kind: "unsupported", scope: RECORDING_ONLY_SCOPE };
  }
  const { program, state } = await readActiveProgram({
    personalDataDirectory: options.personalDataDirectory,
  });
  if (options.query.kind === "symbol") {
    const binding = state.symbolicLoadBindings[options.query.exerciseId]?.[
      options.query.symbol
    ];
    if (binding === undefined) {
      return {
        kind: "symbol-binding-pending",
        exerciseId: options.query.exerciseId,
        ...unresolvedLoad(options.query.exerciseId, options.query.symbol),
      };
    }
    return {
      kind: "symbol-fact",
      exerciseId: options.query.exerciseId,
      symbol: options.query.symbol,
      value: binding.value,
      unit: binding.unit,
      observationId: binding.observationId,
    };
  }
  if (options.query.kind === "week") {
    return weekFacts(program, state, options.query.date);
  }
  const relation = options.query.kind;
  const session = relation === "today"
    ? resolvePlannedSession({
        program,
        programVersion: state.program.version,
        cycleStart: state.cycle.startDate,
        date: options.query.date,
      })
    : nextSession(program, state, options.query.date);
  if (session === null) return { kind: "no-session", relation };
  return {
    kind: "planned-session-facts",
    relation,
    session: sessionFacts(session, state.symbolicLoadBindings),
  };
}

function weekFacts(
  program: Awaited<ReturnType<typeof readActiveProgram>>["program"],
  state: Awaited<ReturnType<typeof readActiveProgram>>["state"],
  anchorDate: string,
): Extract<ProgramFactsResult, { readonly kind: "planned-week-facts" }> {
  const anchor = parseDate(anchorDate);
  const daysSinceMonday = (anchor.getUTCDay() + 6) % 7;
  const monday = new Date(
    anchor.getTime() - daysSinceMonday * MILLISECONDS_PER_DAY,
  );
  const startDate = monday.toISOString().slice(0, 10);
  const endDate = new Date(monday.getTime() + 6 * MILLISECONDS_PER_DAY)
    .toISOString()
    .slice(0, 10);
  const dates = WEEKDAYS.map((day, offset) => ({
    day,
    date: new Date(monday.getTime() + offset * MILLISECONDS_PER_DAY)
      .toISOString()
      .slice(0, 10),
  }));
  return {
    kind: "planned-week-facts",
    startDate,
    endDate,
    days: dates.map(({ date, day }) => {
      const session = resolvePlannedSession({
        program,
        programVersion: state.program.version,
        cycleStart: state.cycle.startDate,
        date,
      });
      return {
        date,
        day,
        session: session === null
          ? null
          : sessionFacts(session, state.symbolicLoadBindings),
      };
    }),
  };
}

function sessionFacts(
  session: PlannedSession,
  bindings: Awaited<ReturnType<typeof readActiveProgram>>["state"]["symbolicLoadBindings"],
): PlannedSessionFacts {
  return {
    ...session,
    exercises: session.exercises.map((exercise) => ({
      ...exercise,
      ...resolvedLoad(exercise, bindings),
    })),
  };
}

function nextSession(
  program: Awaited<ReturnType<typeof readActiveProgram>>["program"],
  state: Awaited<ReturnType<typeof readActiveProgram>>["state"],
  date: string,
): PlannedSession | null {
  const current = parseDate(date);
  for (let offset = 1; offset <= program.weeks.length * 7; offset += 1) {
    const candidate = new Date(current.getTime() + offset * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const session = resolvePlannedSession({
      program,
      programVersion: state.program.version,
      cycleStart: state.cycle.startDate,
      date: candidate,
    });
    if (session !== null) return session;
  }
  return null;
}

function resolvedLoad(
  exercise: PlannedExercise,
  bindings: Awaited<ReturnType<typeof readActiveProgram>>["state"]["symbolicLoadBindings"],
): {
  readonly resolvedLoad?: ResolvedLoad;
  readonly unresolvedLoad?: UnresolvedLoad;
} {
  if (exercise.load?.mode !== "symbolic") return {};
  const symbol = exercise.load.symbol;
  if (symbol !== "A" && symbol !== "N") return {};
  const binding = bindings[exercise.exerciseId]?.[symbol];
  return binding === undefined
    ? { unresolvedLoad: unresolvedLoad(exercise.exerciseId, symbol) }
    : {
        resolvedLoad: {
          symbol,
          value: binding.value,
          unit: binding.unit,
          observationId: binding.observationId,
        },
      };
}

function unresolvedLoad(
  exerciseId: string,
  symbol: "A" | "N",
): UnresolvedLoad {
  return {
    symbol,
    nextStep:
      `Record the source-program strength-test result that binds ${exerciseId} ${symbol}.`,
  };
}

function parseDate(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    throw new Error("Program Facts date must use YYYY-MM-DD");
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error("Program Facts date must be valid");
  }
  return parsed;
}
