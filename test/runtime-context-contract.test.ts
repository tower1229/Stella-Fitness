import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  canonicalTextBytes,
  canonicalizeJcs,
  consumeRuntimeIdentityContext,
  createRuntimeIdentityContextConsumer,
  FitnessContextContractError,
  resolveStellaPersonalDataPaths,
  type RuntimeProjectionContract,
  validateRuntimeProjectionPaths,
} from "../src/context/runtime-contract.js";
import { stellaIdentityProjectionContract } from "../src/context/stella-identity-contract.js";

describe("Runtime-owned Stella Personal Data locator", () => {
  it("resolves the only locator without requiring derived projection capability", () => {
    const repository = createRepository({ projections: false });

    expect(resolveStellaPersonalDataPaths(runtimeConfig(repository))).toEqual({
      instanceId: "stella-primary",
      repository,
      stellaRoot: join(repository, "stella"),
      fitnessData: join(repository, "stella", "fitness"),
      runtimeToFitness: join(repository, "stella", "projections", "fitness"),
      fitnessToRuntime: join(repository, "stella", "projections", "stella"),
    });
  });

  it.each([
    ["missing locator", undefined, "LOCATOR_REQUIRED"],
    [
      "relative repository",
      locator("relative/repository"),
      "LOCATOR_REPOSITORY_NOT_ABSOLUTE",
    ],
    [
      "unsupported schema",
      { ...locator("/tmp/stella"), schema_version: "stella.personal-data-locator/v2" },
      "LOCATOR_SCHEMA_UNSUPPORTED",
    ],
    [
      "instance mismatch",
      { ...locator("/tmp/stella"), instance_id: "another-instance" },
      "LOCATOR_INSTANCE_MISMATCH",
    ],
  ])("fails closed for %s", (_name, stella, code) => {
    expect(() => resolveStellaPersonalDataPaths({
      plugins: {
        entries: {
          "cognitive-runtime": {
            config: {
              runtime: { instance_id: "stella-primary" },
              ...(stella === undefined ? {} : { stella }),
            },
          },
        },
      },
    })).toThrowError(expect.objectContaining({ code }));
  });

  it("rejects unknown locator fields and symlinks at every contract segment", () => {
    const repository = createRepository({ projections: false });
    const config = runtimeConfig(repository);
    expect(() => resolveStellaPersonalDataPaths({
      ...config,
      plugins: {
        entries: {
          "cognitive-runtime": {
            config: {
              ...config.plugins.entries["cognitive-runtime"].config,
              stella: {
                ...config.plugins.entries["cognitive-runtime"].config.stella,
                copied_path: repository,
              },
            },
          },
        },
      },
    })).toThrowError(expect.objectContaining({ code: "LOCATOR_UNKNOWN_FIELD" }));

    const symlinked = mkdtempSync(join(tmpdir(), "stella-locator-"));
    const external = mkdtempSync(join(tmpdir(), "stella-external-"));
    mkdirSync(join(external, "fitness"));
    symlinkSync(external, join(symlinked, "stella"));
    expect(() => resolveStellaPersonalDataPaths(runtimeConfig(symlinked)))
      .toThrowError(expect.objectContaining({ code: "LOCATOR_SYMLINK_FORBIDDEN" }));
  });

  it("treats missing or symlinked projections as a separate context failure", () => {
    const repository = createRepository({ projections: false });
    const paths = resolveStellaPersonalDataPaths(runtimeConfig(repository));
    expect(() => validateRuntimeProjectionPaths(paths))
      .toThrowError(expect.objectContaining({ code: "LOCATOR_REPOSITORY_UNAVAILABLE" }));

    mkdirSync(join(repository, "stella", "projections"));
    mkdirSync(join(repository, "stella", "projections", "stella"));
    const external = mkdtempSync(join(tmpdir(), "stella-projection-"));
    symlinkSync(external, join(repository, "stella", "projections", "fitness"));
    expect(() => validateRuntimeProjectionPaths(paths))
      .toThrowError(expect.objectContaining({ code: "LOCATOR_SYMLINK_FORBIDDEN" }));
  });
});

