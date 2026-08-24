import type {
  OpenClawConfig,
  OpenClawPluginApi,
} from "openclaw/plugin-sdk/plugin-entry";

import type { FitnessAgentWorkspaceHost } from "./manager.js";

export function createOpenClawFitnessAgentWorkspaceHost(
  api: OpenClawPluginApi,
): FitnessAgentWorkspaceHost {
  return {
    preflight() {
      return hasPublicWorkspaceCapabilities(api)
        ? { ready: true }
        : {
            ready: false,
            reasonCode: "AGENT_FILES_BOOTSTRAP_UNAVAILABLE",
          };
    },
    discoverAgent(agentId) {
      const config = api.runtime.config.current();
      const exists = config.agents?.list?.some((agent) => agent.id === agentId) ??
        false;
      return {
        exists,
        workspace: api.runtime.agent.resolveAgentWorkspaceDir(
          config as unknown as OpenClawConfig,
          agentId,
          process.env,
        ),
      };
    },
    async prepareWorkspace(workspace) {
      await api.runtime.agent.ensureAgentWorkspace({
        dir: workspace,
        ensureBootstrapFiles: true,
      });
    },
    async activateAgent(agentId, workspace) {
      await api.runtime.config.mutateConfigFile({
        afterWrite: { mode: "auto" },
        mutate(draft) {
          const list = draft.agents?.list ?? [];
          const existingIndex = list.findIndex((agent) => agent.id === agentId);
          const nextAgent = existingIndex < 0
            ? { id: agentId, workspace }
            : { ...list[existingIndex]!, workspace };
          const nextList = existingIndex < 0
            ? [...list, nextAgent]
            : list.map((agent, index) =>
                index === existingIndex ? nextAgent : agent
              );
          draft.agents = { ...draft.agents, list: nextList };
          const pluginEntry = draft.plugins?.entries?.["stella-fitness"] ?? {};
          draft.plugins = {
            ...draft.plugins,
            entries: {
              ...draft.plugins?.entries,
              "stella-fitness": {
                ...pluginEntry,
                config: {
                  ...pluginEntry.config,
                  dedicatedAgentId: agentId,
                },
              },
            },
          };
        },
      });
    },
  };
}

function hasPublicWorkspaceCapabilities(api: OpenClawPluginApi): boolean {
  return typeof api.runtime?.config?.current === "function" &&
    typeof api.runtime?.config?.mutateConfigFile === "function" &&
    typeof api.runtime?.agent?.resolveAgentWorkspaceDir === "function" &&
    typeof api.runtime?.agent?.ensureAgentWorkspace === "function";
}
