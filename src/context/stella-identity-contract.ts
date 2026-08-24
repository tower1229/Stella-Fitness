import { createHash } from "node:crypto";

import type { StellaIdentityContext } from "./identity-bootstrap.js";
import {
  canonicalizeJcs,
  FitnessContextContractError,
  type RuntimeProjectionBinding,
  type RuntimeProjectionContract,
  type RuntimeProjectionManifest,
  type RuntimeProjectionPointer,
} from "./runtime-contract.js";

const ID = /^[a-z0-9][a-z0-9._-]{0,127}$/u;
const SOURCE_REVISION = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;
const POINTER_REVISION = /^pointer-[a-f0-9]{64}$/u;
const PROJECTION_REVISION = /^projection-[a-f0-9]{64}$/u;
const CHECKSUM = /^sha256:[a-f0-9]{64}$/u;
const RELATIVE_PATH = /^(?!\/)(?![A-Za-z]:[\\/])(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._/-]+$/u;

export const stellaIdentityProjectionContract:
RuntimeProjectionContract<StellaIdentityContext> = {
  contractId: "stella.runtime-to-fitness.identity-context/v1",
  limits: {
    pointerBytes: 64 * 1024,
    manifestBytes: 1024 * 1024,
    payloadBytes: 1024 * 1024,
    payloadFiles: 32,
  },
  parsePointer(bytes, binding) {
    const value = parseCanonicalRecord(bytes);
    const status = value.status;
    if (value.schema_version !== "stella.context-projection-pointer/v1") {
      incompatible();
    }
    if (
      !bindingMatches(value, binding) ||
      (status !== "active" && status !== "stale" &&
        status !== "blocked" && status !== "revoked") ||
      typeof value.pointer_revision !== "string" ||
      !POINTER_REVISION.test(value.pointer_revision) ||
      typeof value.source_revision !== "string" ||
      !SOURCE_REVISION.test(value.source_revision) ||
      !isDateTime(value.changed_at)
    ) invalid();
    if (status === "blocked" || status === "revoked") {
      assertExactFields(value, [
        "schema_version", "instance_id", "producer_id", "consumer_id",
        "status", "pointer_revision", "source_revision", "changed_at",
        "reason_codes",
      ]);
      validateReasonCodes(value.reason_codes);
      return { status };
    }
    const revisionKey = status === "active"
      ? "projection_revision"
      : "last_verified_revision";
    assertExactFields(value, [
      "schema_version", "instance_id", "producer_id", "consumer_id",
      "status", "pointer_revision", revisionKey, "manifest_checksum",
      "source_revision", "as_of", "changed_at",
      ...(status === "stale" ? ["reason_codes"] : []),
    ]);
    const projectionRevision = value[revisionKey];
    if (
      typeof projectionRevision !== "string" ||
      !PROJECTION_REVISION.test(projectionRevision) ||
      typeof value.manifest_checksum !== "string" ||
      !CHECKSUM.test(value.manifest_checksum) ||
      !isDateTime(value.as_of)
    ) invalid();
    if (status === "stale") validateReasonCodes(value.reason_codes);
    return {
      status,
      projectionRevision,
      manifestChecksum: value.manifest_checksum,
      sourceRevision: value.source_revision,
      asOf: value.as_of,
    } as RuntimeProjectionPointer;
  },
  parseManifest(bytes, binding, pointer) {
    const value = parseCanonicalRecord(bytes);
    if (value.schema_version !== "stella.context-projection-manifest/v1") {
      incompatible();
    }
    assertExactFields(value, [
      "schema_version", "instance_id", "producer_id", "consumer_id",
      "projection_revision", "source", "categories", "source_references",
      "conflicts", "retractions", "capabilities", "payloads", "generated_at",
    ]);
    const source = asRecord(value.source);
    if (
      !bindingMatches(value, binding) ||
      value.projection_revision !== pointer.projectionRevision ||
      source === undefined ||
      !exactFields(source, ["revision", "as_of"]) ||
      typeof source.revision !== "string" ||
      !SOURCE_REVISION.test(source.revision) ||
      !isDateTime(source.as_of) ||
      (pointer.sourceRevision !== undefined &&
        source.revision !== pointer.sourceRevision) ||
      (pointer.asOf !== undefined && source.as_of !== pointer.asOf) ||
      !isDateTime(value.generated_at)
    ) invalid();
    const categories = stringArray(value.categories, 1, 2);
    if (
      categories === undefined ||
      categories.some((category) => category !== "background" && category !== "identity") ||
      !isSortedUnique(categories)
    ) invalid();
    const sourceReferenceIds = validateSourceReferences(value.source_references);
    validateConflictAndRetractionCollections(value.conflicts, value.retractions);
    const materialIdentityUpdate = validateCapabilities(value.capabilities);
    const payloads = validatePayloads(value.payloads);
    const identityCandidates = payloads.filter(({ mediaType }) =>
      mediaType === "application/json"
    );
    if (identityCandidates.length < 1) invalid();
    const revisionSeed = {
      schema_version: "stella.context-projection-revision-seed/v1",
      instance_id: value.instance_id,
      producer_id: value.producer_id,
      consumer_id: value.consumer_id,
      source,
      categories: value.categories,
      source_references: value.source_references,
      conflicts: value.conflicts,
      retractions: value.retractions,
      capabilities: value.capabilities,
      payloads: value.payloads,
    };
    const calculated = `projection-${createHash("sha256")
      .update(canonicalizeJcs(revisionSeed)).digest("hex")}`;
    if (calculated !== value.projection_revision) invalid();
    return {
      sourceRevision: source.revision,
      asOf: source.as_of,
      identityContextCandidatePaths: identityCandidates.map(({ path }) => path),
      categories: categories as readonly ("background" | "identity")[],
      sourceReferenceIds,
      materialIdentityUpdate,
      declaredFiles: payloads.map(({ path, checksum, byteLength }) => ({
        relativePath: path,
        checksum,
        byteLength,
      })),
    } satisfies RuntimeProjectionManifest;
  },
  parseIdentityContext(bytes, binding, manifest) {
    const parsed = parseCanonicalValue(bytes);
    const value = asRecord(parsed);
    if (value?.schema_version !== "stella.identity-context/v1") return undefined;
    assertExactFields(value, [
      "schema_version", "instance_id", "producer_id", "consumer_id",
      "source_revision", "as_of", "categories", "entries",
    ]);
    if (
      !bindingMatches(value, binding) ||
      value.source_revision !== manifest.sourceRevision ||
      value.as_of !== manifest.asOf
    ) invalid();
    const categories = stringArray(value.categories, 1, 2);
    if (
      categories === undefined ||
      categories.some((category) => category !== "background" && category !== "identity") ||
      !isSortedUnique(categories)
    ) invalid();
    if (
      manifest.categories !== undefined &&
      categories.join("\n") !== manifest.categories.join("\n")
    ) invalid();
    if (!Array.isArray(value.entries) || value.entries.length > 256) invalid();
    const entries = value.entries.map((candidate) => {
      const entry = asRecord(candidate);
      if (entry === undefined) invalid();
      assertExactFields(entry, ["id", "category", "content", "source_reference_ids"]);
      const references = stringArray(entry.source_reference_ids, 1, 64);
      if (
        typeof entry.id !== "string" || !ID.test(entry.id) ||
        (entry.category !== "background" && entry.category !== "identity") ||
        !categories.includes(entry.category) ||
        typeof entry.content !== "string" || entry.content.length < 1 ||
        entry.content.length > 8192 || references === undefined ||
        references.some((reference) => !ID.test(reference)) ||
        !isSortedUnique(references)
      ) invalid();
      if (
        manifest.sourceReferenceIds !== undefined &&
        references.some((reference) => !manifest.sourceReferenceIds!.includes(reference))
      ) invalid();
      const category = entry.category as "background" | "identity";
      return {
        id: entry.id,
        category,
        content: entry.content,
        source_reference_ids: references,
      };
    });
    if (!isSortedUnique(entries.map(({ category, id }) => `${category}\0${id}`))) {
      invalid();
    }
    return {
      schema_version: "stella.identity-context/v1",
      instance_id: value.instance_id as string,
      producer_id: "stella-runtime",
      consumer_id: "stella-fitness",
      source_revision: value.source_revision as string,
      as_of: value.as_of as string,
      categories: categories as readonly ("background" | "identity")[],
      entries,
    };
  },
};

