import {
  parseFitnessWriteCandidate,
  type FitnessWriteCandidate,
} from "./candidate.js";

export type { FitnessWriteCandidate } from "./candidate.js";

export type FitnessWriteCandidateClassification =
  | {
      readonly status: "candidate";
      readonly candidate: FitnessWriteCandidate;
      readonly confidence: "high" | "low";
    }
  | {
      readonly status:
        | "not-applicable"
        | "low-confidence"
        | "invalid-output"
        | "missing-agent-id"
        | "provider-error"
        | "timeout";
    };

export type FitnessWriteCandidateClassifier = {
  classify(input: {
    readonly text: string;
    readonly receivedAt: string;
  }): Promise<FitnessWriteCandidateClassification>;
};

type LlmComplete = (input: {
  readonly messages: {
    readonly role: "user";
    readonly content: string;
  }[];
  readonly systemPrompt: string;
  readonly agentId: string;
  readonly maxTokens: number;
  readonly temperature: number;
  readonly signal: AbortSignal;
  readonly purpose: string;
}) => Promise<{ readonly text: string }>;

const INSTRUCTIONS = [
  "Classify only an explicit user request to record a Stella Fitness fact.",
  "Return exactly one JSON object and no prose.",
  'Ordinary conversation, emotions, approximate observations without a recording request, advice, or questions must return {"kind":"not-applicable","confidence":"high"}.',
  'Allowed candidates are {"kind":"body-weight","amount":number,"unit":"kg"|"lb","occurredAt":ISO timestamp,"confidence":"high"} and {"kind":"initial-12rm","exerciseId":"goblet-squat"|"dumbbell-bench-press"|"dumbbell-deadlift","valueKg":number,"occurredAt":ISO timestamp,"confidence":"high"}.',
  "A candidate has no write authority and will always be shown to the user for confirmation.",
  "Never infer an unsupported exercise, unit, non-positive value, or invalid timestamp. Use low confidence when intent or fields are uncertain.",
].join(" ");

export function createOpenClawFitnessWriteCandidateClassifier(options: {
  readonly complete: LlmComplete;
  readonly agentId: () => string | undefined;
  readonly timeoutMs?: number;
}): FitnessWriteCandidateClassifier {
  return {
    async classify(input) {
      const agentId = options.agentId();
      if (agentId === undefined) return { status: "missing-agent-id" };
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(new Error("Fitness write candidate timed out")),
        options.timeoutMs ?? 5_000,
      );
      try {
        const result = await options.complete({
          messages: [{ role: "user", content: JSON.stringify(input) }],
          systemPrompt: INSTRUCTIONS,
          agentId,
          maxTokens: 180,
          temperature: 0,
          signal: controller.signal,
          purpose: "stella-fitness-write-candidate",
        });
        return parseClassification(result.text);
      } catch {
        return controller.signal.aborted
          ? { status: "timeout" }
          : { status: "provider-error" };
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

function parseClassification(text: string): FitnessWriteCandidateClassification {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { status: "invalid-output" };
  }
  if (!isRecord(value) || typeof value.kind !== "string") {
    return { status: "invalid-output" };
  }
  if (value.kind === "not-applicable") {
    if (!hasOnlyKeys(value, ["kind", "confidence"])) {
      return { status: "invalid-output" };
    }
    return value.confidence === "high"
      ? { status: "not-applicable" }
      : value.confidence === "low"
        ? { status: "low-confidence" }
        : { status: "invalid-output" };
  }
  const { confidence: _confidence, ...candidateValue } = value;
  const candidate = parseFitnessWriteCandidate(candidateValue);
  if (candidate === undefined) return { status: "invalid-output" };
  return value.confidence === "high" || value.confidence === "low"
    ? { status: "candidate", candidate, confidence: value.confidence }
    : { status: "invalid-output" };
}

function hasOnlyKeys(
  value: Readonly<Record<string, unknown>>,
  allowed: readonly string[],
): boolean {
  const keys = new Set(allowed);
  return Object.keys(value).every((key) => keys.has(key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
