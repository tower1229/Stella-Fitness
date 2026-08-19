import { createHash } from "node:crypto";

import {
  parseWorkoutLogFieldPath,
  type WorkoutLogCandidate,
} from "../extraction/candidate.js";
import type { WorkoutLogTarget } from "../extraction/runtime.js";
import type {
  ConfirmedWorkoutLogOutput,
  PendingWorkoutLogConfirmationOutput,
} from "../plugin-runtime.js";

export type ConfirmationSessionState = {
  readonly schemaVersion: "stella-fitness/workout-log-confirmation-session/v0.1";
  readonly confirmationId: string;
  readonly issuedAt: string;
  readonly messageId?: string;
  readonly values: Readonly<Record<string, unknown>>;
  readonly ambiguous?: true;
};

export type ConfirmationSessionStore = {
  register(key: string, value: ConfirmationSessionState): Promise<void>;
  lookup(key: string): Promise<ConfirmationSessionState | undefined>;
  delete(key: string): Promise<boolean>;
};

export type ConfirmationFieldOption = {
  readonly fieldId: string;
  readonly label: string;
  readonly suggestedValue: unknown;
};

export type ConfirmationIntent =
  | { readonly kind: "accept-all" }
  | {
      readonly kind: "accept-with-overrides" | "provide-values";
      readonly updates: readonly {
        readonly fieldId: string;
        readonly value: string | number | null;
      }[];
    }
  | { readonly kind: "cancel" | "unrelated" | "ambiguous" };

export type ConfirmationIntentClassifier = {
  classify(input: {
    readonly text: string;
    readonly fields: readonly ConfirmationFieldOption[];
    readonly target?: Pick<WorkoutLogTarget, "stage" | "week" | "weekday" | "sessionType">;
  }): Promise<ConfirmationIntent>;
};

export type WorkoutLogConfirmationTurnResult =
  | { readonly status: "not-applicable" }
  | { readonly status: "ambiguous" }
  | { readonly status: "cancelled" }
  | {
      readonly status: "confirmation";
      readonly candidate: WorkoutLogCandidate;
      readonly target?: WorkoutLogTarget;
      readonly fields: WorkoutLogCandidate["uncertainFields"];
      readonly acceptedCount: number;
    }
  | ConfirmedWorkoutLogOutput;

export type WorkoutLogConfirmationCoordinator = {
  bind(input: {
    readonly sessionKey: string;
    readonly confirmationId: string;
    readonly issuedAt: string;
    readonly messageId?: string;
  }): Promise<void>;
  complete(input: {
    readonly sessionKey: string;
    readonly confirmationId: string;
  }): Promise<void>;
  submit(input: {
    readonly sessionKey: string;
    readonly text: string;
  }): Promise<WorkoutLogConfirmationTurnResult>;
};

