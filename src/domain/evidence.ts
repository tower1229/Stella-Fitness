export type EvidenceConfidence = "low" | "medium" | "high";

export interface EvidenceReference {
  id: string;
  kind: "observation" | "metric" | "program";
}

export interface ObjectiveObservation {
  id: string;
  kind: "training" | "body_weight" | "diet" | "recovery";
  observedAt: string;
  summary: string;
  confidence: EvidenceConfidence;
  sourceArtifactId?: string;
  userConfirmed: boolean;
}

export interface DerivedMetric {
  id: string;
  name: string;
  value: number | string | boolean | null;
  window?: string;
  evidenceIds: string[];
}

export interface EvidenceCoverage {
  training: EvidenceConfidence;
  bodyWeight: EvidenceConfidence;
  diet: EvidenceConfidence;
  recovery: EvidenceConfidence;
}

/**
 * Security boundary for Blind Diagnosis.
 *
 * Deliberately absent:
 * - raw user message
 * - conversation history
 * - subjective claims / user belief
 * - desired action
 * - previous reporter output
 */
export interface EvidencePacket {
  schemaVersion: "stella-fitness/evidence/v0.1";
  generatedAt: string;
  program: {
    id: string;
    version: string;
    cycleWeek: number;
    plannedSessionStatus?: "resolved" | "unresolved";
  };
  observations: ObjectiveObservation[];
  metrics: DerivedMetric[];
  coverage: EvidenceCoverage;
  safetyFlags: string[];
}
