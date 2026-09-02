import { createHash } from "node:crypto";
import {
  accessSync,
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  readdirSync,
} from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";

const LOCATOR_SCHEMA = "stella.personal-data-locator/v1";
const INSTANCE_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/u;
const CHECKSUM_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const PROJECTION_REVISION_PATTERN = /^projection-[a-f0-9]{64}$/u;

export type FitnessContextContractErrorCode =
  | "LOCATOR_REQUIRED"
  | "LOCATOR_SCHEMA_UNSUPPORTED"
  | "LOCATOR_UNKNOWN_FIELD"
  | "LOCATOR_INSTANCE_INVALID"
  | "LOCATOR_INSTANCE_MISMATCH"
  | "LOCATOR_REPOSITORY_NOT_ABSOLUTE"
  | "LOCATOR_REPOSITORY_UNAVAILABLE"
  | "LOCATOR_REPOSITORY_NOT_DIRECTORY"
  | "LOCATOR_PERMISSION_DENIED"
  | "LOCATOR_SYMLINK_FORBIDDEN"
  | "LOCATOR_PATH_ESCAPE"
  | "PERSONAL_DATA_REPOSITORY_UNINITIALIZED"
  | "PERSONAL_DATA_REPOSITORY_INVALID"
  | "PERSONAL_DATA_REPOSITORY_INSTANCE_MISMATCH"
  | "PERSONAL_DATA_REPOSITORY_PERMISSION_DENIED"
  | "JCS_VALUE_INVALID"
  | "CONTRACT_INCOMPATIBLE"
  | "PROJECTION_FILE_INVALID"
  | "PROJECTION_OVERSIZE"
  | "CHECKSUM_MISMATCH"
  | "PROJECTION_TOCTOU";

export class FitnessContextContractError extends Error {
  readonly code: FitnessContextContractErrorCode;

  constructor(code: FitnessContextContractErrorCode) {
    super(`Stella Fitness context contract rejected: ${code}`);
    this.name = "FitnessContextContractError";
    this.code = code;
  }
}

export type StellaPersonalDataPaths = {
  readonly instanceId: string;
  readonly repository: string;
  readonly stellaRoot: string;
  readonly fitnessData: string;
  readonly runtimeToFitness: string;
  readonly fitnessToRuntime: string;
};

export type PersonalDataRepositoryInitialization = {
  readonly schemaVersion: "stella.personal-data-repository/v1";
  readonly instanceId: string;
  readonly layoutVersion: "stella.personal-data-layout/v1";
  readonly initializedAt: string;
};

export type RuntimeProjectionBinding = {
  readonly instanceId: string;
  readonly producerId: "stella-runtime";
  readonly consumerId: "stella-fitness";
};

export type RuntimeProjectionPointer =
  | { readonly status: "blocked" | "revoked" }
  | {
      readonly status: "active" | "stale";
      readonly projectionRevision: string;
      readonly manifestChecksum: string;
      readonly sourceRevision?: string;
      readonly asOf?: string;
    };

export type RuntimeProjectionManifest = {
  readonly sourceRevision: string;
  readonly asOf: string;
  readonly identityContextPath?: string;
  readonly identityContextCandidatePaths?: readonly string[];
  readonly categories?: readonly ("background" | "identity")[];
  readonly sourceReferenceIds?: readonly string[];
  readonly materialIdentityUpdate?: boolean;
  readonly conflicts?: readonly {
    readonly id: string;
    readonly sourceReferenceIds: readonly string[];
    readonly summary: string;
  }[];
  readonly retractions?: readonly {
    readonly id: string;
    readonly sourceReferenceId: string;
    readonly retractedRevision: string;
  }[];
  readonly declaredFiles: readonly {
    readonly relativePath: string;
    readonly checksum: string;
    readonly byteLength: number;
  }[];
};

