export interface BodyWeightObservation {
  measuredAt: string;
  weightKg: number;
  userConfirmed: boolean;
}

export function isPlausibleBodyWeightKg(value: number): boolean {
  // Parsing validation only, not a health judgment. The deliberately broad
  // range is intended to catch obvious extraction/unit errors.
  return Number.isFinite(value) && value > 20 && value < 400;
}