function parseCanonicalRecord(bytes: Buffer): Readonly<Record<string, unknown>> {
  const record = asRecord(parseCanonicalValue(bytes));
  if (record === undefined) invalid();
  return record;
}

function parseCanonicalValue(bytes: Buffer): unknown {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    invalid();
  }
  if (!canonicalizeJcs(value).equals(bytes)) invalid();
  return value;
}

function bindingMatches(
  value: Readonly<Record<string, unknown>>,
  binding: RuntimeProjectionBinding,
): boolean {
  return value.instance_id === binding.instanceId &&
    value.producer_id === binding.producerId &&
    value.consumer_id === binding.consumerId;
}

function validateSourceReferences(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length > 512) invalid();
  const keys: string[] = [];
  const ids: string[] = [];
  const paths: string[] = [];
  for (const candidate of value) {
    const reference = asRecord(candidate);
    if (reference === undefined) invalid();
    assertExactFields(reference, ["id", "path", "revision", "checksum"]);
    if (
      typeof reference.id !== "string" || !ID.test(reference.id) ||
      typeof reference.path !== "string" || !RELATIVE_PATH.test(reference.path) ||
      typeof reference.revision !== "string" || !SOURCE_REVISION.test(reference.revision) ||
      typeof reference.checksum !== "string" || !CHECKSUM.test(reference.checksum)
    ) invalid();
    keys.push(`${reference.id}\0${reference.path}`);
    ids.push(reference.id);
    paths.push(reference.path);
  }
  if (
    !isSortedUnique(keys) ||
    new Set(ids).size !== ids.length ||
    new Set(paths).size !== paths.length
  ) invalid();
  return ids;
}