export type RuntimeProjectionContract<IdentityContext> = {
  /** Runtime-published contract identity; also scopes last-verified fallback. */
  readonly contractId: string;
  readonly limits: {
    readonly pointerBytes: number;
    readonly manifestBytes: number;
    readonly payloadBytes: number;
    readonly payloadFiles: number;
  };
  parsePointer(
    bytes: Buffer,
    binding: RuntimeProjectionBinding,
  ): RuntimeProjectionPointer;
  parseManifest(
    bytes: Buffer,
    binding: RuntimeProjectionBinding,
    pointer: Extract<RuntimeProjectionPointer, { readonly status: "active" | "stale" }>,
  ): RuntimeProjectionManifest;
  parseIdentityContext(
    bytes: Buffer,
    binding: RuntimeProjectionBinding,
    manifest: RuntimeProjectionManifest,
  ): IdentityContext | undefined;
};

export type RuntimeIdentityContextResult<IdentityContext> =
  | { readonly status: "blocked" | "revoked" }
  | {
      readonly status: "active" | "stale";
      readonly projectionRevision: string;
      readonly sourceRevision: string;
      readonly asOf: string;
      readonly manifestChecksum: string;
      readonly identityContext: IdentityContext;
      readonly materialIdentityUpdate?: boolean;
      readonly conflicts?: NonNullable<RuntimeProjectionManifest["conflicts"]>;
      readonly retractions?: NonNullable<RuntimeProjectionManifest["retractions"]>;
    };

export type ResilientRuntimeIdentityContextResult<IdentityContext> =
  | RuntimeIdentityContextResult<IdentityContext>
  | {
      readonly status: "degraded";
      readonly reason: "contract-unavailable" | "contract-incompatible";
    };

type VerifiedContext<IdentityContext> = Extract<
  RuntimeIdentityContextResult<IdentityContext>,
  { readonly status: "active" | "stale" }
>;

/**
 * Resolves canonical Fitness data only. Projection capability is intentionally
 * validated separately so missing derived context cannot block recording.
 */
export function resolveStellaPersonalDataPaths(
  openclawConfig: unknown,
): StellaPersonalDataPaths {
  const root = asRecord(openclawConfig);
  const entries = asRecord(asRecord(root?.plugins)?.entries);
  const runtimeConfig = asRecord(asRecord(entries?.["cognitive-runtime"])?.config);
  const runtime = asRecord(runtimeConfig?.runtime);
  const locator = asRecord(runtimeConfig?.stella);
  if (locator === undefined) throw contractError("LOCATOR_REQUIRED");
  assertExactFields(locator, [
    "schema_version",
    "instance_id",
    "personal_data_repository",
  ]);
  if (locator.schema_version !== LOCATOR_SCHEMA) {
    throw contractError("LOCATOR_SCHEMA_UNSUPPORTED");
  }
  const instanceId = locator.instance_id;
  if (typeof instanceId !== "string" || !INSTANCE_ID_PATTERN.test(instanceId)) {
    throw contractError("LOCATOR_INSTANCE_INVALID");
  }
  if (runtime?.instance_id !== instanceId) {
    throw contractError("LOCATOR_INSTANCE_MISMATCH");
  }
  const candidate = locator.personal_data_repository;
  if (typeof candidate !== "string" || !isAbsolute(candidate)) {
    throw contractError("LOCATOR_REPOSITORY_NOT_ABSOLUTE");
  }
  const repository = validateDirectory(candidate, constants.R_OK | constants.X_OK);
  const stellaRoot = validateChild(
    repository,
    constants.R_OK | constants.X_OK,
    "stella",
  );
  const fitnessData = validateChild(
    repository,
    constants.R_OK | constants.W_OK | constants.X_OK,
    "stella",
    "fitness",
  );
  return {
    instanceId,
    repository,
    stellaRoot,
    fitnessData,
    runtimeToFitness: join(repository, "stella", "projections", "fitness"),
    fitnessToRuntime: join(repository, "stella", "projections", "stella"),
  };
}