export function createWorkoutLogConfirmationCoordinator(options: {
  readonly store: ConfirmationSessionStore;
  pending(
    confirmationId: string,
  ): Promise<PendingWorkoutLogConfirmationOutput | undefined>;
  confirm(input: {
    readonly confirmationId: string;
    readonly values: Readonly<Record<string, unknown>>;
  }): Promise<ConfirmedWorkoutLogOutput>;
  cancel(confirmationId: string): Promise<boolean>;
  readonly classifier: ConfirmationIntentClassifier;
}): WorkoutLogConfirmationCoordinator {
  const sessionOperations = new Map<string, Promise<unknown>>();
  return {
    async bind(input) {
      const key = sessionStateKey(input.sessionKey);
      await serializeSession(sessionOperations, key, async () => {
        const existing = await options.store.lookup(key);
        if (existing !== undefined && existing.issuedAt > input.issuedAt) return;
        if (
          existing !== undefined &&
          existing.issuedAt === input.issuedAt &&
          existing.confirmationId !== input.confirmationId
        ) {
          await options.store.register(key, { ...existing, ambiguous: true });
          return;
        }
        await options.store.register(key, {
          schemaVersion: "stella-fitness/workout-log-confirmation-session/v0.1",
          confirmationId: input.confirmationId,
          issuedAt: input.issuedAt,
          ...(input.messageId === undefined ? {} : { messageId: input.messageId }),
          values: {},
        });
      });
    },
    async complete(input) {
      const key = sessionStateKey(input.sessionKey);
      await serializeSession(sessionOperations, key, async () => {
        const existing = await options.store.lookup(key);
        if (existing?.confirmationId === input.confirmationId) {
          await options.store.delete(key);
        }
      });
    },
    async submit(input) {
      const key = sessionStateKey(input.sessionKey);
      return await serializeSession(sessionOperations, key, async () => {
        const state = await options.store.lookup(key);
        if (state === undefined) return { status: "not-applicable" };
        if (state.ambiguous) return { status: "ambiguous" };
        const pending = await options.pending(state.confirmationId);
        if (pending === undefined) {
          await deleteSessionBestEffort(options.store, key);
          return { status: "not-applicable" };
        }
        const values: Record<string, unknown> = { ...state.values };
        const localIntent = localConfirmationIntent(pending, values, input.text);
        const intent = localIntent ?? await options.classifier.classify({
          text: input.text,
          fields: confirmationFieldOptions(pending),
          ...(pending.target === undefined
            ? {}
            : {
                target: {
                  stage: pending.target.stage,
                  week: pending.target.week,
                  weekday: pending.target.weekday,
                  sessionType: pending.target.sessionType,
                },
              }
          ),
        });
        if (intent.kind === "unrelated") return { status: "not-applicable" };
        if (intent.kind === "ambiguous") return { status: "ambiguous" };
        if (intent.kind === "cancel") {
          await options.cancel(state.confirmationId);
          await deleteSessionBestEffort(options.store, key);
          return { status: "cancelled" };
        }
        if (intent.kind === "accept-all" || intent.kind === "accept-with-overrides") {
          for (const field of pending.fields) {
            const value = workoutLogCandidateFieldValue(pending.candidate, field.path);
            if (value !== null && value !== undefined) values[field.path] = value;
          }
        }
        if (intent.kind === "accept-with-overrides" || intent.kind === "provide-values") {
          const fields = confirmationFieldOptions(pending);
          const seen = new Set<string>();
          for (const update of intent.updates) {
            const fieldIndex = fields.findIndex(
              ({ fieldId }) => fieldId === update.fieldId,
            );
            if (fieldIndex < 0 || seen.has(update.fieldId)) {
              return { status: "ambiguous" };
            }
            if (
              update.value === null &&
              !/(?:未填写|没填|没有填写|空白)/u.test(input.text)
            ) {
              return { status: "ambiguous" };
            }
            seen.add(update.fieldId);
            const field = pending.fields[fieldIndex]!;
            const normalized = normalizeFieldUpdate(
              pending.candidate,
              field.path,
              update.value,
            );
            if (!normalized.matched) return { status: "ambiguous" };
            values[field.path] = normalized.value;
          }
        }
        const remaining = pending.fields.filter((field) =>
          !Object.hasOwn(values, field.path)
        );
        if (remaining.length > 0) {
          await options.store.register(key, { ...state, values });
          return {
            status: "confirmation",
            candidate: pending.candidate,
            ...(pending.target === undefined ? {} : { target: pending.target }),
            fields: remaining,
            acceptedCount: Object.keys(values).length,
          };
        }
        const result = await options.confirm({
          confirmationId: state.confirmationId,
          values,
        });
        await deleteSessionBestEffort(options.store, key);
        return result;
      });
    },
  };
}

async function deleteSessionBestEffort(
  store: ConfirmationSessionStore,
  key: string,
): Promise<void> {
  await store.delete(key).catch(() => false);
}

async function serializeSession<T>(
  operations: Map<string, Promise<unknown>>,
  key: string,
  task: () => Promise<T>,
): Promise<T> {
  const previous = operations.get(key) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(task);
  operations.set(key, current);
  try {
    return await current;
  } finally {
    if (operations.get(key) === current) operations.delete(key);
  }
}

function localConfirmationIntent(
  pending: PendingWorkoutLogConfirmationOutput,
  values: Readonly<Record<string, unknown>>,
  text: string,
): ConfirmationIntent | undefined {
  if (/^\s*(?:全部确认|确认全部)\s*[。.!]?\s*$/u.test(text)) {
    return { kind: "accept-all" };
  }
  const remaining = pending.fields.filter((field) =>
    !Object.hasOwn(values, field.path)
  );
  if (remaining.length !== 1) return undefined;
  const update = parseSingleFieldValue(pending.candidate, remaining[0]!.path, text);
  if (!update.matched) return undefined;
  return {
    kind: "provide-values",
    updates: [{
      fieldId: `f${pending.fields.indexOf(remaining[0]!) + 1}`,
      value: update.value,
    }],
  };
}

function confirmationFieldOptions(
  pending: PendingWorkoutLogConfirmationOutput,
): readonly ConfirmationFieldOption[] {
  return pending.fields.map((field, index) => ({
    fieldId: `f${index + 1}`,
    label: confirmationFieldLabel(pending.candidate, field.path),
    suggestedValue: workoutLogCandidateFieldValue(pending.candidate, field.path),
  }));
}