describe("experimental Runtime projection seam", () => {
  it("returns active context after adapter, integrity and double-read verification", () => {
    const fixture = writeProjection({ outbound: false });

    expect(consumeRuntimeIdentityContext(fixture.config, testContract)).toEqual({
      status: "active",
      projectionRevision: fixture.revision,
      sourceRevision: "authority-42",
      asOf: "2026-08-21T06:00:00.000Z",
      manifestChecksum: fixture.manifestChecksum,
      identityContext: { name: "Stella" },
    });
  });

  it.each(["blocked", "revoked"] as const)(
    "returns %s without reading projection payloads",
    (status) => {
      const fixture = writeProjection();
      writeJson(fixture.pointerPath, { status });
      const reads: string[] = [];

      expect(consumeRuntimeIdentityContext(fixture.config, testContract, {
        readFile(path) {
          reads.push(path);
          return readFileSync(path);
        },
      })).toEqual({ status });
      expect(reads).toEqual([fixture.pointerPath]);
    },
  );

  it("propagates stale status and adapter-verified as-of through the same seam", () => {
    const fixture = writeProjection();
    const pointer = parseJson(readFileSync(fixture.pointerPath));
    writeJson(fixture.pointerPath, { ...pointer, status: "stale" });

    expect(consumeRuntimeIdentityContext(fixture.config, testContract)).toMatchObject({
      status: "stale",
      sourceRevision: "authority-42",
      asOf: "2026-08-21T06:00:00.000Z",
      identityContext: { name: "Stella" },
    });
  });

  it("rejects checksum drift and a symlink in an intermediate revision path", () => {
    const mismatch = writeProjection();
    writeFileSync(mismatch.identityPath, canonicalizeJcs({ name: "STELLA" }));
    expect(() => consumeRuntimeIdentityContext(mismatch.config, testContract))
      .toThrowError(expect.objectContaining({ code: "CHECKSUM_MISMATCH" }));

    const symlinked = writeProjection({ symlinkRevisionParent: true });
    expect(() => consumeRuntimeIdentityContext(symlinked.config, testContract))
      .toThrowError(expect.objectContaining({ code: "PROJECTION_FILE_INVALID" }));
  });

  it("bounds pointer TOCTOU retries", () => {
    const fixture = writeProjection();
    const original = readFileSync(fixture.pointerPath);
    const changed = canonicalizeJcs({ status: "revoked" });
    let reads = 0;
    expect(() => consumeRuntimeIdentityContext(fixture.config, testContract, {
      maxAttempts: 2,
      readFile(path) {
        if (path !== fixture.pointerPath) return readFileSync(path);
        reads += 1;
        return reads % 2 === 1 ? original : changed;
      },
    })).toThrowError(expect.objectContaining({ code: "PROJECTION_TOCTOU" }));
    expect(reads).toBe(4);
  });

  it("keeps last-verified context only for the same locator source and contract", () => {
    const first = writeProjection();
    const consumer = createRuntimeIdentityContextConsumer({ contract: testContract });
    const verified = consumer.consume(first.config);
    expect(verified).toMatchObject({ status: "active" });
    writeJson(first.pointerPath, { status: "incompatible" });
    expect(consumer.consume(first.config)).toEqual({ ...verified, status: "stale" });

    const second = writeProjection();
    writeJson(second.pointerPath, { status: "incompatible" });
    expect(consumer.consume(second.config)).toEqual({
      status: "degraded",
      reason: "contract-incompatible",
    });
  });

  it("degrades explicitly while Runtime #38 has not supplied an adapter", () => {
    const repository = createRepository({ projections: false });
    expect(createRuntimeIdentityContextConsumer().consume(
      runtimeConfig(repository),
    )).toEqual({
      status: "degraded",
      reason: "contract-unavailable",
    });
    expect(() => createRuntimeIdentityContextConsumer().consume({}))
      .toThrowError(expect.objectContaining({ code: "LOCATOR_REQUIRED" }));
  });
});

