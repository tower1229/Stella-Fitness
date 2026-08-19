import type {
  ConfirmationClassification,
  ConfirmationIntent,
  ConfirmationIntentClassifier,
} from "./coordinator.js";

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

export function createOpenClawConfirmationIntentClassifier(options: {
  readonly complete: LlmComplete;
  readonly agentId: () => string | undefined;
  readonly timeoutMs?: number;
}): ConfirmationIntentClassifier {
  return {
    async classify(input) {
      const agentId = options.agentId();
      if (agentId === undefined) return { status: "missing-agent-id" };
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(new Error("Confirmation intent classification timed out")),
        options.timeoutMs ?? 5_000,
      );
      try {
        const result = await options.complete({
          messages: [{
            role: "user",
            content: JSON.stringify({
              text: input.text,
              ...(input.target === undefined ? {} : { target: input.target }),
              fields: input.fields,
            }),
          }],
          systemPrompt: CONFIRMATION_INTENT_INSTRUCTIONS,
          agentId,
          maxTokens: 300,
          temperature: 0,
          signal: controller.signal,
          purpose: "stella-fitness-workout-log-confirmation-intent",
        });
        return parseConfirmationIntent(
          result.text,
          new Set(input.fields.map(({ fieldId }) => fieldId)),
        );
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

const CONFIRMATION_INTENT_INSTRUCTIONS = [
  "Classify only the user's intent for the pending workout-log confirmation.",
  "Return exactly one JSON object and no prose.",
  "Allowed kinds: accept-all, accept-with-overrides, provide-values, cancel, unrelated, ambiguous.",
  "For accept-with-overrides or provide-values, updates must contain only supplied fieldId values from the input fields.",
  "Use null only when the user explicitly says the source field was blank or unfilled.",
  "Never infer a missing value. Never invent a fieldId. Negation or uncertainty must be ambiguous.",
  'Every result must include confidence as "high" or "low".',
].join(" ");

function parseConfirmationIntent(
  text: string,
  allowedFieldIds: ReadonlySet<string>,
): ConfirmationClassification {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { status: "invalid-output" };
  }
  const record = asRecord(value);
  if (
    record === undefined ||
    typeof record.kind !== "string" ||
    !hasOnlyKeys(record, ["kind", "confidence", "updates"])
  ) {
    return { status: "invalid-output" };
  }
  let intent: ConfirmationIntent;
  if (["accept-all", "cancel", "unrelated", "ambiguous"].includes(record.kind)) {
    if (record.updates !== undefined) return { status: "invalid-output" };
    intent = {
      kind: record.kind as "accept-all" | "cancel" | "unrelated" | "ambiguous",
    };
  } else if (
    record.kind !== "accept-with-overrides" &&
    record.kind !== "provide-values"
  ) {
    return { status: "invalid-output" };
  } else {
    if (!Array.isArray(record.updates) || record.updates.length === 0) {
      return { status: "invalid-output" };
    }
    const updates: Array<{ fieldId: string; value: string | number | null }> = [];
    for (const updateValue of record.updates) {
      const update = asRecord(updateValue);
      if (
        update === undefined ||
        !hasOnlyKeys(update, ["fieldId", "value"]) ||
        typeof update.fieldId !== "string" ||
        !allowedFieldIds.has(update.fieldId) ||
        !(
          update.value === null ||
          typeof update.value === "string" ||
          (typeof update.value === "number" && Number.isFinite(update.value))
        )
      ) {
        return { status: "invalid-output" };
      }
      updates.push({ fieldId: update.fieldId, value: update.value });
    }
    intent = { kind: record.kind, updates };
  }
  if (record.confidence === "low") {
    return { status: "low-confidence" };
  }
  if (record.confidence !== "high") {
    return { status: "invalid-output" };
  }
  return {
    status: "classified",
    intent,
  };
}

function hasOnlyKeys(
  value: Readonly<Record<string, unknown>>,
  allowed: readonly string[],
): boolean {
  const allowedKeys = new Set(allowed);
  return Object.keys(value).every((key) => allowedKeys.has(key));
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}
