import { readFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

import type { FitnessAgentWorkspaceHost } from "./manager.js";
import { findMarkedArtifactPaths } from "./ownership.js";

const OWNERSHIP_FILE = ".stella-fitness-ownership.json";
const BLOCK_REASON = "Stella Fitness managed Agent artifacts are read-only";

type ToolPolicyEvent = {
  readonly toolName: string;
  readonly params: Readonly<Record<string, unknown>>;
  readonly derivedPaths?: readonly string[];
};

type ToolPolicyContext = {
  readonly agentId?: string;
  readonly toolName: string;
};

export type ManagedArtifactToolPolicy = {
  readonly id: "stella-fitness-managed-artifacts";
  readonly description: string;
  evaluate(
    event: ToolPolicyEvent,
    context: ToolPolicyContext,
  ): Promise<{ readonly block: true; readonly blockReason: string } | undefined>;
};

export function createManagedArtifactToolPolicy(options: {
  readonly host: FitnessAgentWorkspaceHost;
}): ManagedArtifactToolPolicy {
  return {
    id: "stella-fitness-managed-artifacts",
    description: "Prevent Agent file tools from modifying Plugin-managed workspace artifacts",
    async evaluate(event, context) {
      if (
        context.agentId === undefined ||
        isReadOnlyTool(event.toolName) ||
        typeof options.host.discoverAgent !== "function"
      ) return undefined;
      const discovered = options.host.discoverAgent(context.agentId);
      if (!discovered.exists) return undefined;
      const candidatePaths = collectCandidatePaths(
        event,
        discovered.workspace,
      );
      if (candidatePaths.length === 0) return undefined;
      const managedPaths = await readManagedPaths(
        discovered.workspace,
        context.agentId,
      );
      if (managedPaths === undefined) {
        return isManagedRevisionWorkspace(discovered.workspace) &&
            candidatePaths.some((path) =>
              isSameOrAncestor(discovered.workspace, path)
            )
          ? { block: true, blockReason: BLOCK_REASON }
          : undefined;
      }
      const touchesManaged = candidatePaths.some((candidate) =>
        managedPaths.some((managed) => isSameOrAncestor(candidate, managed))
      );
      if (!touchesManaged) return undefined;
      if (await isProvenUserSectionEdit(event, candidatePaths, managedPaths)) {
        return undefined;
      }
      return { block: true, blockReason: BLOCK_REASON };
    },
  };
}

async function isProvenUserSectionEdit(
  event: ToolPolicyEvent,
  candidatePaths: readonly string[],
  managedPaths: readonly string[],
): Promise<boolean> {
  if (!/(?:edit|replace)/iu.test(event.toolName) || candidatePaths.length !== 1) {
    return false;
  }
  const candidate = candidatePaths[0]!;
  if (
    basename(candidate) === OWNERSHIP_FILE ||
    !managedPaths.some((managed) => managed === candidate)
  ) return false;
  const replacement = readReplacement(event.params);
  if (
    replacement === undefined ||
    replacement.oldText.length === 0
  ) return false;
  try {
    const content = await readFile(candidate, "utf8");
    const first = content.indexOf(replacement.oldText);
    if (first < 0 || content.indexOf(replacement.oldText, first + 1) >= 0) {
      return false;
    }
    const userStartMarker = "<!-- stella-fitness:user:start -->\n";
    const userEndMarker = "\n<!-- stella-fitness:user:end -->";
    const userStart = content.indexOf(userStartMarker);
    const userEnd = content.indexOf(userEndMarker, userStart + userStartMarker.length);
    if (
      isWholeUserSectionReplacement(replacement, userStartMarker, userEndMarker)
    ) {
      return first === userStart &&
        first + replacement.oldText.length === userEnd + userEndMarker.length;
    }
    if (/<!--\s*stella-fitness:/iu.test(replacement.newText)) return false;
    return userStart >= 0 &&
      userEnd >= 0 &&
      first >= userStart + userStartMarker.length &&
      first + replacement.oldText.length <= userEnd;
  } catch {
    return false;
  }
}

function isWholeUserSectionReplacement(
  replacement: { readonly oldText: string; readonly newText: string },
  userStartMarker: string,
  userEndMarker: string,
): boolean {
  if (
    !replacement.oldText.startsWith(userStartMarker) ||
    !replacement.oldText.endsWith(userEndMarker) ||
    !replacement.newText.startsWith(userStartMarker) ||
    !replacement.newText.endsWith(userEndMarker)
  ) return false;
  const inner = replacement.newText.slice(
    userStartMarker.length,
    replacement.newText.length - userEndMarker.length,
  );
  return !/<!--\s*stella-fitness:/iu.test(inner);
}

function readReplacement(
  params: Readonly<Record<string, unknown>>,
): { readonly oldText: string; readonly newText: string } | undefined {
  const oldText = typeof params.oldText === "string"
    ? params.oldText
    : typeof params.old_string === "string"
    ? params.old_string
    : undefined;
  const newText = typeof params.newText === "string"
    ? params.newText
    : typeof params.new_string === "string"
    ? params.new_string
    : undefined;
  return oldText === undefined || newText === undefined
    ? undefined
    : { oldText, newText };
}

function isReadOnlyTool(toolName: string): boolean {
  return /(?:^|[_-])(read|view|find|search|glob|list|stat)(?:$|[_-])/iu.test(
    toolName,
  );
}

function collectCandidatePaths(
  event: ToolPolicyEvent,
  workspace: string,
): string[] {
  const paths = new Set<string>();
  for (const path of event.derivedPaths ?? []) {
    paths.add(resolveCandidatePath(path, workspace));
  }
  collectPathParams(event.params, workspace, paths);
  return [...paths];
}

function collectPathParams(
  value: unknown,
  workspace: string,
  output: Set<string>,
  key?: string,
): void {
  if (typeof value === "string") {
    if (key !== undefined && /^(?:path|file|target|destination)$/iu.test(key)) {
      output.add(resolveCandidatePath(value, workspace));
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) collectPathParams(entry, workspace, output, key);
    return;
  }
  if (typeof value !== "object" || value === null) return;
  for (const [entryKey, entryValue] of Object.entries(value)) {
    collectPathParams(entryValue, workspace, output, entryKey);
  }
}

function resolveCandidatePath(path: string, workspace: string): string {
  return resolve(isAbsolute(path) ? path : join(workspace, path));
}

async function readManagedPaths(
  workspace: string,
  agentId: string,
): Promise<string[] | undefined> {
  try {
    const value: unknown = JSON.parse(
      await readFile(join(workspace, OWNERSHIP_FILE), "utf8"),
    );
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return undefined;
    }
    const record = value as Record<string, unknown>;
    if (record.agentId !== agentId || !Array.isArray(record.artifacts)) {
      return undefined;
    }
    const paths = [resolve(workspace, OWNERSHIP_FILE)];
    for (const artifact of record.artifacts) {
      if (
        typeof artifact !== "object" ||
        artifact === null ||
        Array.isArray(artifact) ||
        typeof (artifact as Record<string, unknown>).path !== "string"
      ) return undefined;
      const artifactPath = (artifact as { path: string }).path;
      const resolved = resolve(workspace, artifactPath);
      if (relative(workspace, resolved).startsWith("..")) return undefined;
      paths.push(resolved);
    }
    const declared = paths.slice(1).map((path) => relative(workspace, path)).sort();
    const marked = [...await findMarkedArtifactPaths(workspace)].sort();
    if (declared.join("\n") !== marked.join("\n")) return undefined;
    return paths;
  } catch {
    return undefined;
  }
}

function isSameOrAncestor(candidate: string, managed: string): boolean {
  const relation = relative(candidate, managed);
  return relation === "" || (!relation.startsWith("..") && !isAbsolute(relation));
}

function isManagedRevisionWorkspace(workspace: string): boolean {
  return basename(dirname(workspace)) === "revisions" &&
    basename(dirname(dirname(workspace))).endsWith(".stella-fitness");
}