describe("Runtime #38 Stella Identity Context contract", () => {
  it("consumes a canonical active Runtime identity projection without a Runtime library dependency", () => {
    const fixture = writeFormalIdentityProjection();

    expect(consumeRuntimeIdentityContext(
      fixture.config,
      stellaIdentityProjectionContract,
    )).toMatchObject({
      status: "active",
      projectionRevision: fixture.revision,
      sourceRevision: "authority-42",
      asOf: "2026-08-24T01:00:00.000Z",
      identityContext: {
        schema_version: "stella.identity-context/v1",
        producer_id: "stella-runtime",
        consumer_id: "stella-fitness",
        entries: [
          expect.objectContaining({ id: "agent-name", content: "Stella" }),
          expect.objectContaining({ id: "persona-core", content: "温和、直接" }),
        ],
      },
    });
  });

  it("propagates the formally verified stale tuple", () => {
    const fixture = writeFormalIdentityProjection("stale");
    expect(consumeRuntimeIdentityContext(
      fixture.config,
      stellaIdentityProjectionContract,
    )).toMatchObject({
      status: "stale",
      projectionRevision: fixture.revision,
      sourceRevision: "authority-42",
      asOf: "2026-08-24T01:00:00.000Z",
    });
  });

  it("propagates a formal material identity update marker for stale rejection", () => {
    const fixture = writeFormalIdentityProjection("stale", {
      materialIdentityUpdate: true,
    });
    expect(consumeRuntimeIdentityContext(
      fixture.config,
      stellaIdentityProjectionContract,
    )).toMatchObject({
      status: "stale",
      materialIdentityUpdate: true,
    });
  });

  it.each(["blocked", "revoked"] as const)(
    "does not read payloads for a formal %s pointer",
    (status) => {
      const fixture = writeFormalIdentityProjection(status);
      const reads: string[] = [];
      expect(consumeRuntimeIdentityContext(
        fixture.config,
        stellaIdentityProjectionContract,
        {
          readFile(path) {
            reads.push(path);
            return readFileSync(path);
          },
        },
      )).toEqual({ status });
      expect(reads).toEqual([fixture.pointerPath]);
    },
  );
});

describe("checksum canonicalization primitives", () => {
  it("matches the RFC 8785 recursive property-order vector", () => {
    expect(canonicalizeJcs({
      numbers: [333333333.33333329, 1e30, 4.5, 0.002, 1e-27],
      literals: [null, true, false],
    }).toString("utf8")).toBe(
      '{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27]}',
    );
  });

  it("normalizes text to UTF-8 NFC, LF and one trailing LF", () => {
    expect(canonicalTextBytes("Cafe\u0301\r\nline\r\n\n").toString("utf8"))
      .toBe("Café\nline\n");
  });
});

type TestContext = { readonly name: string };

const testContract: RuntimeProjectionContract<TestContext> = {
  contractId: "test-only/runtime-projection/v1",
  limits: {
    pointerBytes: 16 * 1024,
    manifestBytes: 64 * 1024,
    payloadBytes: 64 * 1024,
    payloadFiles: 8,
  },
  parsePointer(bytes, binding) {
    expect(binding).toEqual({
      instanceId: "stella-primary",
      producerId: "stella-runtime",
      consumerId: "stella-fitness",
    });
    const value = parseJson(bytes);
    if (value.status === "blocked" || value.status === "revoked") {
      return { status: value.status };
    }
    if (value.status === "incompatible") {
      throw new FitnessContextContractError("CONTRACT_INCOMPATIBLE");
    }
    const status = value.status;
    if (
      (status !== "active" && status !== "stale") ||
      typeof value.projectionRevision !== "string" ||
      typeof value.manifestChecksum !== "string"
    ) {
      throw new FitnessContextContractError("PROJECTION_FILE_INVALID");
    }
    return {
      status,
      projectionRevision: value.projectionRevision,
      manifestChecksum: value.manifestChecksum,
    };
  },
  parseManifest(bytes) {
    const value = parseJson(bytes);
    if (
      typeof value.projectionRevision !== "string" ||
      typeof value.payloadChecksum !== "string" ||
      typeof value.payloadBytes !== "number" ||
      typeof value.auxiliaryChecksum !== "string" ||
      typeof value.auxiliaryBytes !== "number"
    ) {
      throw new FitnessContextContractError("PROJECTION_FILE_INVALID");
    }
    return {
      sourceRevision: "authority-42",
      asOf: "2026-08-21T06:00:00.000Z",
      identityContextPath: "identity.json",
      declaredFiles: [{
        relativePath: "identity.json",
        checksum: value.payloadChecksum,
        byteLength: value.payloadBytes,
      }, {
        relativePath: "auxiliary.json",
        checksum: value.auxiliaryChecksum,
        byteLength: value.auxiliaryBytes,
      }],
    };
  },
  parseIdentityContext(bytes) {
    const value = parseJson(bytes);
    if (typeof value.name !== "string") {
      throw new FitnessContextContractError("PROJECTION_FILE_INVALID");
    }
    return { name: value.name };
  },
};

