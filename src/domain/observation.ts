export type ObservationField<T> = {
  readonly value: T;
  readonly confidence: "high" | "low";
};

export type WorkoutLoad =
  | {
      readonly kind: "kg";
      readonly value: number;
      readonly unit: "kg";
      readonly raw: string;
    }
  | { readonly kind: "bodyweight"; readonly raw: string }
  | {
      readonly kind: "assistance";
      readonly mode: "resistance-band";
      readonly raw: string;
    }
  | { readonly kind: "variant"; readonly variant: string; readonly raw: string }
  | { readonly kind: "none"; readonly raw: string };

export type WorkoutExerciseActual = {
  readonly rawLabel: ObservationField<string>;
  readonly exerciseId: ObservationField<string>;
  readonly load: ObservationField<WorkoutLoad | null>;
  readonly sets: readonly (ObservationField<number | null> & {
    readonly semantic: "repetitions" | "duration-seconds";
  })[];
  readonly actionQuality: ObservationField<"高" | "中" | "低" | null>;
  readonly problemNote: ObservationField<string | null>;
};

export type WorkoutLogFacts = {
  readonly layout: ObservationField<"zhuoshu-three-stage-workbook">;
  readonly stage: ObservationField<1 | 2 | 3>;
  readonly week: ObservationField<number>;
  readonly weekday: ObservationField<
    "monday" | "tuesday" | "wednesday" | "thursday" | "friday"
  >;
  readonly sessionType: ObservationField<string>;
  readonly exercises: readonly WorkoutExerciseActual[];
};

export type StrengthTestResult =
  | {
      readonly kind: "kg";
      readonly value: number;
      readonly unit: "kg";
      readonly raw: string;
    }
  | {
      readonly kind: "repetitions";
      readonly value: number;
      readonly raw: string;
    };

export type StrengthTestActual = {
  readonly exerciseId: ObservationField<string>;
  readonly test: "12RM" | "max_reps_first_set";
  readonly result: ObservationField<StrengthTestResult | null>;
};

export type SpecialSessionFacts = {
  readonly layout: ObservationField<"zhuoshu-strength-test-block">;
  readonly stage: ObservationField<1 | 2 | 3>;
  readonly week: ObservationField<number>;
  readonly weekday: ObservationField<
    "monday" | "tuesday" | "wednesday" | "thursday" | "friday"
  >;
  readonly sessionType: ObservationField<
    "strength_test" | "end_of_cycle_retest"
  >;
  readonly testResults: readonly StrengthTestActual[];
};

export type BodyWeightUnit = "kg" | "lb";

export type ObservationSource = {
  readonly kind: "user-text";
  readonly text: string;
  readonly channel?: string;
  readonly messageId?: string;
  readonly runId?: string;
};

export type BodyWeightObservation = {
  readonly schemaVersion: "stella-fitness/observation/body-weight/v0.1";
  readonly id: string;
  readonly kind: "body-weight";
  readonly value: {
    readonly amount: number;
    readonly unit: BodyWeightUnit;
  };
  readonly occurredAt: string;
  readonly source: ObservationSource;
  readonly provenance:
    | {
        readonly kind: "body-weight-recording";
        readonly recordedAt: string;
      }
    | {
        readonly kind: "body-weight-correction";
        readonly recordedAt: string;
        readonly replacesObservationId: string;
      }
    | {
        readonly kind: "body-weight-deletion";
        readonly recordedAt: string;
        readonly replacesObservationId: string;
      };
};

export type BodyWeightView = {
  readonly schemaVersion: "stella-fitness/view/body-weight/v0.1";
  readonly points: readonly {
    readonly observationId: string;
    readonly amount: number;
    readonly unit: BodyWeightUnit;
    readonly occurredAt: string;
  }[];
  readonly errors: readonly {
    readonly file: string;
    readonly message: string;
  }[];
};

export type WorkoutProgramContext = {
  readonly stateId: string;
  readonly programId: string;
  readonly programVersion: string;
  readonly cycleStart: string;
};

export type WorkoutArtifactSource = {
  readonly kind: "workout-log-image";
  readonly artifactId: string;
  readonly path: string;
  readonly sha256: string;
};

type WorkoutObservationEnvelope = {
  readonly id: string;
  readonly occurredAt: string;
  readonly source: WorkoutArtifactSource;
  readonly sourceHistory?: readonly (WorkoutArtifactSource & {
    readonly replacedAt: string;
    readonly runId: string;
  })[];
  readonly programContext?: WorkoutProgramContext;
  readonly provenance:
    | {
        readonly kind: "workout-log-recording";
        readonly runId: string;
        readonly recordedAt: string;
        readonly confirmedFields: readonly string[];
      }
    | {
        readonly kind: "workout-log-correction";
        readonly runId: string;
        readonly recordedAt: string;
        readonly confirmedFields: readonly string[];
        readonly replacesObservationId: string;
      };
  readonly uncertainty: readonly {
    readonly path: string;
    readonly kind:
      | "unknown"
      | "low-confidence"
      | "conflict"
      | "confirmation-required";
    readonly candidates?: readonly string[];
    readonly resolution: "user-confirmed";
  }[];
};

export type OrdinaryWorkoutLogObservation = WorkoutLogFacts &
  WorkoutObservationEnvelope & {
    readonly schemaVersion: "stella-fitness/observation/workout-log/v0.1";
    readonly kind: "workout-log";
  };

export type RecoverySessionObservation = WorkoutLogFacts &
  WorkoutObservationEnvelope & {
    readonly schemaVersion: "stella-fitness/observation/workout-recovery-session/v0.1";
    readonly kind: "workout-recovery-session";
    readonly plannedSession: import("./program.js").PlannedSession & {
      readonly recovery: true;
    };
  };

export type SpecialSessionObservation = SpecialSessionFacts &
  WorkoutObservationEnvelope & {
    readonly schemaVersion: "stella-fitness/observation/workout-special-session/v0.1";
    readonly kind: "workout-special-session";
    readonly plannedSession: import("./program.js").ResolvedWorkoutSession;
  };

export type WorkoutLogObservation =
  | OrdinaryWorkoutLogObservation
  | RecoverySessionObservation
  | SpecialSessionObservation;

export type TrainingRecordView = {
  readonly schemaVersion: "stella-fitness/view/training-record/v0.1";
  readonly records: readonly {
    readonly observation: WorkoutLogObservation;
    readonly sourceStatus: "available" | "source_missing";
  }[];
  readonly errors: readonly {
    readonly file: string;
    readonly message: string;
  }[];
};
