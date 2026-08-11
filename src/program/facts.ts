import type { PlannedExercise, PlannedSession } from "../domain/program.js";
import { resolvePlannedSession } from "./engine.js";
import { readActiveProgram } from "./state.js";

export type ProgramFactsQuery =
  | { readonly kind: "today"; readonly date: string }
  | { readonly kind: "next"; readonly date: string }
  | { readonly kind: "symbol"; readonly exerciseId: string; readonly symbol: "A" | "N" }
  | { readonly kind: "unsupported"; readonly question: string };

export type ProgramFactsResult =
  | {
      readonly kind: "planned-session-facts";
      readonly relation: "today" | "next";
      readonly session: Omit<PlannedSession, "exercises"> & {
        readonly exercises: readonly (PlannedExercise & {
          readonly resolvedLoad?: {
            readonly symbol: string;
            readonly value: number;
            readonly unit: "kg";
            readonly observationId: string;
          };
        })[];
      };
    }
  | {
      readonly kind: "symbol-fact";
      readonly exerciseId: string;
      readonly symbol: "A" | "N";
      readonly value: number;
      readonly unit: "kg";
      readonly observationId: string;
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
      throw new Error(
        `Program Facts cannot resolve ${options.query.exerciseId} ${options.query.symbol}`,
      );
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
    session: {
      ...session,
      exercises: session.exercises.map((exercise) => ({
        ...exercise,
        ...resolvedLoad(exercise, state.symbolicLoadBindings),
      })),
    },
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
): { readonly resolvedLoad?: ResolvedLoad } {
  if (exercise.load?.mode !== "symbolic") return {};
  const symbol = exercise.load.symbol;
  if (symbol !== "A" && symbol !== "N") return {};
  const binding = bindings[exercise.exerciseId]?.[symbol];
  return binding === undefined
    ? {}
    : {
        resolvedLoad: {
          symbol,
          value: binding.value,
          unit: binding.unit,
          observationId: binding.observationId,
        },
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
