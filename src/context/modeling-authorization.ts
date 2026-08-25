import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { canonicalizeJcs } from "./runtime-contract.js";

const STATE_SCHEMA = "stella-fitness/context-modeling-authorization/v1";
const RECEIPT_SCHEMA = "stella-fitness/context-modeling-authorization-receipt/v1";
const PROVENANCE_SCHEMA = "stella-fitness/projection-provenance/v1";
const CHECKSUM = /^sha256:[a-f0-9]{64}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;
const SAFE_VERSION = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/u;

export type PersonalContextModelingScope = {
  readonly provider: string;
  readonly purpose: string;
  readonly dataCategories: readonly string[];
  readonly retentionBoundary: string;
};

export type PersonalContextModelingAuthorizationReceipt = {
  readonly schema_version: typeof RECEIPT_SCHEMA;
  readonly authorization_receipt_id: string;
  readonly provider: string;
  readonly purpose: string;
  readonly data_categories: readonly string[];
  readonly retention_boundary: string;
  readonly scope_checksum: string;
  readonly granted_at: string;
  readonly status: "active" | "revoked";
  readonly revoked_at?: string;
};

export type ProjectionProvenance = {
  readonly schema_version: typeof PROVENANCE_SCHEMA;
  readonly source_references: readonly {
    readonly id: string;
    readonly checksum: string;
  }[];
  readonly provider: string;
  readonly model: string;
  readonly schema_version_used: string;
  readonly prompt_version: string;
  readonly input_categories: readonly string[];
  readonly generated_at: string;
  readonly output_checksum: string;
  readonly authorization_receipt_id: string;
  readonly authorization_scope_checksum: string;
};

type SafeLogEvent = Readonly<Record<string, string | number>>;