function writeProjection(options: {
  readonly symlinkRevisionParent?: boolean;
  readonly outbound?: boolean;
} = {}) {
  const repository = createRepository({
    projections: true,
    ...(options.outbound === undefined ? {} : { outbound: options.outbound }),
  });
  const config = runtimeConfig(repository);
  const inbound = join(repository, "stella", "projections", "fitness");
  const revision = `projection-${"a".repeat(64)}`;
  const identityBytes = canonicalizeJcs({ name: "Stella" });
  const auxiliaryBytes = canonicalizeJcs({ capability: "test-only" });
  const manifestBytes = canonicalizeJcs({
    projectionRevision: revision,
    payloadChecksum: checksum(identityBytes),
    payloadBytes: identityBytes.byteLength,
    auxiliaryChecksum: checksum(auxiliaryBytes),
    auxiliaryBytes: auxiliaryBytes.byteLength,
  });
  const revisionParent = join(inbound, "revisions");
  if (options.symlinkRevisionParent) {
    const external = mkdtempSync(join(tmpdir(), "stella-revisions-"));
    mkdirSync(join(external, revision));
    symlinkSync(external, revisionParent);
  } else {
    mkdirSync(join(revisionParent, revision), { recursive: true });
  }
  const root = join(revisionParent, revision);
  const identityPath = join(root, "identity.json");
  writeFileSync(identityPath, identityBytes);
  writeFileSync(join(root, "auxiliary.json"), auxiliaryBytes);
  writeFileSync(join(root, "manifest.json"), manifestBytes);
  const manifestChecksum = checksum(manifestBytes);
  const pointerPath = join(inbound, "active.json");
  writeJson(pointerPath, {
    status: "active",
    projectionRevision: revision,
    manifestChecksum,
  });
  return {
    config,
    pointerPath,
    identityPath,
    revision,
    manifestChecksum,
  };
}