function parseSingleFieldValue(
  candidate: WorkoutLogCandidate,
  path: string,
  text: string,
): { readonly matched: true; readonly value: string | number | null } | { readonly matched: false } {
  if (/(?:未填写|没填|没有填写|空白)/u.test(text)) {
    return { matched: true, value: null };
  }
  const location = parseWorkoutLogFieldPath(path);
  if (location?.kind === "exercise" && location.key === "actionQuality") {
    const value = /(?:^|是|为|填|记为|改为|[:：])\s*(高|中|低)\s*[。.!]?\s*$/u.exec(text)?.[1];
    return value === undefined ? { matched: false } : { matched: true, value };
  }
  if (location?.kind === "set" || location?.kind === "test-result") {
    const value = Number(/([+-]?\d+(?:\.\d+)?)\s*(?:秒|次|kg|公斤)?\s*[。.!]?\s*$/iu.exec(text)?.[1]);
    return Number.isFinite(value) ? { matched: true, value } : { matched: false };
  }
  if (location?.kind === "exercise" && location.key === "load") {
    const amount = Number(/([+]?(?:\d+(?:\.\d+)?))\s*(?:kg|公斤)\s*[。.!]?\s*$/iu.exec(text)?.[1]);
    return Number.isFinite(amount)
      ? { matched: true, value: `${amount}kg` }
      : { matched: false };
  }
  return workoutLogCandidateFieldValue(candidate, path) === text.trim()
    ? { matched: true, value: text.trim() }
    : { matched: false };
}

function normalizeFieldUpdate(
  candidate: WorkoutLogCandidate,
  path: string,
  value: string | number | null,
): { readonly matched: true; readonly value: unknown } | { readonly matched: false } {
  if (value === null) return { matched: true, value: null };
  const location = parseWorkoutLogFieldPath(path);
  if (location?.kind === "exercise" && location.key === "actionQuality") {
    return value === "高" || value === "中" || value === "低"
      ? { matched: true, value }
      : { matched: false };
  }
  if (location?.kind === "set") {
    const number = typeof value === "number" ? value : Number(value);
    return Number.isFinite(number) && number >= 0
      ? { matched: true, value: number }
      : { matched: false };
  }
  if (location?.kind === "exercise" && location.key === "load") {
    const raw = String(value).trim();
    const amount = Number(/^(\d+(?:\.\d+)?)\s*(?:kg|公斤)$/iu.exec(raw)?.[1]);
    return Number.isFinite(amount) && amount > 0
      ? {
          matched: true,
          value: { kind: "kg", value: amount, unit: "kg", raw: `${amount}kg` },
        }
      : { matched: false };
  }
  return typeof value === "string" || typeof value === "number"
    ? { matched: true, value }
    : { matched: false };
}

function confirmationFieldLabel(candidate: WorkoutLogCandidate, path: string): string {
  const location = parseWorkoutLogFieldPath(path);
  if (location === undefined) return "未知字段";
  if (location.kind === "top-level") return location.key;
  if (location.kind === "test-result") return `测试 ${location.testResultIndex + 1} ${location.key}`;
  if (!("exercises" in candidate)) return `动作 ${location.exerciseIndex + 1}`;
  const exercise = candidate.exercises[location.exerciseIndex];
  const name = exercise?.rawLabel.value ?? `动作 ${location.exerciseIndex + 1}`;
  if (location.kind === "set") return `${name}第 ${location.setIndex + 1} 组`;
  const suffix = {
    rawLabel: "动作名称",
    exerciseId: "动作",
    load: "重量",
    actionQuality: "动作质量",
    problemNote: "问题备注",
  }[location.key];
  return `${name}${suffix}`;
}

function sessionStateKey(sessionKey: string): string {
  return createHash("sha256").update(sessionKey).digest("hex");
}

function workoutLogCandidateFieldValue(
  candidate: WorkoutLogCandidate,
  path: string,
): unknown {
  const location = parseWorkoutLogFieldPath(path);
  if (location === undefined) return null;
  if (location.kind === "top-level") return candidate[location.key].value;
  if (location.kind === "test-result") {
    if (!("testResults" in candidate)) return null;
    return candidate.testResults[location.testResultIndex]?.[location.key].value ?? null;
  }
  if (!("exercises" in candidate)) return null;
  const exercise = candidate.exercises[location.exerciseIndex];
  if (exercise === undefined) return null;
  return location.kind === "set"
    ? exercise.sets[location.setIndex]?.value ?? null
    : exercise[location.key].value;
}
