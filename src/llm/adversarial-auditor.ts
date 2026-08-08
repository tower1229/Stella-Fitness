import type {
  AuditResult,
  BlindDiagnosis,
  UserBelief,
} from "../domain/decision.js";
import type { EvidencePacket } from "../domain/evidence.js";

export interface AuditInput {
  evidence: EvidencePacket;
  frozenDiagnosis: BlindDiagnosis;
  userBelief: UserBelief;
}

export interface AdversarialAuditor {
  /**
   * The diagnosis is frozen before this call. The auditor searches for
   * unsupported inference, contrary evidence, missing evidence, and framing
   * risk; it is not a second conversational answer generator.
   */
  audit(input: AuditInput): Promise<AuditResult>;
}
