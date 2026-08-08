import type {
  DerivedMetric,
  EvidenceCoverage,
  EvidencePacket,
  ObjectiveObservation,
} from "../domain/evidence.js";

export interface EvidenceBuildInput {
  generatedAt: string;
  program: EvidencePacket["program"];
  observations: ObjectiveObservation[];
  metrics: DerivedMetric[];
  coverage: EvidenceCoverage;
  safetyFlags?: string[];
}

/**
 * Security-critical whitelist boundary.
 *
 * The input type deliberately has no rawMessage, conversationHistory,
 * subjectiveClaims, userBelief, or desiredAction fields. Information Flow
 * tests must additionally assert the serialized packet cannot contain them.
 */
export function buildEvidencePacket(
  input: EvidenceBuildInput,
): EvidencePacket {
  return {
    schemaVersion: "stella-fitness/evidence/v0.1",
    generatedAt: input.generatedAt,
    program: input.program,
    observations: input.observations,
    metrics: input.metrics,
    coverage: input.coverage,
    safetyFlags: input.safetyFlags ?? [],
  };
}
