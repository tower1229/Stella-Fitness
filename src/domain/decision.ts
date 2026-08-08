import type { EvidenceConfidence, EvidenceReference } from "./evidence.js";

export interface DiagnosisHypothesis {
  id: string;
  cause: string;
  supportingEvidence: EvidenceReference[];
  contradictingEvidence: EvidenceReference[];
  missingEvidence: string[];
  confidence: EvidenceConfidence;
}

export interface BlindDiagnosis {
  schemaVersion: "stella-fitness/diagnosis/v0.1";
  hypotheses: DiagnosisHypothesis[];
  proposedAction:
    | "NO_CHANGE"
    | "OBSERVE"
    | "COLLECT_MORE_DATA"
    | "ADJUST_DIET"
    | "ADJUST_TRAINING"
    | "RECOVERY"
    | "ESCALATE";
  confidence: EvidenceConfidence;
}

export interface UserBelief {
  claims: string[];
  desiredActions: string[];
}

export interface AuditResult {
  schemaVersion: "stella-fitness/audit/v0.1";
  diagnosisSupported: boolean;
  unsupportedClaims: string[];
  missingEvidence: string[];
  framingRisk: EvidenceConfidence;
  notes: string[];
}

export type DecisionType = BlindDiagnosis["proposedAction"];

export interface FinalDecisionPacket {
  schemaVersion: "stella-fitness/decision/v0.1";
  decision: DecisionType;
  confidence: EvidenceConfidence;
  evidence: EvidenceReference[];
  rationale: string[];
  requestedData: string[];
  safetyNotes: string[];
}
