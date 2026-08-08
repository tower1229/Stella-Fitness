import type {
  DerivedMetric,
  ObjectiveObservation,
} from "../domain/evidence.js";

export interface MetricsInput {
  observations: ObjectiveObservation[];
  now: string;
}

export interface MetricsEngine {
  derive(input: MetricsInput): DerivedMetric[];
}

/**
 * Statistical windows and intervention thresholds are intentionally not
 * hard-coded in Phase 0. They must be specified, reviewed, and regression
 * tested before they become decision inputs.
 */
export const METRICS_POLICY_STATUS = "UNSPECIFIED" as const;