export function readPersonalDataRepositoryInitialization(
  paths: StellaPersonalDataPaths,
): PersonalDataRepositoryInitialization {
  const manifestPath = join(paths.stellaRoot, "repository.json");
  let metadata;
  try {
    metadata = lstatSync(manifestPath);
  } catch (error) {
    if (errorCode(error) === "ENOENT") {
      throw contractError("PERSONAL_DATA_REPOSITORY_UNINITIALIZED");
    }
    if (isPermissionError(error)) {
      throw contractError("PERSONAL_DATA_REPOSITORY_PERMISSION_DENIED");
    }
    throw contractError("PERSONAL_DATA_REPOSITORY_INVALID");
  }
  if (
    metadata.isSymbolicLink() ||
    !metadata.isFile() ||
    metadata.nlink !== 1 ||
    (metadata.mode & 0o077) !== 0 ||
    (process.getuid?.() !== undefined && metadata.uid !== process.getuid?.())
  ) {
    throw contractError("PERSONAL_DATA_REPOSITORY_INVALID");
  }
  let descriptor: number | undefined;
  let bytes: Buffer;
  try {
    descriptor = openSync(manifestPath, "r");
    const opened = fstatSync(descriptor);
    if (
      !opened.isFile() ||
      opened.nlink !== 1 ||
      opened.dev !== metadata.dev ||
      opened.ino !== metadata.ino ||
      opened.size !== metadata.size
    ) {
      throw contractError("PERSONAL_DATA_REPOSITORY_INVALID");
    }
    bytes = readFileSync(descriptor);
  } catch (error) {
    if (error instanceof FitnessContextContractError) throw error;
    if (isPermissionError(error)) {
      throw contractError("PERSONAL_DATA_REPOSITORY_PERMISSION_DENIED");
    }
    throw contractError("PERSONAL_DATA_REPOSITORY_INVALID");
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
  if (bytes.byteLength < 2 || bytes.byteLength > 4096) {
    throw contractError("PERSONAL_DATA_REPOSITORY_INVALID");
  }
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw contractError("PERSONAL_DATA_REPOSITORY_INVALID");
  }
  const record = asRecord(value);
  if (
    record === undefined ||
    Object.keys(record).sort().join(",") !==
      ["initialized_at", "instance_id", "layout_version", "schema_version"].join(",") ||
    record.schema_version !== "stella.personal-data-repository/v1" ||
    record.layout_version !== "stella.personal-data-layout/v1" ||
    typeof record.instance_id !== "string" ||
    !INSTANCE_ID_PATTERN.test(record.instance_id) ||
    typeof record.initialized_at !== "string" ||
    !Number.isFinite(Date.parse(record.initialized_at)) ||
    new Date(record.initialized_at).toISOString() !== record.initialized_at ||
    !canonicalizeJcs(record).equals(bytes.subarray(0, bytes.at(-1) === 0x0a ? -1 : undefined))
  ) {
    throw contractError("PERSONAL_DATA_REPOSITORY_INVALID");
  }
  if (record.instance_id !== paths.instanceId) {
    throw contractError("PERSONAL_DATA_REPOSITORY_INSTANCE_MISMATCH");
  }
  return {
    schemaVersion: record.schema_version,
    instanceId: record.instance_id,
    layoutVersion: record.layout_version,
    initializedAt: record.initialized_at,
  };
}

export function validateRuntimeProjectionPaths(
  paths: StellaPersonalDataPaths,
): void {
  validateRuntimeProjectionReadPath(paths);
  validateChild(
    paths.repository,
    constants.R_OK | constants.W_OK | constants.X_OK,
    "stella",
    "projections",
    "stella",
  );
}

function validateRuntimeProjectionReadPath(
  paths: StellaPersonalDataPaths,
): void {
  validateChild(
    paths.repository,
    constants.R_OK | constants.X_OK,
    "stella",
    "projections",
  );
  validateChild(
    paths.repository,
    constants.R_OK | constants.X_OK,
    "stella",
    "projections",
    "fitness",
  );
}

/**
 * Experimental filesystem seam. Runtime #38 must provide the adapter and its
 * direct fixtures before this represents formal contract acceptance.
 */
