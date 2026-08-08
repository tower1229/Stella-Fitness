export type SafetyFlag =
  | "pain"
  | "injury"
  | "illness"
  | "unexpected-health-symptom"
  | "other-out-of-scope-health-risk";

export interface SafetyAssessment {
  flags: SafetyFlag[];
  mustEscalate: boolean;
}

/**
 * Phase 0 intentionally defines only the escalation boundary, not medical
 * triage rules. Concrete detection criteria require a separately reviewed
 * safety policy and test suite.
 */
export function requiresEscalation(flags: SafetyFlag[]): boolean {
  return flags.length > 0;
}
