import type { IngressRouter } from "../ingress/router.js";
import type { MetricsEngine } from "../engines/metrics-engine.js";
import type { BlindDiagnostician } from "../llm/blind-diagnostician.js";
import type { BeliefExtractor } from "../llm/belief-extractor.js";
import type { AdversarialAuditor } from "../llm/adversarial-auditor.js";
import type { Reporter } from "../llm/reporter.js";
import type { PolicyGate } from "../policy/gate.js";

/** Composition root contract for the future runtime implementation. */
export interface StellaFitnessRuntime {
  ingressRouter: IngressRouter;
  metricsEngine: MetricsEngine;
  blindDiagnostician: BlindDiagnostician;
  beliefExtractor: BeliefExtractor;
  auditor: AdversarialAuditor;
  policyGate: PolicyGate;
  reporter: Reporter;
}
