import { createHash, randomUUID } from "node:crypto";
import {
  cp,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

import { findMarkedArtifactPaths } from "./ownership.js";

const OWNERSHIP_FILE = ".stella-fitness-ownership.json";
const OWNERSHIP_SCHEMA = "stella-fitness/workspace-ownership/v1";

export type FitnessAgentWorkspaceHost = {
  preflight?: () =>
    | { readonly ready: true }
    | { readonly ready: false; readonly reasonCode: string };
  discoverAgent?: (
    agentId: string,
  ) => { readonly exists: boolean; readonly workspace: string };
  prepareWorkspace?: (workspace: string) => Promise<void>;
  activateAgent?: (agentId: string, workspace: string) => Promise<void>;
  retainAgent?: (agentId: string, workspace: string) => Promise<void>;
};

export type ManagedAgentArtifactInput = {
  readonly path: string;
  readonly managedContent: string;
};

export type FitnessAgentWorkspaceAdoptionChoice =
  | "merge"
  | "skip"
  | { readonly alternateAgentId: string };

export type FitnessAgentWorkspaceAdoptionRecord = {
  readonly agentId: string;
  readonly choice: FitnessAgentWorkspaceAdoptionChoice;
  readonly result: FitnessAgentWorkspaceResult;
};

export type FitnessAgentWorkspaceResult = {
  readonly status:
    | "ready"
    | "standalone-degraded"
    | "blocked"
    | "adoption-required"
    | "conflicted";
  readonly agentId: string;
  readonly workspace?: string;
  readonly created?: boolean;
  readonly ownershipRevision?: number;
  readonly reasonCode?: string;
  readonly adopted?: boolean;
  readonly skipped?: boolean;
};

type OwnershipArtifact = {
  readonly path: string;
  readonly checksum: string;
};

type OwnershipManifest = {
  readonly schemaVersion: typeof OWNERSHIP_SCHEMA;
  readonly agentId: string;
  readonly ownershipRevision: number;
  readonly artifacts: readonly OwnershipArtifact[];
};

export type FitnessAgentWorkspaceManager = {
  initialize(input: {
    readonly agentId: string;
    readonly artifacts: readonly ManagedAgentArtifactInput[];
  }): Promise<FitnessAgentWorkspaceResult>;
  adopt(input: {
    readonly agentId: string;
    readonly artifacts: readonly ManagedAgentArtifactInput[];
    readonly choice: FitnessAgentWorkspaceAdoptionChoice;
  }): Promise<FitnessAgentWorkspaceResult>;
  sync(input: {
    readonly agentId: string;
    readonly artifacts: readonly ManagedAgentArtifactInput[];
  }): Promise<FitnessAgentWorkspaceResult>;
  transitionToStandaloneDegraded(input: {
    readonly agentId: string;
    readonly asOf: string;
  }): Promise<FitnessAgentWorkspaceResult>;
  adoptionRecord(
    agentId: string,
  ): Promise<FitnessAgentWorkspaceAdoptionRecord | undefined>;
  captureRecoveryToken(agentId: string): Promise<string | undefined>;
  restoreRecoveryToken(
    recoveryToken: string,
  ): Promise<FitnessAgentWorkspaceResult>;
};

type FitnessAgentWorkspaceManagerOptions = {
  readonly runtimeDirectory: string;
  readonly host: FitnessAgentWorkspaceHost;
  readonly copyWorkspace?: (source: string, destination: string) => Promise<void>;
};

export function createFitnessAgentWorkspaceManager(
  options: FitnessAgentWorkspaceManagerOptions,
): FitnessAgentWorkspaceManager {
  return {
    initialize: (input) => withAgentLock(
      options.runtimeDirectory,
      input.agentId,
      () => initializeWorkspace(options, input),
    ),
    adopt: (input) => withAgentLocks(
      options.runtimeDirectory,
      [
        input.agentId,
        ...(typeof input.choice === "object"
          ? [input.choice.alternateAgentId]
          : []),
      ],
      () => adoptWorkspace(options, input),
    ),
    sync: (input) => withAgentLock(
      options.runtimeDirectory,
      input.agentId,
      () => syncWorkspace(options, input),
    ),
    transitionToStandaloneDegraded: (input) => withAgentLock(
      options.runtimeDirectory,
      input.agentId,
      () => transitionToStandaloneDegraded(options, input),
    ),
    adoptionRecord: (agentId) => readAdoptionRecord(
      options.runtimeDirectory,
      validateAgentId(agentId),
    ),
    captureRecoveryToken: (agentId) => captureRecoveryToken(options, agentId),
    restoreRecoveryToken: (recoveryToken) => restoreRecoveryToken(
      options,
      recoveryToken,
    ),
  };
}

async function transitionToStandaloneDegraded(
  options: FitnessAgentWorkspaceManagerOptions,
  input: { readonly agentId: string; readonly asOf: string },
): Promise<FitnessAgentWorkspaceResult> {
  const agentId = validateAgentId(input.agentId);
  const asOf = validateAsOf(input.asOf);
  const preflight = retentionCapabilityPreflight(options.host);
  if (!preflight.ready) {
    return { status: "blocked", agentId, reasonCode: preflight.reasonCode };
  }
  const discovered = options.host.discoverAgent!(agentId);
  if (!discovered.exists) {
    return {
      status: "conflicted",
      agentId,
      reasonCode: "MANAGED_WORKSPACE_REQUIRED",
    };
  }
  const ownership = await inspectOwnership(discovered.workspace, agentId);
  if (ownership.status !== "valid") {
    return {
      status: "conflicted",
      agentId,
      workspace: discovered.workspace,
      reasonCode: ownership.status === "missing"
        ? "OWNERSHIP_MANIFEST_MISSING"
        : ownership.reasonCode,
    };
  }
  if (!await hasCompleteIdentityCore(discovered.workspace)) {
    return {
      status: "conflicted",
      agentId,
      workspace: discovered.workspace,
      reasonCode: "IDENTITY_CORE_MISSING",
    };
  }
  const retainedArtifacts = await readManagedArtifacts(
    discovered.workspace,
    ownership.manifest,
  );
  const agentsIndex = retainedArtifacts.findIndex(({ path }) => path === "AGENTS.md");
  if (agentsIndex < 0) {
    return {
      status: "conflicted",
      agentId,
      workspace: discovered.workspace,
      reasonCode: "DOMAIN_BOUNDARY_MISSING",
    };
  }
  const agents = retainedArtifacts[agentsIndex]!;
  retainedArtifacts[agentsIndex] = {
    path: agents.path,
    managedContent: standaloneDegradedContent(agents.managedContent, asOf),
  };
  if (manifestMatchesArtifacts(ownership.manifest, retainedArtifacts)) {
    return {
      status: "standalone-degraded",
      agentId,
      workspace: discovered.workspace,
      created: false,
      ownershipRevision: ownership.manifest.ownershipRevision,
    };
  }

  const managedRoot = managedRootForWorkspace(discovered.workspace, agentId);
  const revisionsRoot = join(managedRoot, "revisions");
  await mkdir(revisionsRoot, { recursive: true, mode: 0o700 });
  const token = randomUUID();
  const candidate = join(managedRoot, `.candidate-${token}`);
  const revision = join(revisionsRoot, token);
  try {
    const sourceSnapshot = await copyStableWorkspace(
      options,
      discovered.workspace,
      candidate,
    );
    if (sourceSnapshot === undefined) {
      await rm(candidate, { recursive: true, force: true });
      return {
        status: "conflicted",
        agentId,
        workspace: discovered.workspace,
        reasonCode: "WORKSPACE_CHANGED_DURING_READ",
      };
    }
    const manifest = await writeManagedArtifacts(
      candidate,
      agentId,
      ownership.manifest.ownershipRevision + 1,
      retainedArtifacts,
    );
    const verified = await inspectOwnership(candidate, agentId);
    if (verified.status !== "valid" || !await hasCompleteIdentityCore(candidate)) {
      throw new Error("standalone candidate failed ownership validation");
    }
    await rename(candidate, revision);
    if (!await workspaceMatchesSnapshot(discovered.workspace, sourceSnapshot)) {
      await rm(revision, { recursive: true, force: true });
      return {
        status: "conflicted",
        agentId,
        workspace: discovered.workspace,
        reasonCode: "WORKSPACE_CHANGED_DURING_READ",
      };
    }
    await options.host.retainAgent!(agentId, revision);
    return {
      status: "standalone-degraded",
      agentId,
      workspace: revision,
      created: false,
      ownershipRevision: manifest.ownershipRevision,
    };
  } catch (error) {
    await rm(candidate, { recursive: true, force: true });
    throw error;
  }
}

async function captureRecoveryToken(
  options: FitnessAgentWorkspaceManagerOptions,
  rawAgentId: string,
): Promise<string | undefined> {
  const agentId = validateAgentId(rawAgentId);
  const preflight = capabilityPreflight(options.host);
  if (!preflight.ready) return undefined;
  const discovered = options.host.discoverAgent!(agentId);
  if (!discovered.exists) return undefined;
  const ownership = await inspectOwnership(discovered.workspace, agentId);
  if (ownership.status !== "valid" || !await hasCompleteIdentityCore(discovered.workspace)) {
    return undefined;
  }
  return JSON.stringify({
    schemaVersion: "stella-fitness/workspace-recovery/v1",
    agentId,
    workspace: resolve(discovered.workspace),
    ownershipRevision: ownership.manifest.ownershipRevision,
  });
}

async function restoreRecoveryToken(
  options: FitnessAgentWorkspaceManagerOptions,
  recoveryToken: string,
): Promise<FitnessAgentWorkspaceResult> {
  const token = parseRecoveryToken(recoveryToken);
  const preflight = capabilityPreflight(options.host);
  if (!preflight.ready) {
    return { status: "blocked", agentId: token.agentId, reasonCode: preflight.reasonCode };
  }
  const current = options.host.discoverAgent!(token.agentId);
  if (
    !current.exists ||
    managedRootForWorkspace(current.workspace, token.agentId) !==
      managedRootForWorkspace(token.workspace, token.agentId)
  ) {
    return {
      status: "conflicted",
      agentId: token.agentId,
      workspace: token.workspace,
      reasonCode: "RECOVERY_WORKSPACE_INVALID",
    };
  }
  const ownership = await inspectOwnership(token.workspace, token.agentId);
  if (
    ownership.status !== "valid" ||
    ownership.manifest.ownershipRevision !== token.ownershipRevision ||
    !await hasCompleteIdentityCore(token.workspace)
  ) {
    return {
      status: "conflicted",
      agentId: token.agentId,
      workspace: token.workspace,
      reasonCode: "RECOVERY_WORKSPACE_INVALID",
    };
  }
  await options.host.activateAgent!(token.agentId, token.workspace);
  return {
    status: "ready",
    agentId: token.agentId,
    workspace: token.workspace,
    created: false,
    ownershipRevision: token.ownershipRevision,
  };
}

function parseRecoveryToken(recoveryToken: string): {
  readonly agentId: string;
  readonly workspace: string;
  readonly ownershipRevision: number;
} {
  let value: unknown;
  try {
    value = JSON.parse(recoveryToken);
  } catch {
    throw new Error("WORKSPACE_RECOVERY_TOKEN_INVALID");
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("WORKSPACE_RECOVERY_TOKEN_INVALID");
  }
  const record = value as Readonly<Record<string, unknown>>;
  if (
    Object.keys(record).sort().join("\0") !== [
      "agentId",
      "ownershipRevision",
      "schemaVersion",
      "workspace",
    ].sort().join("\0") ||
    record.schemaVersion !== "stella-fitness/workspace-recovery/v1" ||
    typeof record.agentId !== "string" ||
    typeof record.workspace !== "string" ||
    !isAbsolute(record.workspace) ||
    !Number.isSafeInteger(record.ownershipRevision) ||
    (record.ownershipRevision as number) < 1
  ) throw new Error("WORKSPACE_RECOVERY_TOKEN_INVALID");
  return {
    agentId: validateAgentId(record.agentId),
    workspace: resolve(record.workspace),
    ownershipRevision: record.ownershipRevision as number,
  };
}

async function syncWorkspace(
  options: FitnessAgentWorkspaceManagerOptions,
  input: {
    readonly agentId: string;
    readonly artifacts: readonly ManagedAgentArtifactInput[];
  },
): Promise<FitnessAgentWorkspaceResult> {
  const agentId = validateAgentId(input.agentId);
  const preflight = capabilityPreflight(options.host);
  if (!preflight.ready) {
    return { status: "blocked", agentId, reasonCode: preflight.reasonCode };
  }
  const discovered = options.host.discoverAgent!(agentId);
  if (!discovered.exists) return initializeWorkspace(options, input);
  const ownership = await inspectOwnership(discovered.workspace, agentId);
  if (ownership.status === "missing") {
    return isManagedRevisionWorkspace(discovered.workspace)
      ? {
          status: "conflicted",
          agentId,
          workspace: discovered.workspace,
          reasonCode: "OWNERSHIP_MANIFEST_MISSING",
        }
      : {
          status: "adoption-required",
          agentId,
          workspace: discovered.workspace,
          reasonCode: "OWNERSHIP_MANIFEST_REQUIRED",
        };
  }
  if (ownership.status === "conflicted") {
    return {
      status: "conflicted",
      agentId,
      workspace: discovered.workspace,
      reasonCode: ownership.reasonCode,
    };
  }
  const artifacts = validateArtifacts(input.artifacts);
  if (!await hasCompleteIdentityCore(discovered.workspace)) {
    return {
      status: "conflicted",
      agentId,
      workspace: discovered.workspace,
      reasonCode: "IDENTITY_CORE_MISSING",
    };
  }
  if (!manifestArtifactsAreRetained(ownership.manifest, artifacts)) {
    return {
      status: "conflicted",
      agentId,
      workspace: discovered.workspace,
      reasonCode: "MANAGED_ARTIFACT_REMOVAL_REQUIRES_MIGRATION",
    };
  }
  if (manifestMatchesArtifacts(ownership.manifest, artifacts)) {
    return {
      status: "ready",
      agentId,
      workspace: discovered.workspace,
      created: false,
      ownershipRevision: ownership.manifest.ownershipRevision,
    };
  }

  const managedRoot = managedRootForWorkspace(discovered.workspace, agentId);
  const revisionsRoot = join(managedRoot, "revisions");
  await mkdir(revisionsRoot, { recursive: true, mode: 0o700 });
  const token = randomUUID();
  const candidate = join(managedRoot, `.candidate-${token}`);
  const revision = join(revisionsRoot, token);
  try {
    const sourceSnapshot = await copyStableWorkspace(
      options,
      discovered.workspace,
      candidate,
    );
    if (sourceSnapshot === undefined) {
      await rm(candidate, { recursive: true, force: true });
      return {
        status: "conflicted",
        agentId,
        workspace: discovered.workspace,
        reasonCode: "WORKSPACE_CHANGED_DURING_READ",
      };
    }
    const nextOwnershipRevision = ownership.manifest.ownershipRevision + 1;
    const manifest = await writeManagedArtifacts(
      candidate,
      agentId,
      nextOwnershipRevision,
      artifacts,
    );
    const verified = await inspectOwnership(candidate, agentId);
    if (verified.status !== "valid") {
      throw new Error("sync candidate failed ownership validation");
    }
    if (!await hasCompleteIdentityCore(candidate)) {
      throw new Error("sync candidate failed identity core validation");
    }
    await rename(candidate, revision);
    if (!await workspaceMatchesSnapshot(discovered.workspace, sourceSnapshot)) {
      await rm(revision, { recursive: true, force: true });
      return {
        status: "conflicted",
        agentId,
        workspace: discovered.workspace,
        reasonCode: "WORKSPACE_CHANGED_DURING_READ",
      };
    }
    await options.host.activateAgent!(agentId, revision);
    return {
      status: "ready",
      agentId,
      workspace: revision,
      created: false,
      ownershipRevision: manifest.ownershipRevision,
    };
  } catch (error) {
    await rm(candidate, { recursive: true, force: true });
    throw error;
  }
}

async function adoptWorkspace(
  options: FitnessAgentWorkspaceManagerOptions,
  input: {
    readonly agentId: string;
    readonly artifacts: readonly ManagedAgentArtifactInput[];
    readonly choice: FitnessAgentWorkspaceAdoptionChoice;
  },
): Promise<FitnessAgentWorkspaceResult> {
  const agentId = validateAgentId(input.agentId);
  const preflight = capabilityPreflight(options.host);
  if (!preflight.ready) {
    return { status: "blocked", agentId, reasonCode: preflight.reasonCode };
  }
  const recorded = await readAdoptionRecord(options.runtimeDirectory, agentId);
  if (
    recorded?.result.skipped === true &&
    adoptionChoicesEqual(recorded.choice, input.choice)
  ) return recorded.result;
  if (
    recorded?.result.status === "ready" &&
    adoptionChoicesEqual(recorded.choice, input.choice) &&
    recorded.result.workspace !== undefined
  ) {
    const resultAgent = options.host.discoverAgent!(recorded.result.agentId);
    if (
      resultAgent.exists &&
      resolve(resultAgent.workspace) === resolve(recorded.result.workspace)
    ) return recorded.result;
  }
  const discovered = options.host.discoverAgent!(agentId);
  if (!discovered.exists) return initializeWorkspace(options, input);
  const ownership = await inspectOwnership(discovered.workspace, agentId);
  if (ownership.status === "valid") {
    if (!await hasCompleteIdentityCore(discovered.workspace)) {
      return {
        status: "conflicted",
        agentId,
        workspace: discovered.workspace,
        reasonCode: "IDENTITY_CORE_MISSING",
      };
    }
    const result: FitnessAgentWorkspaceResult = {
      status: "ready",
      agentId,
      workspace: discovered.workspace,
      created: false,
      adopted: true,
      ownershipRevision: ownership.manifest.ownershipRevision,
    };
    await persistAdoptionResult(options.runtimeDirectory, agentId, input.choice, result);
    return result;
  }
  if (ownership.status === "conflicted") {
    return {
      status: "conflicted",
      agentId,
      workspace: discovered.workspace,
      reasonCode: ownership.reasonCode,
    };
  }
  if (typeof input.choice === "object") {
    const alternateAgentId = validateAgentId(input.choice.alternateAgentId);
    if (alternateAgentId === agentId) {
      throw new Error("Alternate Agent ID must differ from the existing Agent ID");
    }
    await persistAdoptionResult(
      options.runtimeDirectory,
      agentId,
      input.choice,
      adoptionInProgress(agentId, discovered.workspace),
    );
    const result = await initializeWorkspace(
      options,
      {
        agentId: alternateAgentId,
        artifacts: input.artifacts,
      },
      (plannedResult) => persistAdoptionResult(
        options.runtimeDirectory,
        agentId,
        input.choice,
        plannedResult,
      ),
    );
    await persistAdoptionResult(
      options.runtimeDirectory,
      agentId,
      input.choice,
      result,
    );
    return result;
  }
  if (input.choice === "skip") {
    const result: FitnessAgentWorkspaceResult = {
      status: "adoption-required",
      agentId,
      workspace: discovered.workspace,
      reasonCode: "ADOPTION_SKIPPED",
      skipped: true,
    };
    await persistAdoptionResult(options.runtimeDirectory, agentId, input.choice, result);
    return result;
  }

  const artifacts = validateArtifacts(input.artifacts);
  await persistAdoptionResult(
    options.runtimeDirectory,
    agentId,
    input.choice,
    adoptionInProgress(agentId, discovered.workspace),
  );
  const managedRoot = managedWorkspaceRoot(discovered.workspace, agentId);
  const revisionsRoot = join(managedRoot, "revisions");
  await mkdir(revisionsRoot, { recursive: true, mode: 0o700 });
  const token = randomUUID();
  const candidate = join(managedRoot, `.candidate-${token}`);
  const revision = join(revisionsRoot, token);
  try {
    const sourceSnapshot = await copyStableWorkspace(
      options,
      discovered.workspace,
      candidate,
    );
    if (sourceSnapshot === undefined) {
      await rm(candidate, { recursive: true, force: true });
      const result: FitnessAgentWorkspaceResult = {
        status: "conflicted",
        agentId,
        workspace: discovered.workspace,
        reasonCode: "WORKSPACE_CHANGED_DURING_READ",
      };
      await persistAdoptionResult(
        options.runtimeDirectory,
        agentId,
        input.choice,
        result,
      );
      return result;
    }
    const manifest = await writeManagedArtifacts(candidate, agentId, 1, artifacts);
    const verified = await inspectOwnership(candidate, agentId);
    if (verified.status !== "valid") {
      throw new Error("adoption candidate failed ownership validation");
    }
    if (!await hasCompleteIdentityCore(candidate)) {
      await rm(candidate, { recursive: true, force: true });
      const result: FitnessAgentWorkspaceResult = {
        status: "blocked",
        agentId,
        workspace: discovered.workspace,
        reasonCode: "IDENTITY_CORE_REQUIRED",
      };
      await persistAdoptionResult(
        options.runtimeDirectory,
        agentId,
        input.choice,
        result,
      );
      return result;
    }
    await rename(candidate, revision);
    const plannedResult: FitnessAgentWorkspaceResult = {
      status: "ready",
      agentId,
      workspace: revision,
      created: false,
      adopted: true,
      ownershipRevision: manifest.ownershipRevision,
    };
    await persistAdoptionResult(
      options.runtimeDirectory,
      agentId,
      input.choice,
      plannedResult,
    );
    if (!await workspaceMatchesSnapshot(discovered.workspace, sourceSnapshot)) {
      await rm(revision, { recursive: true, force: true });
      const result: FitnessAgentWorkspaceResult = {
        status: "conflicted",
        agentId,
        workspace: discovered.workspace,
        reasonCode: "WORKSPACE_CHANGED_DURING_READ",
      };
      await persistAdoptionResult(
        options.runtimeDirectory,
        agentId,
        input.choice,
        result,
      );
      return result;
    }
    await options.host.activateAgent!(agentId, revision);
    return plannedResult;
  } catch (error) {
    await rm(candidate, { recursive: true, force: true });
    throw error;
  }
}

async function initializeWorkspace(
  options: FitnessAgentWorkspaceManagerOptions,
  input: {
    readonly agentId: string;
    readonly artifacts: readonly ManagedAgentArtifactInput[];
  },
  beforeActivate?: (result: FitnessAgentWorkspaceResult) => Promise<void>,
): Promise<FitnessAgentWorkspaceResult> {
  const agentId = validateAgentId(input.agentId);
  const preflight = capabilityPreflight(options.host);
  if (!preflight.ready) {
    return {
      status: "blocked",
      agentId,
      reasonCode: preflight.reasonCode,
    };
  }
  const discoverAgent = options.host.discoverAgent!;
  const prepareWorkspace = options.host.prepareWorkspace!;
  const activateAgent = options.host.activateAgent!;
  const discovered = discoverAgent(agentId);
  if (discovered.exists) {
    const existing = await inspectOwnership(discovered.workspace, agentId);
    if (existing.status === "missing") {
      return isManagedRevisionWorkspace(discovered.workspace)
        ? {
            status: "conflicted",
            agentId,
            workspace: discovered.workspace,
            reasonCode: "OWNERSHIP_MANIFEST_MISSING",
          }
        : {
            status: "adoption-required",
            agentId,
            workspace: discovered.workspace,
            reasonCode: "OWNERSHIP_MANIFEST_REQUIRED",
          };
    }
    if (existing.status === "conflicted") {
      return {
        status: "conflicted",
        agentId,
        workspace: discovered.workspace,
        reasonCode: existing.reasonCode,
      };
    }
    if (!await hasCompleteIdentityCore(discovered.workspace)) {
      return {
        status: "conflicted",
        agentId,
        workspace: discovered.workspace,
        reasonCode: "IDENTITY_CORE_MISSING",
      };
    }
    return {
      status: "ready",
      agentId,
      workspace: discovered.workspace,
      created: false,
      ownershipRevision: existing.manifest.ownershipRevision,
    };
  }

  const artifacts = validateArtifacts(input.artifacts);
  const managedRoot = managedWorkspaceRoot(discovered.workspace, agentId);
  const revisionsRoot = join(managedRoot, "revisions");
  await mkdir(revisionsRoot, { recursive: true, mode: 0o700 });
  const token = randomUUID();
  const candidate = join(managedRoot, `.candidate-${token}`);
  const revision = join(revisionsRoot, token);
  try {
    await prepareWorkspace(candidate);
    const manifest = await writeManagedArtifacts(
      candidate,
      agentId,
      1,
      artifacts,
      false,
    );
    const verified = await inspectOwnership(candidate, agentId);
    if (verified.status !== "valid") {
      const reasonCode = verified.status === "conflicted"
        ? verified.reasonCode
        : "OWNERSHIP_MANIFEST_MISSING";
      throw new Error(`workspace candidate invalid: ${reasonCode}`);
    }
    if (!await hasCompleteIdentityCore(candidate)) {
      await rm(candidate, { recursive: true, force: true });
      return { status: "blocked", agentId, reasonCode: "IDENTITY_CORE_REQUIRED" };
    }
    await rename(candidate, revision);
    const result: FitnessAgentWorkspaceResult = {
      status: "ready",
      agentId,
      workspace: revision,
      created: true,
      ownershipRevision: manifest.ownershipRevision,
    };
    await beforeActivate?.(result);
    await activateAgent(agentId, revision);
    return result;
  } catch (error) {
    await rm(candidate, { recursive: true, force: true });
    throw error;
  }
}

function capabilityPreflight(
  host: FitnessAgentWorkspaceHost,
): { readonly ready: true } | { readonly ready: false; readonly reasonCode: string } {
  if (
    typeof host.preflight !== "function" ||
    typeof host.discoverAgent !== "function" ||
    typeof host.prepareWorkspace !== "function" ||
    typeof host.activateAgent !== "function"
  ) {
    return { ready: false, reasonCode: "AGENT_FILES_BOOTSTRAP_UNAVAILABLE" };
  }
  return host.preflight();
}

function retentionCapabilityPreflight(
  host: FitnessAgentWorkspaceHost,
): { readonly ready: true } | { readonly ready: false; readonly reasonCode: string } {
  if (
    typeof host.preflight !== "function" ||
    typeof host.discoverAgent !== "function" ||
    typeof host.retainAgent !== "function"
  ) {
    return { ready: false, reasonCode: "AGENT_FILES_BOOTSTRAP_UNAVAILABLE" };
  }
  return host.preflight();
}

function validateAsOf(value: string): string {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString() !== value) {
    throw new Error("Standalone degraded as-of must be an ISO timestamp");
  }
  return value;
}

