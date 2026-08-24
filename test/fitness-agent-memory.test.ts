import { join } from "node:path";

import type {
  OpenClawConfig,
  OpenClawPluginApi,
} from "openclaw/plugin-sdk/plugin-entry";
import {
  clearMemoryPluginState,
  registerMemoryCapability,
  resolveMemorySearchConfig,
} from "openclaw/plugin-sdk/memory-core";
import {
  parseAgentSessionKey,
  resolveAgentRoute,
} from "openclaw/plugin-sdk/routing";
import { afterEach, describe, expect, it, vi } from "vitest";

import { configureFitnessAgentMemory } from "../src/agent-workspace/memory.js";

describe("Fitness Agent-scoped conversational memory", () => {
  afterEach(() => clearMemoryPluginState());

  it("enables only the dedicated Agent's own memory and sessions through public Host config", async () => {
    const workspace = "/private/fitness-workspace";
    const config = {
      agents: {
        defaults: {
          memorySearch: {
            enabled: false,
          },
        },
        list: [{
          id: "main",
          workspace: "/private/main-workspace",
          memorySearch: {
            enabled: true,
            extraPaths: ["/private/main-workspace/memory"],
          },
        }, {
          id: "fitness",
          workspace,
          memorySearch: {
            provider: "local",
            extraPaths: [
              join(workspace, "USER.md"),
              "/private/main-workspace/memory",
            ],
            qmd: {
              extraCollections: [{
                path: "/private/main-agent/sessions",
                name: "main-sessions",
              }],
            },
          },
        }],
      },
      bindings: [{
        agentId: "fitness",
        match: { channel: "telegram", accountId: "default" },
      }],
      plugins: { entries: {} },
    } satisfies OpenClawConfig;
    const originalDefaults = structuredClone(config.agents.defaults);
    const originalMain = structuredClone(config.agents.list[0]);
    const mutateConfigFile = vi.fn(async (input: {
      mutate(draft: typeof config): boolean | void;
    }) => {
      const result = input.mutate(config);
      return { result, nextConfig: config };
    });
    const sync = vi.fn(async () => undefined);
    const search = vi.fn(async () => []);
    registerMemoryCapability("fitness-memory-test", {
      runtime: {
        async getMemorySearchManager() {
          return {
            manager: {
              search,
              async readFile() {
                return { text: "", path: "USER.md" };
              },
              status() {
                return { backend: "builtin", provider: "fixture" };
              },
              sync,
              async probeEmbeddingAvailability() {
                return { ok: true, checked: true };
              },
              async probeVectorAvailability() {
                return true;
              },
            },
          };
        },
        resolveMemoryBackendConfig() {
          return { backend: "builtin" };
        },
      },
    });
    const api = {
      runtime: {
        config: { current: () => config, mutateConfigFile },
      },
    } as unknown as OpenClawPluginApi;

    await expect(configureFitnessAgentMemory({
      api,
      agentId: "fitness",
      workspace,
    })).resolves.toEqual({ status: "ready" });

    expect(config.agents.defaults).toEqual(originalDefaults);
    expect(config.agents.list[0]).toEqual(originalMain);
    expect(config.agents.list[1]?.memorySearch).toMatchObject({
      enabled: true,
      sources: ["memory", "sessions"],
      experimental: { sessionMemory: true },
      provider: "local",
      extraPaths: [join(workspace, "USER.md"), join(workspace, "memory")],
      qmd: { extraCollections: [] },
    });
    const resolved = resolveMemorySearchConfig(config, "fitness");
    expect(resolved).toMatchObject({
      enabled: true,
      sources: ["memory", "sessions"],
      experimental: { sessionMemory: true },
    });
    const telegram = resolveAgentRoute({
      cfg: config,
      channel: "telegram",
      accountId: "default",
      peer: { kind: "direct", id: "fitness-principal" },
    });
    const webchat = parseAgentSessionKey(
      "agent:fitness:webchat:fitness-principal",
    );
    expect(telegram).toMatchObject({
      agentId: "fitness",
      matchedBy: "binding.account",
    });
    expect(parseAgentSessionKey(telegram.sessionKey)?.agentId).toBe("fitness");
    expect(webchat?.agentId).toBe("fitness");
    expect(resolveMemorySearchConfig(config, "main")?.sources).not.toContain(
      "sessions",
    );
    expect(sync).toHaveBeenCalledWith({
      reason: "stella-fitness-capability-preflight",
    });
    expect(search).toHaveBeenCalledWith(
      "stella-fitness-capability-preflight",
      expect.objectContaining({ sources: ["memory", "sessions"] }),
    );
  });

  it("degrades instead of inheriting a Host-wide extra search path", async () => {
    const config = {
      agents: {
        defaults: {
          memorySearch: { extraPaths: ["/host/shared-context"] },
        },
        list: [{ id: "fitness", workspace: "/private/fitness-workspace" }],
      },
    } satisfies OpenClawConfig;
    const mutateConfigFile = vi.fn(async (input: {
      mutate(draft: typeof config): boolean | void;
    }) => ({ result: input.mutate(config), nextConfig: config }));
    const api = {
      runtime: {
        config: { current: () => config, mutateConfigFile },
      },
    } as unknown as OpenClawPluginApi;

    await expect(configureFitnessAgentMemory({
      api,
      agentId: "fitness",
      workspace: "/private/fitness-workspace",
    })).resolves.toEqual({
      status: "degraded",
      reasonCode: "AGENT_MEMORY_CAPABILITY_UNAVAILABLE",
    });
    expect(config.agents.defaults.memorySearch.extraPaths).toEqual([
      "/host/shared-context",
    ]);
  });

  it("returns a natural degraded result when public Host memory config behavior is unavailable", async () => {
    const api = {
      runtime: { config: { current: () => ({ agents: { list: [] } }) } },
    } as unknown as OpenClawPluginApi;

    await expect(configureFitnessAgentMemory({
      api,
      agentId: "fitness",
      workspace: "/private/fitness-workspace",
    })).resolves.toEqual({
      status: "degraded",
      reasonCode: "AGENT_MEMORY_CONFIG_UNAVAILABLE",
    });
  });
});