export function consumeRuntimeIdentityContext<IdentityContext>(
  openclawConfig: unknown,
  contract: RuntimeProjectionContract<IdentityContext>,
  options: {
    readonly maxAttempts?: number;
    readonly readFile?: (path: string) => Buffer;
  } = {},
): RuntimeIdentityContextResult<IdentityContext> {
  const paths = resolveStellaPersonalDataPaths(openclawConfig);
  validateRuntimeProjectionReadPath(paths);
  validateLimits(contract.limits);
  const binding = projectionBinding(paths.instanceId);
  const pointerPath = join(paths.runtimeToFitness, "active.json");
  const readFile = options.readFile ?? ((path: string) => readFileSync(path));
  const maxAttempts = options.maxAttempts ?? 3;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 10) {
    throw contractError("PROJECTION_FILE_INVALID");
  }
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const before = readSafeFile(
      pointerPath,
      paths.runtimeToFitness,
      contract.limits.pointerBytes,
      readFile,
    );
    const pointer = contract.parsePointer(before, binding);
    if (!("projectionRevision" in pointer)) {
      return { status: pointer.status };
    }
    validatePointer(pointer);
    const result = consumeRevision(paths, pointer, binding, contract, readFile);
    const after = readSafeFile(
      pointerPath,
      paths.runtimeToFitness,
      contract.limits.pointerBytes,
      readFile,
    );
    if (before.equals(after)) return result;
  }
  throw contractError("PROJECTION_TOCTOU");
}

export function createRuntimeIdentityContextConsumer<IdentityContext>(options: {
  readonly contract?: RuntimeProjectionContract<IdentityContext>;
  readonly lastVerified?: {
    readonly sourceKey: string;
    readonly value: VerifiedContext<IdentityContext>;
  };
} = {}): {
  consume(openclawConfig: unknown): ResilientRuntimeIdentityContextResult<IdentityContext>;
} {
  let lastVerified = options.lastVerified;
  return {
    consume(openclawConfig) {
      const paths = resolveStellaPersonalDataPaths(openclawConfig);
      if (options.contract === undefined) {
        return { status: "degraded", reason: "contract-unavailable" };
      }
      const sourceKey = projectionSourceKey(paths, options.contract.contractId);
      try {
        const result = consumeRuntimeIdentityContext(openclawConfig, options.contract);
        if (result.status === "active" || result.status === "stale") {
          lastVerified = { sourceKey, value: result };
        }
        return result;
      } catch (error) {
        if (!isContractIncompatible(error)) throw error;
        return lastVerified?.sourceKey === sourceKey
          ? { ...lastVerified.value, status: "stale" }
          : { status: "degraded", reason: "contract-incompatible" };
      }
    },
  };
}

export function canonicalizeJcs(value: unknown): Buffer {
  const chunks: string[] = [];
  serializeJcs(value, chunks);
  return Buffer.from(chunks.join(""), "utf8");
}

export function canonicalTextBytes(value: string): Buffer {
  const normalized = value
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .normalize("NFC")
    .replaceAll(/\n+$/gu, "");
  assertValidUnicode(normalized);
  return Buffer.from(`${normalized}\n`, "utf8");
}

