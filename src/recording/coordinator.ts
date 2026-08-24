import { createHash } from "node:crypto";

import {
  fitnessWriteCandidateFields,
  type FitnessWriteCandidate,
} from "./candidate.js";
import type { FitnessWriteCandidateClassifier } from "./openclaw.js";

const RECEIPT_TTL_MS = 15 * 60 * 1_000;

export type NaturalRecordingReceipt = {
  readonly schemaVersion: "stella-fitness/natural-recording-receipt/v0.1";
  readonly candidateId: string;
  readonly candidate: FitnessWriteCandidate;
  readonly fields: Readonly<Record<string, string | number>>;
  readonly sourceMessage: string;
  readonly source: {
    readonly channel?: string;
    readonly messageId?: string;
    readonly runId?: string;
  };
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly canonicalBase: string;
};

export type NaturalRecordingReceiptStore = {
  read(key: string): Promise<NaturalRecordingReceipt | undefined>;
  write(key: string, value: NaturalRecordingReceipt): Promise<void>;
  delete(key: string): Promise<boolean>;
};

type ConfirmationResult = {
  readonly status: "confirmation";
  readonly message: string;
  readonly reason?:
    | "canonical-base-drift"
    | "candidate-modified"
    | "receipt-expired";
};

export function createNaturalRecordingCoordinator(options: {
  readonly store: NaturalRecordingReceiptStore;
  readonly classifier: FitnessWriteCandidateClassifier;
  canonicalFitnessStateDigest(): Promise<string>;
  promote(input: NaturalRecordingReceipt): Promise<string>;
  readonly now?: () => string;
}) {
  const now = options.now ?? (() => new Date().toISOString());
  return {
    async start(input: {
      readonly sessionKey: string;
      readonly text: string;
      readonly receivedAt: string;
      readonly source: NaturalRecordingReceipt["source"];
    }): Promise<ConfirmationResult | { readonly status: "not-applicable" }> {
      const classification = await options.classifier.classify({
        text: input.text,
        receivedAt: input.receivedAt,
      });
      if (classification.status !== "candidate") {
        return { status: "not-applicable" };
      }
      const receipt = createReceipt({
        candidate: classification.candidate,
        sourceMessage: input.text,
        source: input.source,
        issuedAt: input.receivedAt,
        expiresAt: receiptExpiry(now()),
        canonicalBase: await options.canonicalFitnessStateDigest(),
      });
      await options.store.write(sessionKeyHash(input.sessionKey), receipt);
      return { status: "confirmation", message: confirmationMessage(receipt.candidate) };
    },
    async submit(input: {
      readonly sessionKey: string;
      readonly text: string;
      readonly receivedAt?: string;
      readonly source?: NaturalRecordingReceipt["source"];
    }): Promise<
      | ConfirmationResult
      | { readonly status: "not-applicable" }
      | { readonly status: "cancelled"; readonly message: string }
      | { readonly status: "recorded"; readonly message: string }
    > {
      const key = sessionKeyHash(input.sessionKey);
      const receipt = await options.store.read(key);
      if (receipt === undefined) return { status: "not-applicable" };
      if (/^\s*(?:不记录了|取消|算了|拒绝)\s*[。.!！]?\s*$/u.test(input.text)) {
        await options.store.delete(key);
        return {
          status: "cancelled",
          message: "已取消这次记录，没有保存任何健身事实。",
        };
      }
      const submittedAt = input.receivedAt ?? now();
      if (Date.parse(submittedAt) > Date.parse(receipt.expiresAt)) {
        const updated = createReceipt({
          ...receipt,
          expiresAt: receiptExpiry(submittedAt),
          canonicalBase: await options.canonicalFitnessStateDigest(),
        });
        await options.store.write(key, updated);
        return {
          status: "confirmation",
          reason: "receipt-expired",
          message: `候选确认已过期。${confirmationMessage(updated.candidate)}`,
        };
      }
      if (!/^\s*(?:确认|确认记录|保存)\s*[。.!！]?\s*$/u.test(input.text)) {
        const modified = await options.classifier.classify({
          text: input.text,
          receivedAt: submittedAt,
        });
        if (modified.status === "not-applicable") {
          return { status: "not-applicable" };
        }
        if (modified.status !== "candidate") {
          return {
            status: "confirmation",
            message: `${confirmationMessage(receipt.candidate)} 如需修改，请直接说明新的字段和值。`,
          };
        }
        const updated = createReceipt({
          candidate: modified.candidate,
          sourceMessage: input.text,
          source: input.source ?? receipt.source,
          issuedAt: receipt.issuedAt,
          expiresAt: receiptExpiry(submittedAt),
          canonicalBase: await options.canonicalFitnessStateDigest(),
        });
        await options.store.write(key, updated);
        return {
          status: "confirmation",
          reason: "candidate-modified",
          message: confirmationMessage(updated.candidate),
        };
      }
      const currentBase = await options.canonicalFitnessStateDigest();
      if (currentBase !== receipt.canonicalBase) {
        const updated = createReceipt({
          ...receipt,
          expiresAt: receiptExpiry(submittedAt),
          canonicalBase: currentBase,
        });
        await options.store.write(key, updated);
        return {
          status: "confirmation",
          reason: "canonical-base-drift",
          message: `相关健身数据已变化。${confirmationMessage(updated.candidate)}`,
        };
      }
      const message = await options.promote(receipt);
      await options.store.delete(key);
      return { status: "recorded", message };
    },
  };
}

function createReceipt(input: Omit<
  NaturalRecordingReceipt,
  "schemaVersion" | "candidateId" | "fields"
>): NaturalRecordingReceipt {
  return {
    schemaVersion: "stella-fitness/natural-recording-receipt/v0.1",
    candidateId: createHash("sha256").update(JSON.stringify(input)).digest("hex"),
    ...input,
    fields: fitnessWriteCandidateFields(input.candidate),
  };
}

function receiptExpiry(issuedAt: string): string {
  const timestamp = Date.parse(issuedAt);
  if (Number.isNaN(timestamp)) throw new Error("Natural recording receipt time is invalid");
  return new Date(timestamp + RECEIPT_TTL_MS).toISOString();
}

function confirmationMessage(candidate: FitnessWriteCandidate): string {
  if (candidate.kind === "body-weight") {
    return `候选记录：${candidate.occurredAt}，体重 ${candidate.amount} ${candidate.unit}。确认无误请回复“确认”；当前尚未保存。`;
  }
  return `候选记录：${candidate.occurredAt}，${candidate.exerciseId} 12RM ${candidate.valueKg} kg。确认无误请回复“确认”；当前尚未保存。`;
}

function sessionKeyHash(sessionKey: string): string {
  return createHash("sha256").update(sessionKey).digest("hex");
}