export function createPersonalContextModelingGate(options: {
  readonly runtimeDirectory: string;
  readonly formalContractAllowsRemoteModeling: boolean;
  readonly now?: () => Date;
  readonly createId?: () => string;
  readonly logger?: (event: SafeLogEvent) => void;
}) {
  const now = options.now ?? (() => new Date());
  const createId = options.createId ?? randomUUID;
  const directory = join(options.runtimeDirectory, "context-modeling");
  const statePath = join(directory, "authorization.json");
  let pending: { readonly requestId: string; readonly scope: PersonalContextModelingScope } | undefined;
  let receipt = readReceipt(statePath);

  const authorizeOutbound = (scope: PersonalContextModelingScope) => {
    validateScope(scope);
    if (!options.formalContractAllowsRemoteModeling) {
      return blocked("FORMAL_CONTRACT_REQUIRED");
    }
    if (receipt === undefined) return blocked("AUTHORIZATION_REQUIRED");
    if (receipt.status === "revoked") return blocked("AUTHORIZATION_REVOKED");
    if (receipt.scope_checksum !== scopeChecksum(scope)) {
      return blocked("AUTHORIZATION_SCOPE_MISMATCH");
    }
    return { status: "authorized" as const, receipt };
  };

  return {
    requestAuthorization(scope: PersonalContextModelingScope) {
      validateScope(scope);
      if (!options.formalContractAllowsRemoteModeling) {
        return blocked("FORMAL_CONTRACT_REQUIRED");
      }
      pending = { requestId: `request-${createId()}`, scope: normalizedScope(scope) };
      options.logger?.({
        event: "context_modeling_authorization_requested",
        provider: scope.provider,
        purpose: scope.purpose,
        categoryCount: scope.dataCategories.length,
      });
      return {
        status: "confirmation-required" as const,
        requestId: pending.requestId,
        provider: pending.scope.provider,
        purpose: pending.scope.purpose,
        dataCategories: pending.scope.dataCategories,
        retentionBoundary: pending.scope.retentionBoundary,
        disclosure: authorizationDisclosure(pending.scope),
      };
    },
    authorize(input: { readonly requestId: string; readonly confirmed: boolean }) {
      if (pending === undefined || pending.requestId !== input.requestId) {
        return { status: "rejected" as const, reasonCode: "AUTHORIZATION_REQUEST_MISMATCH" as const };
      }
      const request = pending;
      pending = undefined;
      if (!input.confirmed) {
        options.logger?.({ event: "context_modeling_authorization_declined" });
        return { status: "declined" as const };
      }
      receipt = {
        schema_version: RECEIPT_SCHEMA,
        authorization_receipt_id: `receipt-${createId()}`,
        provider: request.scope.provider,
        purpose: request.scope.purpose,
        data_categories: request.scope.dataCategories,
        retention_boundary: request.scope.retentionBoundary,
        scope_checksum: scopeChecksum(request.scope),
        granted_at: now().toISOString(),
        status: "active",
      };
      persistReceipt(statePath, receipt);
      options.logger?.({
        event: "context_modeling_authorization_granted",
        authorizationReceiptId: receipt.authorization_receipt_id,
        provider: receipt.provider,
        purpose: receipt.purpose,
        categoryCount: receipt.data_categories.length,
      });
      return { status: "authorized" as const, receipt };
    },
    revoke(authorizationReceiptId: string) {
      if (receipt === undefined || receipt.authorization_receipt_id !== authorizationReceiptId) {
        return { status: "not-found" as const };
      }
      if (receipt.status !== "revoked") {
        receipt = { ...receipt, status: "revoked", revoked_at: now().toISOString() };
        persistReceipt(statePath, receipt);
      }
      options.logger?.({
        event: "context_modeling_authorization_revoked",
        authorizationReceiptId,
      });
      return { status: "revoked" as const };
    },
    authorizeOutbound,
    verifyGeneratedProjection(input: {
      readonly authorizationReceiptId: string;
      readonly scope: PersonalContextModelingScope;
      readonly sourceReferences: readonly { readonly id: string; readonly checksum: string }[];
      readonly model: string;
      readonly schemaVersion: string;
      readonly promptVersion: string;
      readonly generatedAt: string;
      readonly outputChecksum: string;
    }) {
      const authorization = authorizeOutbound(input.scope);
      if (authorization.status !== "authorized") {
        return { status: "rejected" as const, reasonCode: authorization.reasonCode };
      }
      if (authorization.receipt.authorization_receipt_id !== input.authorizationReceiptId) {
        return { status: "rejected" as const, reasonCode: "AUTHORIZATION_RECEIPT_MISMATCH" as const };
      }
      if (!validGeneratedProjectionMetadata(input)) {
        return { status: "rejected" as const, reasonCode: "PROJECTION_PROVENANCE_INVALID" as const };
      }
      const provenance: ProjectionProvenance = {
        schema_version: PROVENANCE_SCHEMA,
        source_references: normalizedReferences(input.sourceReferences),
        provider: authorization.receipt.provider,
        model: input.model,
        schema_version_used: input.schemaVersion,
        prompt_version: input.promptVersion,
        input_categories: authorization.receipt.data_categories,
        generated_at: input.generatedAt,
        output_checksum: input.outputChecksum,
        authorization_receipt_id: authorization.receipt.authorization_receipt_id,
        authorization_scope_checksum: authorization.receipt.scope_checksum,
      };
      options.logger?.({
        event: "context_modeling_projection_verified",
        authorizationReceiptId: provenance.authorization_receipt_id,
        provider: provenance.provider,
        model: provenance.model,
        categoryCount: provenance.input_categories.length,
        sourceCount: provenance.source_references.length,
      });
      return { status: "verified" as const, provenance };
    },
    shouldRegenerate(input: {
      readonly previous: ProjectionProvenance;
      readonly authorizationReceiptId: string;
      readonly scope: PersonalContextModelingScope;
      readonly sourceReferences: readonly { readonly id: string; readonly checksum: string }[];
      readonly model: string;
      readonly schemaVersion: string;
      readonly promptVersion: string;
    }): boolean {
      const authorization = authorizeOutbound(input.scope);
      if (authorization.status !== "authorized") return false;
      return authorization.receipt.authorization_receipt_id !== input.authorizationReceiptId ||
        input.previous.authorization_receipt_id !== input.authorizationReceiptId ||
        input.previous.authorization_scope_checksum !== authorization.receipt.scope_checksum ||
        input.previous.provider !== authorization.receipt.provider ||
        input.previous.model !== input.model ||
        input.previous.schema_version_used !== input.schemaVersion ||
        input.previous.prompt_version !== input.promptVersion ||
        JSON.stringify(input.previous.source_references) !==
          JSON.stringify(normalizedReferences(input.sourceReferences));
    },
    diagnostics() {
      return {
        mode: options.formalContractAllowsRemoteModeling
          ? "remote-modeling-available" as const
          : "deterministic-only" as const,
        authorizationStatus: receipt?.status ?? "not-authorized" as const,
        ...(receipt === undefined ? {} : {
          provider: receipt.provider,
          purpose: receipt.purpose,
          dataCategories: receipt.data_categories,
          retentionBoundary: receipt.retention_boundary,
          authorizationReceiptId: receipt.authorization_receipt_id,
        }),
      };
    },
  };
}

function authorizationDisclosure(scope: PersonalContextModelingScope): string {
  return [
    "Stella Fitness 请求使用远程模型处理个人上下文。",
    `Provider：${scope.provider}。`,
    `用途：${scope.purpose}。`,
    `数据类别：${scope.dataCategories.join("、")}。`,
    `拟发送范围：仅上述类别经正式合同筛选后的内容。`,
    `保留边界：${scope.retentionBoundary}。`,
    "只有明确确认后才会允许本次 scope 的未来请求；Provider、用途或类别变化会要求重新授权。",
  ].join("\n");
}

function normalizedScope(scope: PersonalContextModelingScope): PersonalContextModelingScope {
  return { ...scope, dataCategories: [...scope.dataCategories].sort() };
}

function scopeChecksum(scope: PersonalContextModelingScope): string {
  return `sha256:${createHash("sha256").update(canonicalizeJcs({
    provider: scope.provider,
    purpose: scope.purpose,
    data_categories: [...scope.dataCategories].sort(),
    retention_boundary: scope.retentionBoundary,
  })).digest("hex")}`;
}