function consumeRevision<IdentityContext>(
  paths: StellaPersonalDataPaths,
  pointer: Extract<RuntimeProjectionPointer, { readonly status: "active" | "stale" }>,
  binding: RuntimeProjectionBinding,
  contract: RuntimeProjectionContract<IdentityContext>,
  readFile: (path: string) => Buffer,
): VerifiedContext<IdentityContext> {
  const root = join(paths.runtimeToFitness, "revisions", pointer.projectionRevision);
  validateProjectionDirectory(root, paths.runtimeToFitness);
  const manifestBytes = readSafeFile(
    join(root, "manifest.json"),
    root,
    contract.limits.manifestBytes,
    readFile,
  );
  if (checksum(manifestBytes) !== pointer.manifestChecksum) {
    throw contractError("CHECKSUM_MISMATCH");
  }
  const manifest = contract.parseManifest(manifestBytes, binding, pointer);
  if (
    manifest.sourceRevision.length === 0 ||
    manifest.asOf.length === 0 ||
    manifest.declaredFiles.length < 1 ||
    manifest.declaredFiles.length > contract.limits.payloadFiles
  ) {
    throw contractError("PROJECTION_FILE_INVALID");
  }
  const declared = new Set<string>(["manifest.json"]);
  const identityCandidates = new Set(
    manifest.identityContextCandidatePaths ??
      (manifest.identityContextPath === undefined ? [] : [manifest.identityContextPath]),
  );
  if (identityCandidates.size < 1) throw contractError("PROJECTION_FILE_INVALID");
  let identityContext: IdentityContext | undefined;
  for (const payload of manifest.declaredFiles) {
    validatePayload(payload, contract.limits.payloadBytes);
    if (declared.has(payload.relativePath)) {
      throw contractError("PROJECTION_FILE_INVALID");
    }
    declared.add(payload.relativePath);
    const bytes = readSafeFile(
      join(root, payload.relativePath),
      root,
      Math.min(payload.byteLength, contract.limits.payloadBytes),
      readFile,
    );
    if (bytes.byteLength !== payload.byteLength || checksum(bytes) !== payload.checksum) {
      throw contractError("CHECKSUM_MISMATCH");
    }
    if (identityCandidates.has(payload.relativePath)) {
      const parsed = contract.parseIdentityContext(bytes, binding, manifest);
      if (parsed !== undefined) {
        if (identityContext !== undefined) throw contractError("PROJECTION_FILE_INVALID");
        identityContext = parsed;
      }
    }
  }
  if ([...identityCandidates].some((path) => !declared.has(path))) {
    throw contractError("PROJECTION_FILE_INVALID");
  }
  if (identityContext === undefined) throw contractError("PROJECTION_FILE_INVALID");
  assertNoUndeclaredFiles(root, declared);
  return {
    status: pointer.status,
    projectionRevision: pointer.projectionRevision,
    sourceRevision: manifest.sourceRevision,
    asOf: manifest.asOf,
    manifestChecksum: pointer.manifestChecksum,
    identityContext,
    ...(manifest.conflicts === undefined ? {} : { conflicts: manifest.conflicts }),
    ...(manifest.retractions === undefined ? {} : { retractions: manifest.retractions }),
    ...(manifest.materialIdentityUpdate === undefined
      ? {}
      : { materialIdentityUpdate: manifest.materialIdentityUpdate }),
  };
}

function validatePointer(
  pointer: Extract<RuntimeProjectionPointer, { readonly status: "active" | "stale" }>,
): void {
  if (
    !PROJECTION_REVISION_PATTERN.test(pointer.projectionRevision) ||
    !CHECKSUM_PATTERN.test(pointer.manifestChecksum)
  ) {
    throw contractError("PROJECTION_FILE_INVALID");
  }
}

function validatePayload(
  payload: RuntimeProjectionManifest["declaredFiles"][number],
  maximumBytes: number,
): void {
  if (
    !isSafeRelativeFile(payload.relativePath) ||
    !CHECKSUM_PATTERN.test(payload.checksum) ||
    !Number.isSafeInteger(payload.byteLength) ||
    payload.byteLength < 1
  ) {
    throw contractError("PROJECTION_FILE_INVALID");
  }
  if (payload.byteLength > maximumBytes) throw contractError("PROJECTION_OVERSIZE");
}

function validateLimits(limits: RuntimeProjectionContract<unknown>["limits"]): void {
  if (Object.values(limits).some((value) => !Number.isSafeInteger(value) || value < 1)) {
    throw contractError("PROJECTION_FILE_INVALID");
  }
}

function validateDirectory(candidate: string, mode: number): string {
  try {
    const metadata = lstatSync(candidate);
    if (metadata.isSymbolicLink()) throw contractError("LOCATOR_SYMLINK_FORBIDDEN");
    if (!metadata.isDirectory()) throw contractError("LOCATOR_REPOSITORY_NOT_DIRECTORY");
    accessSync(candidate, mode);
    return realpathSync(candidate);
  } catch (error) {
    if (error instanceof FitnessContextContractError) throw error;
    if (isPermissionError(error)) throw contractError("LOCATOR_PERMISSION_DENIED");
    throw contractError("LOCATOR_REPOSITORY_UNAVAILABLE");
  }
}

