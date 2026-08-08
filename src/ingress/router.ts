export type IngressKind =
  | "training-log"
  | "body-weight"
  | "diet"
  | "supervision-query"
  | "unclaimed";

export interface IngressEnvelope {
  agentId?: string;
  text?: string;
  mediaCount: number;
}

export interface IngressRoute {
  kind: IngressKind;
  confidence: "low" | "medium" | "high";
  reason: string;
}

export interface IngressRouter {
  /**
   * The router must be conservative. A low-confidence domain guess should be
   * returned as unclaimed so Phase 0/1 cannot accidentally hijack unrelated
   * OpenClaw conversations.
   */
  route(input: IngressEnvelope): Promise<IngressRoute>;
}