function validateConflictAndRetractionCollections(
  conflicts: unknown,
  retractions: unknown,
): void {
  if (!Array.isArray(conflicts) || conflicts.length > 128 ||
    !Array.isArray(retractions) || retractions.length > 512) invalid();
  const conflictIds: string[] = [];
  for (const candidate of conflicts) {
    const conflict = asRecord(candidate);
    if (conflict === undefined) invalid();
    assertExactFields(conflict, ["id", "source_reference_ids", "summary"]);
    const references = stringArray(conflict.source_reference_ids, 2, 16);
    if (
      typeof conflict.id !== "string" || !ID.test(conflict.id) ||
      references === undefined || references.some((reference) => !ID.test(reference)) ||
      !isSortedUnique(references) || typeof conflict.summary !== "string" ||
      conflict.summary.length < 1 || conflict.summary.length > 1024
    ) invalid();
    conflictIds.push(conflict.id);
  }
  const retractionIds: string[] = [];
  for (const candidate of retractions) {
    const retraction = asRecord(candidate);
    if (retraction === undefined) invalid();
    assertExactFields(retraction, ["id", "source_reference_id", "retracted_revision"]);
    if (
      typeof retraction.id !== "string" || !ID.test(retraction.id) ||
      typeof retraction.source_reference_id !== "string" ||
      !ID.test(retraction.source_reference_id) ||
      typeof retraction.retracted_revision !== "string" ||
      !PROJECTION_REVISION.test(retraction.retracted_revision)
    ) invalid();
    retractionIds.push(retraction.id);
  }
  if (!isSortedUnique(conflictIds) || !isSortedUnique(retractionIds)) invalid();
}

