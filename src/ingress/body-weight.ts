export interface BodyWeightObservation {
  measuredAt: string;
  weightKg: number;
  userConfirmed: boolean;
}

/**
 * Phase 0 intentionally defines no plausibility thresholds for body weight.
 * Unit/error detection belongs in a reviewed ingestion policy and test set,
 * not in an arbitrary hard-coded health range.
 */
