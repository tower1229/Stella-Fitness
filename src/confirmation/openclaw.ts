import type {
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
      if (agentId === undefined) return { kind: "ambiguous" };
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
        return { kind: "ambiguous" };
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
): ConfirmationIntent {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { kind: "ambiguous" };
  }
  const record = asRecord(value);
  if (
    record === undefined ||
    record.confidence !== "high" ||
    typeof record.kind !== "string" ||
    !hasOnlyKeys(record, ["kind", "confidence", "updates"])
  ) {
    return { kind: "ambiguous" };
  }
  if (["accept-all", "cancel", "unrelated", "ambiguous"].includes(record.kind)) {
    if (record.updates !== undefined) return { kind: "ambiguous" };
    return { kind: record.kind as "accept-all" | "cancel" | "unrelated" | "ambiguous" };
  }
  if (
    record.kind !== "accept-with-overrides" &&
    record.kind !== "provide-values"
  ) {
    return { kind: "ambiguous" };
  }
  if (!Array.isArray(record.updates) || record.updates.length === 0) {
    return { kind: "ambiguous" };
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
      return { kind: "ambiguous" };
    }
    updates.push({ fieldId: update.fieldId, value: update.value });
  }
  return { kind: record.kind, updates };
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
