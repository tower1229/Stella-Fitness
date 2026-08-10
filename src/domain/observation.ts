export type BodyWeightUnit = "kg" | "lb";

export type ObservationSource = {
  readonly kind: "user-text";
  readonly text: string;
  readonly channel?: string;
  readonly messageId?: string;
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
