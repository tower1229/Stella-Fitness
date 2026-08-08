import type { BlindDiagnosis } from "../domain/decision.js";
import type { EvidencePacket } from "../domain/evidence.js";

export interface BlindDiagnostician {
  /**
   * Implementations must use an isolated model context and may receive only
   * the EvidencePacket defined here.
   */
  diagnose(evidence: EvidencePacket): Promise<BlindDiagnosis>;
}
