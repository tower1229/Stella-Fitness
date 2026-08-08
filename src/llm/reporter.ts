import type { FinalDecisionPacket } from "../domain/decision.js";

export interface Reporter {
  /**
   * Reporter receives the Policy Gate output only. It must not receive raw
   * conversation history or use user preference to change the decision.
   */
  render(decision: FinalDecisionPacket): Promise<string>;
}