function writeFormalIdentityProjection(
  status: "active" | "stale" | "blocked" | "revoked" = "active",
  options: { readonly materialIdentityUpdate?: boolean } = {},
) {
  const repository = createRepository({ projections: true });
  const config = runtimeConfig(repository);
  const inbound = join(repository, "stella", "projections", "fitness");
  const source = {
    revision: "authority-42",
    as_of: "2026-08-24T01:00:00.000Z",
  } as const;
  const identityBytes = canonicalizeJcs({
    schema_version: "stella.identity-context/v1",
    instance_id: "stella-primary",
    producer_id: "stella-runtime",
    consumer_id: "stella-fitness",
    source_revision: source.revision,
    as_of: source.as_of,
    categories: ["identity"],
    entries: [{
      id: "agent-name",
      category: "identity",
      content: "Stella",
      source_reference_ids: ["source-identity"],
    }, {
      id: "persona-core",
      category: "identity",
      content: "温和、直接",
      source_reference_ids: ["source-identity"],
    }],
  });
  const collections = {
    categories: ["identity"],
    source_references: [{
      id: "source-identity",
      path: "authority/identity.md",
      revision: source.revision,
      checksum: `sha256:${"d".repeat(64)}`,
    }],
    conflicts: [],
    retractions: [],
    capabilities: [{ id: "identity_context", state: "available" },
      ...(options.materialIdentityUpdate === true ? [{
        id: "material_identity_update",
        state: "available",
      } as const] : [])],
    payloads: [{
      path: "payloads/identity-context.json",
      media_type: "application/json",
      byte_length: identityBytes.byteLength,
      checksum: checksum(identityBytes),
    }],
  } as const;
  const revision = `projection-${sha256(canonicalizeJcs({
    schema_version: "stella.context-projection-revision-seed/v1",
    instance_id: "stella-primary",
    producer_id: "stella-runtime",
    consumer_id: "stella-fitness",
    source,
    ...collections,
  }))}`;
  const manifestBytes = canonicalizeJcs({
    schema_version: "stella.context-projection-manifest/v1",
    instance_id: "stella-primary",
    producer_id: "stella-runtime",
    consumer_id: "stella-fitness",
    projection_revision: revision,
    source,
    ...collections,
    generated_at: "2026-08-24T01:01:00.000Z",
  });
  const revisionRoot = join(inbound, "revisions", revision);
  mkdirSync(join(revisionRoot, "payloads"), { recursive: true });
  writeFileSync(join(revisionRoot, "payloads", "identity-context.json"), identityBytes);
  writeFileSync(join(revisionRoot, "manifest.json"), manifestBytes);
  const pointerPath = join(inbound, "active.json");
  const commonPointer = {
    schema_version: "stella.context-projection-pointer/v1",
    instance_id: "stella-primary",
    producer_id: "stella-runtime",
    consumer_id: "stella-fitness",
    pointer_revision: `pointer-${"a".repeat(64)}`,
    source_revision: source.revision,
    changed_at: "2026-08-24T01:01:00.000Z",
  } as const;
  writeJson(pointerPath, status === "active" ? {
    ...commonPointer,
    status,
    projection_revision: revision,
    manifest_checksum: checksum(manifestBytes),
    as_of: source.as_of,
  } : status === "stale" ? {
    ...commonPointer,
    status,
    last_verified_revision: revision,
    manifest_checksum: checksum(manifestBytes),
    as_of: source.as_of,
    reason_codes: ["REFRESH_FAILED"],
  } : {
    ...commonPointer,
    status,
    reason_codes: [status === "blocked" ? "SOURCE_BLOCKED" : "AUTHORIZATION_REVOKED"],
  });
  return { config, revision, pointerPath };
}

function createRepository(options: {
  readonly projections: boolean;
  readonly outbound?: boolean;
}): string {
  const repository = mkdtempSync(join(tmpdir(), "stella-context-"));
  mkdirSync(join(repository, "stella", "fitness"), { recursive: true });
  if (options.projections) {
    mkdirSync(join(repository, "stella", "projections", "fitness"), {
      recursive: true,
    });
    if (options.outbound !== false) {
      mkdirSync(join(repository, "stella", "projections", "stella"), {
        recursive: true,
      });
    }
  }
  return realpathSync(repository);
}

function runtimeConfig(repository: string) {
  return {
    plugins: {
      entries: {
        "cognitive-runtime": {
          config: {
            runtime: { instance_id: "stella-primary" },
            stella: locator(repository),
          },
        },
      },
    },
  } as const;
}

function locator(repository: string) {
  return {
    schema_version: "stella.personal-data-locator/v1",
    instance_id: "stella-primary",
    personal_data_repository: repository,
  } as const;
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, canonicalizeJcs(value));
}

function parseJson(bytes: Buffer): Record<string, unknown> {
  return JSON.parse(bytes.toString("utf8")) as Record<string, unknown>;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function checksum(bytes: Uint8Array): string {
  return `sha256:${sha256(bytes)}`;
}
