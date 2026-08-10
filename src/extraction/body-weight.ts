import type { BodyWeightUnit } from "../domain/observation.js";

export type BodyWeightCandidate = {
  readonly amount: number;
  readonly unit: BodyWeightUnit;
  readonly occurredAt: string;
};

export type BodyWeightClarification = {
  readonly status: "clarification";
  readonly field: "value" | "unit" | "occurrence-time";
  readonly question: string;
};

export function parseBodyWeightInput(options: {
  text: string;
  receivedAt: string;
}): BodyWeightCandidate | BodyWeightClarification {
  const receivedAt = parseTimestamp(options.receivedAt, "receivedAt");
  if (/(?:昨天|前天|yesterday|the day before yesterday)/iu.test(options.text)) {
    return {
      status: "clarification",
      field: "occurrence-time",
      question: "请确认这次测量的发生时间。",
    };
  }
  const timestampMatches = [
    ...options.text.matchAll(
      /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})\b/giu,
    ),
  ];
  if (timestampMatches.length > 1) {
    return occurrenceTimeClarification();
  }
  const explicitTimestamp = timestampMatches[0]?.[0];
  if (explicitTimestamp === undefined && /\b\d{4}-\d{2}-\d{2}\b/u.test(options.text)) {
    return occurrenceTimeClarification();
  }
  const units = recognizedUnits(options.text);
  if (units.length !== 1) {
    return {
      status: "clarification",
      field: "unit",
      question: "请确认体重单位：kg 还是 lb？",
    };
  }

  const amountMatches = [
    ...options.text.matchAll(
      /([+-]?\d+(?:\.\d+)?)\s*(?:(?:kg|kgs?|lb|lbs?)\b|公斤|千克|磅)/giu,
    ),
  ];
  if (amountMatches.length !== 1 || amountMatches[0]?.[1] === undefined) {
    return {
      status: "clarification",
      field: "value",
      question: "请确认一个体重数值。",
    };
  }
  const amount = Number(amountMatches[0][1]);
  if (!Number.isFinite(amount) || amount <= 0) {
    return {
      status: "clarification",
      field: "value",
      question: "请确认一个大于 0 的体重数值。",
    };
  }

  return {
    amount,
    unit: units[0]!,
    occurredAt:
      explicitTimestamp === undefined
        ? receivedAt
        : parseTimestamp(explicitTimestamp, "occurrence time"),
  };
}

function occurrenceTimeClarification(): BodyWeightClarification {
  return {
    status: "clarification",
    field: "occurrence-time",
    question: "请确认这次测量的发生时间。",
  };
}

function recognizedUnits(text: string): BodyWeightUnit[] {
  const units = new Set<BodyWeightUnit>();
  if (/(?:kg|kgs?)\b|公斤|千克/iu.test(text)) {
    units.add("kg");
  }
  if (/(?:lb|lbs?)\b|磅/iu.test(text)) {
    units.add("lb");
  }
  return [...units];
}

function parseTimestamp(value: string, label: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`${label} must be an ISO timestamp`);
  }
  return parsed.toISOString();
}
