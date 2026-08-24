import type {
  FitnessQueryClassification,
  FitnessQueryClassifier,
  FitnessQueryIntent,
} from "./intent.js";

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

const ALLOWED_INTENTS = [
  "current-state",
  "recent-training",
  "today",
  "week",
] as const satisfies readonly FitnessQueryIntent["kind"][];

export function createOpenClawFitnessQueryClassifier(options: {
  readonly complete: LlmComplete;
  readonly agentId: () => string | undefined;
  readonly timeoutMs?: number;
}): FitnessQueryClassifier {
  return {
    async classify(input) {
      const agentId = options.agentId();
      if (agentId === undefined) return { status: "missing-agent-id" };
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(new Error("Fitness query classification timed out")),
        options.timeoutMs ?? 5_000,
      );
      try {
        const result = await options.complete({
          messages: [{
            role: "user",
            content: JSON.stringify({ text: input.text }),
          }],
          systemPrompt: FITNESS_QUERY_INTENT_INSTRUCTIONS,
          agentId,
          maxTokens: 80,
          temperature: 0,
          signal: controller.signal,
          purpose: "stella-fitness-query-intent",
        });
        return parseFitnessQueryClassification(result.text);
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

const FITNESS_QUERY_INTENT_INSTRUCTIONS = [
  "Classify only whether the user is requesting an exact Stella Fitness read query.",
  "Return exactly one JSON object and no prose.",
  `Allowed kinds: ${ALLOWED_INTENTS.join(", ")}.`,
  'Every result must include confidence as "high" or "low".',
  "Do not add dates, IDs, paths, filters, write actions, advice, diagnosis or other parameters.",
  "Use low confidence whenever the user may be making ordinary conversation rather than requesting exact fitness facts.",
].join(" ");

function parseFitnessQueryClassification(
  text: string,
): FitnessQueryClassification {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { status: "invalid-output" };
  }
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["kind", "confidence"]) ||
    typeof value.kind !== "string" ||
    !ALLOWED_INTENTS.includes(value.kind as FitnessQueryIntent["kind"])
  ) {
    return { status: "invalid-output" };
  }
  if (value.confidence === "low") return { status: "low-confidence" };
  if (value.confidence !== "high") return { status: "invalid-output" };
  return {
    status: "classified",
    intent: { kind: value.kind as FitnessQueryIntent["kind"] },
  };
}

function hasOnlyKeys(
  value: Readonly<Record<string, unknown>>,
  allowed: readonly string[],
): boolean {
  const allowedKeys = new Set(allowed);
  return Object.keys(value).every((key) => allowedKeys.has(key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