function validateAgentId(value: string): string {
  const trimmed = value.trim();
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/u.test(trimmed)) {
    throw new Error("Agent ID must use lowercase letters, digits, hyphens, or underscores");
  }
  return trimmed;
}

function validateArtifacts(
  artifacts: readonly ManagedAgentArtifactInput[],
): readonly ManagedAgentArtifactInput[] {
  const seen = new Set<string>();
  return artifacts.map((artifact) => {
    const path = artifact.path.trim();
    if (
      path.length === 0 ||
      isAbsolute(path) ||
      path === OWNERSHIP_FILE ||
      relative(".", resolve(".", path)).startsWith("..") ||
      path.split(/[\\/]/u).includes("..")
    ) {
      throw new Error(`Invalid managed artifact path: ${artifact.path}`);
    }
    if (seen.has(path)) throw new Error(`Duplicate managed artifact path: ${path}`);
    seen.add(path);
    return { path, managedContent: normalizeManagedContent(artifact.managedContent) };
  });
}

async function writeManagedArtifacts(
  workspace: string,
  agentId: string,
  ownershipRevision: number,
  artifacts: readonly ManagedAgentArtifactInput[],
  preserveExistingUserContent = true,
): Promise<OwnershipManifest> {
  const manifestArtifacts: OwnershipArtifact[] = [];
  for (const artifact of artifacts) {
    const destination = join(workspace, artifact.path);
    await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
    const existing = await readFile(destination, "utf8").catch(() => "");
    const managedContent = normalizeManagedContent(artifact.managedContent);
    const checksum = checksumFor(managedContent);
    const content = renderManagedFile({
      path: artifact.path,
      ownershipRevision,
      checksum,
      managedContent,
      userContent: preserveExistingUserContent ? extractUserContent(existing) : "",
    });
    await writeFile(destination, content, { encoding: "utf8", mode: 0o600 });
    manifestArtifacts.push({ path: artifact.path, checksum });
  }
  const manifest: OwnershipManifest = {
    schemaVersion: OWNERSHIP_SCHEMA,
    agentId,
    ownershipRevision,
    artifacts: manifestArtifacts,
  };
  await writeFile(
    join(workspace, OWNERSHIP_FILE),
    `${JSON.stringify(manifest, null, 2)}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
  return manifest;
}

function renderManagedFile(input: {
  readonly path: string;
  readonly ownershipRevision: number;
  readonly checksum: string;
  readonly managedContent: string;
  readonly userContent: string;
}): string {
  const userContent = input.userContent.length === 0
    ? ""
    : normalizeManagedContent(input.userContent);
  return [
    `<!-- stella-fitness:managed:start path=${input.path} revision=${input.ownershipRevision} checksum=${input.checksum} -->`,
    input.managedContent.trimEnd(),
    "<!-- stella-fitness:managed:end -->",
    "<!-- stella-fitness:user:start -->",
    userContent.trimEnd(),
    "<!-- stella-fitness:user:end -->",
    "",
  ].join("\n");
}

async function inspectOwnership(
  workspace: string,
  agentId: string,
): Promise<
  | { readonly status: "missing" }
  | { readonly status: "conflicted"; readonly reasonCode: string }
  | { readonly status: "valid"; readonly manifest: OwnershipManifest }
> {
  let raw: string;
  try {
    raw = await readFile(join(workspace, OWNERSHIP_FILE), "utf8");
  } catch {
    return { status: "missing" };
  }
  let candidate: unknown;
  try {
    candidate = JSON.parse(raw);
  } catch {
    return { status: "conflicted", reasonCode: "OWNERSHIP_MANIFEST_INVALID" };
  }
  if (!isOwnershipManifest(candidate, agentId)) {
    return { status: "conflicted", reasonCode: "OWNERSHIP_MANIFEST_INVALID" };
  }
  try {
    const markedPaths = await findMarkedArtifactPaths(workspace);
    const manifestPaths = candidate.artifacts.map((artifact) => artifact.path).sort();
    if (markedPaths.join("\n") !== manifestPaths.join("\n")) {
      return { status: "conflicted", reasonCode: "OWNERSHIP_MARKER_SET_MISMATCH" };
    }
  } catch {
    return { status: "conflicted", reasonCode: "OWNERSHIP_MARKER_SET_INVALID" };
  }
  for (const artifact of candidate.artifacts) {
    const path = join(workspace, artifact.path);
    try {
      const before = await lstat(path);
      if (!before.isFile() || before.isSymbolicLink()) {
        return { status: "conflicted", reasonCode: "MANAGED_ARTIFACT_INVALID" };
      }
      const content = await readFile(path, "utf8");
      const after = await lstat(path);
      if (
        before.size !== after.size ||
        before.mtimeMs !== after.mtimeMs ||
        !managedContentMatches(content, artifact, candidate.ownershipRevision)
      ) {
        return { status: "conflicted", reasonCode: "MANAGED_ARTIFACT_TAMPERED" };
      }
    } catch {
      return { status: "conflicted", reasonCode: "MANAGED_ARTIFACT_MISSING" };
    }
  }
  return { status: "valid", manifest: candidate };
}

function isOwnershipManifest(
  value: unknown,
  agentId: string,
): value is OwnershipManifest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).some((key) =>
      !["schemaVersion", "agentId", "ownershipRevision", "artifacts"].includes(key)
    ) ||
    record.schemaVersion !== OWNERSHIP_SCHEMA ||
    record.agentId !== agentId ||
    !Number.isSafeInteger(record.ownershipRevision) ||
    (record.ownershipRevision as number) < 1 ||
    !Array.isArray(record.artifacts)
  ) return false;
  const paths = new Set<string>();
  return record.artifacts.every((artifact) => {
    if (typeof artifact !== "object" || artifact === null || Array.isArray(artifact)) {
      return false;
    }
    const entry = artifact as Record<string, unknown>;
    if (
      Object.keys(entry).some((key) => !["path", "checksum"].includes(key)) ||
      typeof entry.path !== "string" ||
      typeof entry.checksum !== "string" ||
      !/^sha256:[0-9a-f]{64}$/u.test(entry.checksum) ||
      isAbsolute(entry.path) ||
      entry.path.split(/[\\/]/u).includes("..") ||
      paths.has(entry.path)
    ) return false;
    paths.add(entry.path);
    return true;
  });
}

function managedContentMatches(
  file: string,
  artifact: OwnershipArtifact,
  ownershipRevision: number,
): boolean {
  const start = `<!-- stella-fitness:managed:start path=${artifact.path} revision=${ownershipRevision} checksum=${artifact.checksum} -->\n`;
  const end = "\n<!-- stella-fitness:managed:end -->";
  if (!file.startsWith(start)) return false;
  const endIndex = file.indexOf(end, start.length);
  if (endIndex < 0) return false;
  const managed = `${file.slice(start.length, endIndex)}\n`;
  const userStart = `${end}\n<!-- stella-fitness:user:start -->\n`;
  const userEnd = "\n<!-- stella-fitness:user:end -->\n";
  return checksumFor(managed) === artifact.checksum &&
    file.startsWith(userStart, endIndex) &&
    file.indexOf(userEnd, endIndex + userStart.length) >= 0 &&
    file.endsWith(userEnd);
}

async function readManagedArtifacts(
  workspace: string,
  manifest: OwnershipManifest,
): Promise<ManagedAgentArtifactInput[]> {
  return await Promise.all(manifest.artifacts.map(async (artifact) => ({
    path: artifact.path,
    managedContent: extractManagedContent(
      await readFile(join(workspace, artifact.path), "utf8"),
      artifact,
      manifest.ownershipRevision,
    ),
  })));
}

function extractManagedContent(
  file: string,
  artifact: OwnershipArtifact,
  ownershipRevision: number,
): string {
  const start = `<!-- stella-fitness:managed:start path=${artifact.path} revision=${ownershipRevision} checksum=${artifact.checksum} -->\n`;
  const end = "\n<!-- stella-fitness:managed:end -->";
  const endIndex = file.indexOf(end, start.length);
  if (!file.startsWith(start) || endIndex < 0) {
    throw new Error("Managed artifact content is invalid");
  }
  return normalizeManagedContent(file.slice(start.length, endIndex));
}

function standaloneDegradedContent(content: string, asOf: string): string {
  const start = "<!-- stella-fitness:lifecycle:start -->";
  const end = "<!-- stella-fitness:lifecycle:end -->";
  const existingStart = content.indexOf(start);
  const retained = existingStart < 0
    ? content.trimEnd()
    : content.slice(0, existingStart).trimEnd();
  return [
    retained,
    "",
    start,
    "# Stella Fitness lifecycle status",
    "",
    "status: standalone-degraded",
    `last verified as-of: ${asOf}`,
    "",
    "The Stella Fitness Plugin real-time recording, Current Fitness State, and Context Resync capabilities are unavailable.",
    "Retained projections and fitness facts are historical reference data and must not be represented as current or real-time.",
    "Continue using the last verified Stella identity and recording-only domain boundary.",
    "Reinstall and complete locator, ownership, source, freshness, and Host capability preflight before restoring live capabilities.",
    end,
    "",
  ].join("\n");
}

function normalizeManagedContent(value: string): string {
  return `${value.replace(/\r\n?/gu, "\n").trimEnd()}\n`;
}

function checksumFor(value: string | Uint8Array): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function managedWorkspaceRoot(desiredWorkspace: string, agentId: string): string {
  const parent = dirname(desiredWorkspace);
  return join(parent, `.${basename(desiredWorkspace)}.${agentId}.stella-fitness`);
}

function managedRootForWorkspace(workspace: string, agentId: string): string {
  return isManagedRevisionWorkspace(workspace)
    ? dirname(dirname(workspace))
    : managedWorkspaceRoot(workspace, agentId);
}

function isManagedRevisionWorkspace(workspace: string): boolean {
  return basename(dirname(workspace)) === "revisions" &&
    basename(dirname(dirname(workspace))).endsWith(".stella-fitness");
}

function manifestMatchesArtifacts(
  manifest: OwnershipManifest,
  artifacts: readonly ManagedAgentArtifactInput[],
): boolean {
  if (manifest.artifacts.length !== artifacts.length) return false;
  const requested = new Map(
    artifacts.map((artifact) => [
      artifact.path,
      checksumFor(normalizeManagedContent(artifact.managedContent)),
    ]),
  );
  return manifest.artifacts.every((artifact) =>
    requested.get(artifact.path) === artifact.checksum
  );
}

function manifestArtifactsAreRetained(
  manifest: OwnershipManifest,
  artifacts: readonly ManagedAgentArtifactInput[],
): boolean {
  const requestedPaths = new Set(artifacts.map((artifact) => artifact.path));
  return manifest.artifacts.every((artifact) => requestedPaths.has(artifact.path));
}

function extractUserContent(file: string): string {
  const startMarker = "<!-- stella-fitness:user:start -->\n";
  const endMarker = "\n<!-- stella-fitness:user:end -->";
  const start = file.indexOf(startMarker);
  if (start < 0) return file;
  const contentStart = start + startMarker.length;
  const end = file.indexOf(endMarker, contentStart);
  return end < 0 ? file : file.slice(contentStart, end);
}

async function hasCompleteIdentityCore(workspace: string): Promise<boolean> {
  for (const path of ["IDENTITY.md", "SOUL.md"]) {
    try {
      const content = await readFile(join(workspace, path), "utf8");
      const meaningful = content.replace(/<!-- stella-fitness:[^>]+-->/gu, "").trim();
      if (meaningful.length === 0) return false;
    } catch {
      return false;
    }
  }
  return true;
}

async function copyStableWorkspace(
  options: FitnessAgentWorkspaceManagerOptions,
  source: string,
  destination: string,
): Promise<string | undefined> {
  try {
    const before = await snapshotWorkspaceTree(source);
    const copyWorkspace = options.copyWorkspace ?? defaultCopyWorkspace;
    await copyWorkspace(source, destination);
    const [after, copied] = await Promise.all([
      snapshotWorkspaceTree(source),
      snapshotWorkspaceTree(destination),
    ]);
    return before === after && before === copied ? before : undefined;
  } catch (error) {
    if (isWorkspaceChangedDuringReadError(error)) return undefined;
    throw error;
  }
}

async function workspaceMatchesSnapshot(
  workspace: string,
  expected: string,
): Promise<boolean> {
  try {
    return await snapshotWorkspaceTree(workspace) === expected;
  } catch (error) {
    if (isWorkspaceChangedDuringReadError(error)) return false;
    throw error;
  }
}

function isWorkspaceChangedDuringReadError(error: unknown): boolean {
  if (!(error instanceof Error) || !("code" in error)) return false;
  return ["ENOENT", "ENOTDIR", "ESTALE"].includes(String(error.code));
}

async function defaultCopyWorkspace(
  source: string,
  destination: string,
): Promise<void> {
  await cp(source, destination, {
    recursive: true,
    errorOnExist: true,
    preserveTimestamps: true,
  });
}

async function snapshotWorkspaceTree(directory: string): Promise<string> {
  const entries: string[] = [];
  await appendDirectorySnapshot(directory, "", entries);
  return checksumFor(entries.join("\n"));
}

async function appendDirectorySnapshot(
  directory: string,
  prefix: string,
  output: string[],
): Promise<void> {
  const entries = (await readdir(directory, { withFileTypes: true }))
    .sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const path = join(directory, entry.name);
    const relativePath = prefix.length === 0 ? entry.name : join(prefix, entry.name);
    const metadata = await lstat(path);
    if (metadata.isSymbolicLink()) {
      throw new Error("Existing workspace contains a symbolic link");
    }
    if (entry.isDirectory()) {
      output.push(`directory:${relativePath}`);
      await appendDirectorySnapshot(path, relativePath, output);
      continue;
    }
    if (!metadata.isFile()) {
      throw new Error("Existing workspace contains an unsupported file type");
    }
    output.push(
      `file:${relativePath}:${checksumFor(await readFile(path))}`,
    );
  }
}

function adoptionInProgress(
  agentId: string,
  workspace: string,
): FitnessAgentWorkspaceResult {
  return {
    status: "blocked",
    agentId,
    workspace,
    reasonCode: "ADOPTION_IN_PROGRESS",
  };
}

function adoptionChoicesEqual(
  left: FitnessAgentWorkspaceAdoptionChoice,
  right: FitnessAgentWorkspaceAdoptionChoice,
): boolean {
  if (typeof left === "string" || typeof right === "string") return left === right;
  return left.alternateAgentId === right.alternateAgentId;
}

async function persistAdoptionResult(
  runtimeDirectory: string,
  agentId: string,
  choice: FitnessAgentWorkspaceAdoptionChoice,
  result: FitnessAgentWorkspaceResult,
): Promise<void> {
  const directory = join(runtimeDirectory, "workspace-adoptions");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const target = join(directory, `${agentId}.json`);
  const temporary = `${target}.${randomUUID()}.tmp`;
  await writeFile(
    temporary,
    `${JSON.stringify({ agentId, choice, result }, null, 2)}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
  await rename(temporary, target);
}

async function readAdoptionRecord(
  runtimeDirectory: string,
  agentId: string,
): Promise<FitnessAgentWorkspaceAdoptionRecord | undefined> {
  try {
    const value: unknown = JSON.parse(await readFile(
      join(runtimeDirectory, "workspace-adoptions", `${agentId}.json`),
      "utf8",
    ));
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return undefined;
    }
    const record = value as Record<string, unknown>;
    if (
      record.agentId !== agentId ||
      !isAdoptionChoice(record.choice) ||
      typeof record.result !== "object" ||
      record.result === null ||
      Array.isArray(record.result)
    ) return undefined;
    return record as unknown as FitnessAgentWorkspaceAdoptionRecord;
  } catch {
    return undefined;
  }
}

