import type { UserBelief } from "../domain/decision.js";

export interface BeliefExtractionInput {
  userText: string;
}

export interface BeliefExtractor {
  /** Extract what the user believes or wants; do not diagnose. */
  extract(input: BeliefExtractionInput): Promise<UserBelief>;
}
