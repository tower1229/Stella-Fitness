import { join, resolve } from "node:path";

import type {
  OpenClawConfig,
  OpenClawPluginApi,
} from "openclaw/plugin-sdk/plugin-entry";
import {
  getMemoryCapabilityRegistration,
  resolveMemorySearchConfig,
} from "openclaw/plugin-sdk/memory-core";

export type FitnessAgentMemoryResult =
  | { readonly status: "ready" }
  | {
      readonly status: "degraded";
      readonly reasonCode:
        | "AGENT_MEMORY_CONFIG_UNAVAILABLE"
        | "AGENT_MEMORY_CAPABILITY_UNAVAILABLE";
    };

export async function configureFitnessAgentMemory(options: {
  readonly api: OpenClawPluginApi;
  readonly agentId: string;
  readonly workspace: string;
}): Promise<FitnessAgentMemoryResult> {
  if (
    typeof options.api.runtime?.config?.current !== "function" ||
    typeof options.api.runtime?.config?.mutateConfigFile !== "function"
  ) {
    return {
      status: "degraded",
      reasonCode: "AGENT_MEMORY_CONFIG_UNAVAILABLE",
    };
  }
  const workspace = resolve(options.workspace);
  let config: OpenClawConfig;
  try {
    const mutation = await options.api.runtime.config.mutateConfigFile<
      "configured" | "blocked-default-scope" | "missing-agent"
    >({
      afterWrite: { mode: "auto" },
      mutate(draft) {
        const list = draft.agents?.list ?? [];
        const index = list.findIndex((agent) => agent.id === options.agentId);
        if (index < 0) return "missing-agent";
        const current = list[index]!;
        const memorySearch = current.memorySearch ?? {};
        const defaultMemory = draft.agents?.defaults?.memorySearch;
        if (
          (defaultMemory?.extraPaths?.length ?? 0) > 0 ||
          (defaultMemory?.qmd?.extraCollections?.length ?? 0) > 0
        ) {
          const next = {
            ...current,
            memorySearch: { ...memorySearch, enabled: false },
          };
          draft.agents = {
            ...draft.agents,
            list: list.map((agent, agentIndex) =>
              agentIndex === index ? next : agent
            ),
          };
          return "blocked-default-scope";
        }
        const qmd = memorySearch.qmd ?? {};
        const sources: Array<"memory" | "sessions"> = ["memory", "sessions"];
        const extraPaths = uniquePaths([
          join(workspace, "USER.md"),
          join(workspace, "memory"),
        ]);
        const next = {
          ...current,
          memorySearch: {
            ...memorySearch,
            enabled: true,
            sources,
            extraPaths,
            qmd: { ...qmd, extraCollections: [] },
            experimental: {
              ...memorySearch.experimental,
              sessionMemory: true,
            },
          },
        };
        draft.agents = {
          ...draft.agents,
          list: list.map((agent, agentIndex) =>
            agentIndex === index ? next : agent
          ),
        };
        return "configured";
      },
    });
    if (mutation.result !== "configured") {
      return {
        status: "degraded",
        reasonCode: mutation.result === "blocked-default-scope"
          ? "AGENT_MEMORY_CAPABILITY_UNAVAILABLE"
          : "AGENT_MEMORY_CONFIG_UNAVAILABLE",
      };
    }
    config = mutation.nextConfig;
  } catch {
    return {
      status: "degraded",
      reasonCode: "AGENT_MEMORY_CONFIG_UNAVAILABLE",
    };
  }

  let resolved: ReturnType<typeof resolveMemorySearchConfig>;
  try {
    resolved = resolveMemorySearchConfig(config, options.agentId);
  } catch {
    return {
      status: "degraded",
      reasonCode: "AGENT_MEMORY_CAPABILITY_UNAVAILABLE",
    };
  }
  if (
    resolved === null ||
    !resolved.enabled ||
    !resolved.sources.includes("memory") ||
    !resolved.sources.includes("sessions") ||
    !resolved.experimental.sessionMemory ||
    !samePaths(
      resolved.extraPaths,
      [join(workspace, "USER.md"), join(workspace, "memory")],
    )
  ) {
    return {
      status: "degraded",
      reasonCode: "AGENT_MEMORY_CAPABILITY_UNAVAILABLE",
    };
  }
  const runtime = getMemoryCapabilityRegistration()?.capability.runtime;
  if (runtime === undefined) {
    return {
      status: "degraded",
      reasonCode: "AGENT_MEMORY_CAPABILITY_UNAVAILABLE",
    };
  }
  try {
    const { manager } = await runtime.getMemorySearchManager({
      cfg: config,
      agentId: options.agentId,
      purpose: "status",
    });
    if (manager === null) {
      return {
        status: "degraded",
        reasonCode: "AGENT_MEMORY_CAPABILITY_UNAVAILABLE",
      };
    }
    const embedding = await manager.probeEmbeddingAvailability();
    const vector = await manager.probeVectorAvailability();
    if (!embedding.ok || !vector) {
      return {
        status: "degraded",
        reasonCode: "AGENT_MEMORY_CAPABILITY_UNAVAILABLE",
      };
    }
    await manager.sync?.({ reason: "stella-fitness-capability-preflight" });
    await manager.search("stella-fitness-capability-preflight", {
      maxResults: 1,
      minScore: 0,
      sessionKey: `agent:${options.agentId}:stella-fitness-capability-preflight`,
      sources: ["memory", "sessions"],
    });
  } catch {
    return {
      status: "degraded",
      reasonCode: "AGENT_MEMORY_CAPABILITY_UNAVAILABLE",
    };
  }
  return { status: "ready" };
}

function uniquePaths(paths: readonly string[]): string[] {
  return [...new Set(paths.map((path) => resolve(path)))];
}

function samePaths(actual: readonly string[], required: readonly string[]): boolean {
  const paths = new Set(actual.map((path) => resolve(path)));
  const requiredPaths = new Set(required.map((path) => resolve(path)));
  return paths.size === requiredPaths.size &&
    [...requiredPaths].every((path) => paths.has(path));
}