function validateCapabilities(value: unknown): boolean {
  if (!Array.isArray(value) || value.length < 1 || value.length > 16) invalid();
  const keys: string[] = [];
  let identityAvailable = false;
  let materialIdentityUpdate = false;
  for (const candidate of value) {
    const capability = asRecord(candidate);
    if (capability === undefined) invalid();
    assertExactFields(capability, ["id", "state"]);
    if (
      capability.id !== "background_context" &&
      capability.id !== "identity_context" &&
      capability.id !== "material_identity_update"
    ) invalid();
    if (capability.state !== "available" && capability.state !== "degraded" &&
      capability.state !== "unavailable") invalid();
    if (capability.id === "identity_context" && capability.state === "available") {
      identityAvailable = true;
    }
    if (
      capability.id === "material_identity_update" &&
      capability.state === "available"
    ) materialIdentityUpdate = true;
    keys.push(capability.id);
  }
  if (!identityAvailable || !isSortedUnique(keys)) invalid();
  return materialIdentityUpdate;
}

function validatePayloads(value: unknown): readonly {
  readonly path: string;
  readonly mediaType: "application/json" | "text/markdown";
  readonly byteLength: number;
  readonly checksum: string;
}[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 32) invalid();
  const payloads = value.map((candidate) => {
    const payload = asRecord(candidate);
    if (payload === undefined) invalid();
    assertExactFields(payload, ["path", "media_type", "byte_length", "checksum"]);
    if (
      typeof payload.path !== "string" || !RELATIVE_PATH.test(payload.path) ||
      (payload.media_type !== "application/json" &&
        payload.media_type !== "text/markdown") ||
      !Number.isSafeInteger(payload.byte_length) ||
      (payload.byte_length as number) < 1 ||
      (payload.byte_length as number) > 1024 * 1024 ||
      typeof payload.checksum !== "string" || !CHECKSUM.test(payload.checksum)
    ) invalid();
    const mediaType = payload.media_type as "application/json" | "text/markdown";
    return {
      path: payload.path,
      mediaType,
      byteLength: payload.byte_length as number,
      checksum: payload.checksum,
    };
  });
  if (!isSortedUnique(payloads.map(({ path }) => path))) invalid();
  return payloads;
}

function validateReasonCodes(value: unknown): void {
  const reasons = stringArray(value, 1, 16);
  if (
    reasons === undefined ||
    reasons.some((reason) => !/^[A-Z][A-Z0-9_]{0,63}$/u.test(reason)) ||
    new Set(reasons).size !== reasons.length
  ) invalid();
}

function isDateTime(value: unknown): value is string {
  return typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(value) &&
    Number.isFinite(Date.parse(value));
}

function stringArray(
  value: unknown,
  minimum: number,
  maximum: number,
): readonly string[] | undefined {
  return Array.isArray(value) && value.length >= minimum && value.length <= maximum &&
      value.every((item) => typeof item === "string")
    ? value
    : undefined;
}

function isSortedUnique(values: readonly string[]): boolean {
  return values.every((value, index) => index === 0 || values[index - 1]! < value);
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : undefined;
}

function exactFields(
  value: Readonly<Record<string, unknown>>,
  fields: readonly string[],
): boolean {
  const expected = [...fields].sort();
  const actual = Object.keys(value).sort();
  return actual.length === expected.length &&
    actual.every((field, index) => field === expected[index]);
}

function assertExactFields(
  value: Readonly<Record<string, unknown>>,
  fields: readonly string[],
): void {
  if (!exactFields(value, fields)) invalid();
}

function invalid(): never {
  throw new FitnessContextContractError("PROJECTION_FILE_INVALID");
}

function incompatible(): never {
  throw new FitnessContextContractError("CONTRACT_INCOMPATIBLE");
}