function isAdoptionChoice(value: unknown): value is FitnessAgentWorkspaceAdoptionChoice {
  if (value === "merge" || value === "skip") return true;
  return typeof value === "object" && value !== null && !Array.isArray(value) &&
    Object.keys(value).length === 1 &&
    typeof (value as Record<string, unknown>).alternateAgentId === "string";
}

async function withAgentLock<T>(
  runtimeDirectory: string,
  agentId: string,
  operation: () => Promise<T>,
): Promise<T> {
  const locksDirectory = join(runtimeDirectory, "workspace-locks");
  await mkdir(locksDirectory, { recursive: true, mode: 0o700 });
  const lockPath = join(locksDirectory, `${validateAgentId(agentId)}.lock`);
  const startedAt = Date.now();
  while (true) {
    try {
      const handle = await open(lockPath, "wx", 0o600);
      try {
        await handle.writeFile(`${process.pid}:${randomUUID()}\n`, "utf8");
        return await operation();
      } finally {
        await handle.close();
        await rm(lockPath, { force: true });
      }
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;
      if (await recoverAbandonedLock(lockPath)) continue;
      if (Date.now() - startedAt > 5_000) throw error;
      await new Promise((resolveWait) => setTimeout(resolveWait, 20));
    }
  }
}

async function withAgentLocks<T>(
  runtimeDirectory: string,
  agentIds: readonly string[],
  operation: () => Promise<T>,
): Promise<T> {
  const ordered = [...new Set(agentIds.map(validateAgentId))].sort();
  const acquire = (index: number): Promise<T> => {
    const agentId = ordered[index];
    return agentId === undefined
      ? operation()
      : withAgentLock(
          runtimeDirectory,
          agentId,
          () => acquire(index + 1),
        );
  };
  return acquire(0);
}

function isAlreadyExists(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "EEXIST";
}

async function recoverAbandonedLock(lockPath: string): Promise<boolean> {
  let owner: string;
  try {
    owner = await readFile(lockPath, "utf8");
  } catch {
    return false;
  }
  const processId = Number.parseInt(owner.split(":", 1)[0] ?? "", 10);
  if (!Number.isSafeInteger(processId) || processId <= 0) return false;
  try {
    process.kill(processId, 0);
    return false;
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !("code" in error) ||
      error.code !== "ESRCH"
    ) return false;
  }
  await rm(lockPath, { force: true });
  return true;
}