function validateChild(repository: string, mode: number, ...segments: string[]): string {
  let candidate = repository;
  try {
    for (const segment of segments) {
      candidate = join(candidate, segment);
      const metadata = lstatSync(candidate);
      if (metadata.isSymbolicLink()) throw contractError("LOCATOR_SYMLINK_FORBIDDEN");
      if (!metadata.isDirectory()) throw contractError("LOCATOR_REPOSITORY_NOT_DIRECTORY");
    }
    accessSync(candidate, mode);
    const canonical = realpathSync(candidate);
    if (!isStrictChild(repository, canonical)) throw contractError("LOCATOR_PATH_ESCAPE");
    return canonical;
  } catch (error) {
    if (error instanceof FitnessContextContractError) throw error;
    if (isPermissionError(error)) throw contractError("LOCATOR_PERMISSION_DENIED");
    throw contractError("LOCATOR_REPOSITORY_UNAVAILABLE");
  }
}

function validateProjectionDirectory(candidate: string, root: string): void {
  const child = relative(root, candidate);
  if (!isSafeRelativeFile(child)) throw contractError("PROJECTION_FILE_INVALID");
  validateParents(root, `${child}${sep}placeholder`);
  try {
    if (!isStrictChild(root, realpathSync(candidate))) {
      throw contractError("PROJECTION_FILE_INVALID");
    }
  } catch (error) {
    if (error instanceof FitnessContextContractError) throw error;
    throw contractError("PROJECTION_FILE_INVALID");
  }
}

function readSafeFile(
  path: string,
  root: string,
  maximumBytes: number,
  readFile: (path: string) => Buffer,
): Buffer {
  const child = relative(root, path);
  if (!isSafeRelativeFile(child)) throw contractError("PROJECTION_FILE_INVALID");
  validateParents(root, child);
  try {
    const metadata = lstatSync(path);
    if (metadata.isSymbolicLink() || !metadata.isFile() || metadata.nlink !== 1) {
      throw contractError("PROJECTION_FILE_INVALID");
    }
    if (metadata.size < 1 || metadata.size > maximumBytes) {
      throw contractError("PROJECTION_OVERSIZE");
    }
    if (!isStrictChild(root, realpathSync(path))) {
      throw contractError("PROJECTION_FILE_INVALID");
    }
    const bytes = readFile(path);
    if (!Buffer.isBuffer(bytes) || bytes.byteLength < 1 || bytes.byteLength > maximumBytes) {
      throw contractError("PROJECTION_OVERSIZE");
    }
    return bytes;
  } catch (error) {
    if (error instanceof FitnessContextContractError) throw error;
    throw contractError("PROJECTION_FILE_INVALID");
  }
}

function validateParents(root: string, child: string): void {
  let current = root;
  try {
    for (const segment of child.split(sep).slice(0, -1)) {
      current = join(current, segment);
      const metadata = lstatSync(current);
      if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
        throw contractError("PROJECTION_FILE_INVALID");
      }
    }
  } catch (error) {
    if (error instanceof FitnessContextContractError) throw error;
    throw contractError("PROJECTION_FILE_INVALID");
  }
}

