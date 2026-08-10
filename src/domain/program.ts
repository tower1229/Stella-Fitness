export type ProgramRecord = Readonly<Record<string, unknown>>;

export type ProgramSession = ProgramRecord & {
  readonly day: string;
  readonly type: string;
  readonly status: "resolved";
};

export type ProgramWeek = {
  readonly week: number;
  readonly phase: string;
  readonly sessions: readonly ProgramSession[];
};

export type ProgramSpec = {
  readonly schemaVersion: string;
  readonly id: string;
  readonly version: string;
  readonly status: string;
  readonly phases: readonly ProgramRecord[];
  readonly weeks: readonly ProgramWeek[];
  readonly templates: Readonly<Record<string, ProgramRecord>>;
  readonly loadSymbols: Readonly<Record<string, ProgramRecord>>;
  readonly testingProtocols: Readonly<Record<string, ProgramRecord>>;
  readonly phaseTransitions: Readonly<Record<string, ProgramRecord>>;
  readonly exerciseAliases: Readonly<Record<string, ProgramRecord>>;
  readonly cycleCompletion: ProgramRecord;
};

export type PlannedLoad =
  | {
      readonly mode: "symbolic";
      readonly symbol: string;
      readonly scope: "per_exercise";
    }
  | { readonly mode: "self_selected" }
  | { readonly mode: "none" }
  | { readonly mode: "historical_reference"; readonly week: number };

export type PlannedPrescription =
  | { readonly type: "sets_reps"; readonly sets: number; readonly reps: number }
  | {
      readonly type: "rep_range";
      readonly sets: number;
      readonly minReps: number;
      readonly maxReps: number;
    }
  | { readonly type: "total_reps"; readonly reps: number }
  | {
      readonly type: "duration";
      readonly sets: number;
      readonly seconds: number;
    }
  | { readonly type: "to_failure"; readonly sets: number };

export type PlannedExercise = {
  readonly exerciseId: string;
  readonly displayName?: string;
  readonly load?: PlannedLoad;
  readonly prescription: PlannedPrescription;
  readonly sets?: "self_selected";
  readonly rest?: "self_selected";
  readonly restSeconds?: readonly number[];
  readonly effort?: string;
  readonly progression?: ProgramRecord;
  readonly assistance?: ProgramRecord;
};

export type PlannedTest = {
  readonly exerciseId: string;
  readonly test: string;
  readonly protocolRef: string;
  readonly resultBinding: string;
  readonly bindingScope: "per_exercise";
};

export type PlannedSession = {
  readonly kind: "planned-session";
  readonly program: {
    readonly id: string;
    readonly version: string;
    readonly schemaVersion: string;
  };
  readonly cycle: {
    readonly startDate: string;
    readonly week: number;
    readonly phase: string;
  };
  readonly date: string;
  readonly day: string;
  readonly type: string;
  readonly recovery: boolean;
  readonly exercises: readonly PlannedExercise[];
  readonly tests: readonly PlannedTest[];
};