function validateScope(scope: PersonalContextModelingScope): void {
  if (
    !SAFE_ID.test(scope.provider) || !SAFE_ID.test(scope.purpose) ||
    !SAFE_ID.test(scope.retentionBoundary) || scope.dataCategories.length < 1 ||
    new Set(scope.dataCategories).size !== scope.dataCategories.length ||
    scope.dataCategories.some((value) => !SAFE_ID.test(value))
  ) throw new Error("PERSONAL_CONTEXT_MODELING_SCOPE_INVALID");
}

function validGeneratedProjectionMetadata(input: {
  readonly sourceReferences: readonly { readonly id: string; readonly checksum: string }[];
  readonly model: string;
  readonly schemaVersion: string;
  readonly promptVersion: string;
  readonly generatedAt: string;
  readonly outputChecksum: string;
}): boolean {
  return input.sourceReferences.length > 0 &&
    input.sourceReferences.every(({ id, checksum }) => SAFE_ID.test(id) && CHECKSUM.test(checksum)) &&
    new Set(input.sourceReferences.map(({ id }) => id)).size === input.sourceReferences.length &&
    SAFE_ID.test(input.model) && SAFE_VERSION.test(input.schemaVersion) &&
    SAFE_VERSION.test(input.promptVersion) && !Number.isNaN(Date.parse(input.generatedAt)) &&
    CHECKSUM.test(input.outputChecksum);
}

function normalizedReferences(
  references: readonly { readonly id: string; readonly checksum: string }[],
) {
  return [...references].sort((left, right) => left.id.localeCompare(right.id));
}

function blocked(reasonCode:
  | "FORMAL_CONTRACT_REQUIRED"
  | "AUTHORIZATION_REQUIRED"
  | "AUTHORIZATION_REVOKED"
  | "AUTHORIZATION_SCOPE_MISMATCH") {
  return { status: "blocked" as const, reasonCode };
}

function persistReceipt(
  statePath: string,
  receipt: PersonalContextModelingAuthorizationReceipt,
): void {
  const directory = join(statePath, "..");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const temporary = `${statePath}.tmp`;
  writeFileSync(temporary, canonicalizeJcs({ schema_version: STATE_SCHEMA, receipt }), {
    mode: 0o600,
  });
  renameSync(temporary, statePath);
}

function readReceipt(statePath: string): PersonalContextModelingAuthorizationReceipt | undefined {
  try {
    const value: unknown = JSON.parse(readFileSync(statePath, "utf8"));
    if (!isRecord(value) || value.schema_version !== STATE_SCHEMA || !isRecord(value.receipt)) {
      return undefined;
    }
    const candidate = value.receipt;
    if (
      !hasExactKeys(value, ["schema_version", "receipt"]) ||
      !hasExactKeys(candidate, [
        "schema_version", "authorization_receipt_id", "provider", "purpose",
        "data_categories", "retention_boundary", "scope_checksum", "granted_at",
        "status", ...(candidate.revoked_at === undefined ? [] : ["revoked_at"]),
      ]) ||
      candidate.schema_version !== RECEIPT_SCHEMA ||
      typeof candidate.authorization_receipt_id !== "string" ||
      typeof candidate.provider !== "string" || typeof candidate.purpose !== "string" ||
      !Array.isArray(candidate.data_categories) ||
      candidate.data_categories.some((item) => typeof item !== "string") ||
      typeof candidate.retention_boundary !== "string" ||
      typeof candidate.scope_checksum !== "string" || !CHECKSUM.test(candidate.scope_checksum) ||
      typeof candidate.granted_at !== "string" ||
      (candidate.status !== "active" && candidate.status !== "revoked") ||
      (candidate.revoked_at !== undefined && typeof candidate.revoked_at !== "string") ||
      (candidate.status === "active" && candidate.revoked_at !== undefined)
    ) return undefined;
    const restored: PersonalContextModelingAuthorizationReceipt = {
      schema_version: RECEIPT_SCHEMA,
      authorization_receipt_id: candidate.authorization_receipt_id,
      provider: candidate.provider,
      purpose: candidate.purpose,
      data_categories: candidate.data_categories as string[],
      retention_boundary: candidate.retention_boundary,
      scope_checksum: candidate.scope_checksum,
      granted_at: candidate.granted_at,
      status: candidate.status,
      ...(candidate.revoked_at === undefined ? {} : { revoked_at: candidate.revoked_at }),
    };
    try {
      validateScope({
        provider: restored.provider,
        purpose: restored.purpose,
        dataCategories: restored.data_categories,
        retentionBoundary: restored.retention_boundary,
      });
    } catch {
      return undefined;
    }
    return restored.scope_checksum === scopeChecksum({
      provider: restored.provider,
      purpose: restored.purpose,
      dataCategories: restored.data_categories,
      retentionBoundary: restored.retention_boundary,
    }) ? restored : undefined;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index]);
}
