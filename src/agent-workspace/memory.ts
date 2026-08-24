import { join, resolve } from "node:path";

import type {
  OpenClawConfig,
  OpenClawPluginApi,
} from "openclaw/plugin-sdk/plugin-entry";
import { resolveMemorySearchConfig } from "openclaw/plugin-sdk/memory-core";

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
  try {
    await options.api.runtime.config.mutateConfigFile({
      afterWrite: { mode: "auto" },
      mutate(draft) {
        const list = draft.agents?.list ?? [];
        const index = list.findIndex((agent) => agent.id === options.agentId);
        if (index < 0) return;
        const current = list[index]!;
        const memorySearch = current.memorySearch ?? {};
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
      },
    });
  } catch {
    return {
      status: "degraded",
      reasonCode: "AGENT_MEMORY_CONFIG_UNAVAILABLE",
    };
  }

  const config = options.api.runtime.config.current() as OpenClawConfig;
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
  return { status: "ready" };
}

function uniquePaths(paths: readonly string[]): string[] {
  return [...new Set(paths.map((path) => resolve(path)))];
}

function samePaths(actual: readonly string[], required: readonly string[]): boolean {
  const paths = new Set(actual.map((path) => resolve(path)));
  return required.every((path) => paths.has(resolve(path)));
}
