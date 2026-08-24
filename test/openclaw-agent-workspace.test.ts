import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import { describe, expect, it, vi } from "vitest";

import { createOpenClawFitnessAgentWorkspaceHost } from "../src/agent-workspace/openclaw.js";

describe("OpenClaw Fitness Agent workspace host", () => {
  it("uses only public config, Agent workspace resolution, and bootstrap capabilities", async () => {
    const root = await mkdtemp(join(tmpdir(), "stella-openclaw-workspace-test-"));
    const config: {
      agents: { list: Array<{ id: string; workspace?: string }> };
      plugins: {
        entries: Record<string, { config?: Record<string, unknown> }>;
      };
    } = {
      agents: { list: [] },
      plugins: { entries: { "stella-fitness": { config: {} } } },
    };
    const mutateConfigFile = vi.fn(async (input: {
      mutate(draft: typeof config): void;
    }) => {
      input.mutate(config);
      return { result: undefined };
    });
    const ensureAgentWorkspace = vi.fn(async (input: { dir: string }) => {
      await mkdir(input.dir, { recursive: true });
      return { dir: input.dir };
    });
    const api = {
      runtime: {
        config: { current: () => config, mutateConfigFile },
        agent: {
          resolveAgentWorkspaceDir: (
            current: typeof config,
            agentId: string,
          ) => current.agents.list.find(({ id }) => id === agentId)?.workspace ??
            join(root, `workspace-${agentId}`),
          ensureAgentWorkspace,
        },
      },
    } as unknown as OpenClawPluginApi;
    const host = createOpenClawFitnessAgentWorkspaceHost(api);

    expect(host.preflight?.()).toEqual({ ready: true });
    expect(host.discoverAgent?.("fitness")).toEqual({
      exists: false,
      workspace: join(root, "workspace-fitness"),
    });
    const candidate = join(root, "candidate");
    await host.prepareWorkspace?.(candidate);
    await host.activateAgent?.("fitness", candidate);

    expect(ensureAgentWorkspace).toHaveBeenCalledWith({
      dir: candidate,
      ensureBootstrapFiles: true,
    });
    expect(mutateConfigFile).toHaveBeenCalledWith(expect.objectContaining({
      afterWrite: { mode: "auto" },
    }));
    expect(config.agents.list).toEqual([{ id: "fitness", workspace: candidate }]);
    expect(config.plugins.entries["stella-fitness"]?.config).toEqual({
      dedicatedAgentId: "fitness",
    });
    expect(host.discoverAgent?.("fitness")).toEqual({
      exists: true,
      workspace: candidate,
    });
    await expect(readFile(candidate)).rejects.toThrow();
  });
});
