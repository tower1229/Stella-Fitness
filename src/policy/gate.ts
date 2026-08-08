import type {
  AuditResult,
  BlindDiagnosis,
  FinalDecisionPacket,
} from "../domain/decision.js";
import type { EvidencePacket } from "../domain/evidence.js";

export interface PolicyGateInput {
  evidence: EvidencePacket;
  diagnosis: BlindDiagnosis;
  audit: AuditResult;
}

export interface PolicyGate {
  /**
   * The only component allowed to turn model analysis into an actionable
   * FinalDecisionPacket. Thresholds are intentionally unspecified in Phase 0.
   */
  decide(input: PolicyGateInput): FinalDecisionPacket;
}

export function collectEvidenceIds(evidence: EvidencePacket): Set<string> {
  return new Set([
    ...evidence.observations.map((item) => item.id),
    ...evidence.metrics.map((item) => item.id),
  ]);
}