function assertNoUndeclaredFiles(root: string, declared: ReadonlySet<string>): void {
  const allowedDirectories = new Set<string>();
  for (const path of declared) {
    const segments = path.split(sep);
    for (let index = 1; index < segments.length; index += 1) {
      allowedDirectories.add(segments.slice(0, index).join(sep));
    }
  }
  const pending = [{ absolute: root, relative: "" }];
  const found = new Set<string>();
  try {
    while (pending.length > 0) {
      const current = pending.pop()!;
      for (const entry of readdirSync(current.absolute, { withFileTypes: true })) {
        const relativePath = current.relative.length === 0
          ? entry.name
          : join(current.relative, entry.name);
        if (entry.isSymbolicLink()) throw contractError("PROJECTION_FILE_INVALID");
        if (entry.isDirectory()) {
          if (!allowedDirectories.has(relativePath)) {
            throw contractError("PROJECTION_FILE_INVALID");
          }
          pending.push({
            absolute: join(current.absolute, entry.name),
            relative: relativePath,
          });
        } else if (entry.isFile()) {
          found.add(relativePath);
        } else {
          throw contractError("PROJECTION_FILE_INVALID");
        }
      }
    }
    if (
      found.size !== declared.size ||
      [...found].some((path) => !declared.has(path))
    ) {
      throw contractError("PROJECTION_FILE_INVALID");
    }
  } catch (error) {
    if (error instanceof FitnessContextContractError) throw error;
    throw contractError("PROJECTION_FILE_INVALID");
  }
}

function projectionBinding(instanceId: string): RuntimeProjectionBinding {
  return {
    instanceId,
    producerId: "stella-runtime",
    consumerId: "stella-fitness",
  };
}

function projectionSourceKey(paths: StellaPersonalDataPaths, contractId: string): string {
  return sha256(Buffer.from(
    `${paths.instanceId}\0${paths.repository}\0${contractId}`,
    "utf8",
  ));
}

function isContractIncompatible(error: unknown): boolean {
  return error instanceof FitnessContextContractError &&
    error.code === "CONTRACT_INCOMPATIBLE";
}

function serializeJcs(value: unknown, chunks: string[]): void {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    if (typeof value === "string") assertValidUnicode(value);
    chunks.push(JSON.stringify(value));
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw contractError("JCS_VALUE_INVALID");
    chunks.push(JSON.stringify(value));
    return;
  }
  if (Array.isArray(value)) {
    if (Object.keys(value).some((key) => !/^(?:0|[1-9]\d*)$/u.test(key))) {
      throw contractError("JCS_VALUE_INVALID");
    }
    chunks.push("[");
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.hasOwn(value, index)) throw contractError("JCS_VALUE_INVALID");
      if (index > 0) chunks.push(",");
      serializeJcs(value[index], chunks);
    }
    chunks.push("]");
    return;
  }
  if (isPlainRecord(value)) {
    chunks.push("{");
    const keys = Object.keys(value).sort();
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index]!;
      assertValidUnicode(key);
      if (index > 0) chunks.push(",");
      chunks.push(JSON.stringify(key), ":");
      serializeJcs(value[key], chunks);
    }
    chunks.push("}");
    return;
  }
  throw contractError("JCS_VALUE_INVALID");
}

function assertValidUnicode(value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const trailing = value.charCodeAt(index + 1);
      if (trailing < 0xdc00 || trailing > 0xdfff) {
        throw contractError("JCS_VALUE_INVALID");
      }
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      throw contractError("JCS_VALUE_INVALID");
    }
  }
}

function assertExactFields(
  value: Readonly<Record<string, unknown>>,
  fields: readonly string[],
): void {
  if (
    Object.keys(value).length !== fields.length ||
    fields.some((field) => !Object.hasOwn(value, field))
  ) {
    throw contractError("LOCATOR_UNKNOWN_FIELD");
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return isPlainRecord(value) ? value : undefined;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

function isSafeRelativeFile(path: string): boolean {
  return path.length > 0 &&
    !isAbsolute(path) &&
    path !== ".." &&
    !path.startsWith(`..${sep}`) &&
    !path.endsWith(sep);
}

function isStrictChild(root: string, candidate: string): boolean {
  const child = relative(root, candidate);
  return isSafeRelativeFile(child);
}

function isPermissionError(error: unknown): boolean {
  const code = errorCode(error);
  return code === "EACCES" || code === "EPERM";
}

function errorCode(error: unknown): unknown {
  return typeof error === "object" && error !== null && "code" in error
    ? error.code
    : undefined;
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function checksum(value: Uint8Array): string {
  return `sha256:${sha256(value)}`;
}

function contractError(
  code: FitnessContextContractErrorCode,
): FitnessContextContractError {
  return new FitnessContextContractError(code);
}
