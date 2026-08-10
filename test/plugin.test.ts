import { describe, expect, it, vi } from "vitest";

import plugin, { registerStellaFitnessPlugin } from "../src/plugin.js";
import { sanitizedMediaFixture } from "./support/sanitized-media.js";

const UNCONFIGURED_STATUS =
  "Stella Fitness: ready\ncontract: openclaw@2026.7.1-2\nscope: recording-only\nextraction: unconfigured";

describe("Plugin registration", () => {
  it("registers status CLI metadata without loading full runtime contracts", () => {
    const cliRegistrations: Array<Record<string, unknown>> = [];
    const api = {
      registrationMode: "cli-metadata",
      runtime: {},
      registerCli(
        registrar: (context: unknown) => unknown,
        registrationOptions: Record<string, unknown>,
      ) {
        cliRegistrations.push({ registrar, options: registrationOptions });
      },
    };

    expect(() =>
      plugin.register!(
        api as unknown as Parameters<NonNullable<typeof plugin.register>>[0],
      ),
    ).not.toThrow();
    expect(cliRegistrations).toHaveLength(1);
  });

  it("registers deterministic status command and current conversation hooks", async () => {
    const commands: Array<Record<string, unknown>> = [];
    const hooks = new Map<string, (...args: unknown[]) => unknown>();
    const cliRegistrations: Array<Record<string, unknown>> = [];
    const api = compatibleApi({ commands, hooks, cliRegistrations });

    plugin.register!(
      api as unknown as Parameters<NonNullable<typeof plugin.register>>[0],
    );

    const command = commands.find((candidate) => candidate.name === "stella-status");
    expect(command).toMatchObject({
      name: "stella-status",
      acceptsArgs: false,
      requireAuth: true,
    });
    await expect(
      (command?.handler as () => Promise<unknown>)(),
    ).resolves.toEqual({ text: UNCONFIGURED_STATUS });

    expect(hooks.has("before_agent_reply")).toBe(true);
    expect(hooks.has("before_agent_run")).toBe(true);
    await expect(
      hooks.get("before_agent_reply")?.({ cleanedBody: "stella status" }),
    ).resolves.toEqual({
      handled: true,
      reply: { text: UNCONFIGURED_STATUS },
    });
    await expect(
      hooks.get("before_agent_run")?.({ prompt: "stella status" }),
    ).resolves.toEqual({
      outcome: "block",
      reason: "stella-status-is-plugin-owned",
      message: UNCONFIGURED_STATUS,
      category: "plugin-command",
    });
    expect(cliRegistrations).toEqual([
      expect.objectContaining({
        options: {
          descriptors: [
            {
              name: "stella-fitness",
              description: "Stella Fitness Plugin commands",
              hasSubcommands: true,
            },
          ],
        },
      }),
    ]);
  });

  it("connects configured Plugin runtime to OpenClaw structured extraction", async () => {
    const extractStructuredWithModel = vi.fn().mockResolvedValue({
      text: '{"stage":1}',
      parsed: {
        stage: 1,
        week: 1,
        weekday: "monday",
        exercises: [],
        uncertainFields: [],
      },
      provider: "operator-provider",
      model: "operator-model",
      contentType: "json",
    });
    const api = compatibleApi({
      commands: [],
      hooks: new Map(),
      cliRegistrations: [],
      pluginConfig: {
        extraction: {
          provider: "operator-provider",
          model: "operator-model",
        },
      },
      openclawConfig: allowedModelConfig(),
      extractStructuredWithModel,
    });

    const runtime = registerStellaFitnessPlugin(
      api as unknown as Parameters<typeof registerStellaFitnessPlugin>[0],
    );
    const output = await runtime?.extractWorkoutLog({
      runId: "plugin-run-1",
      media: sanitizedMediaFixture(Buffer.from("sanitized")),
      timeoutMs: 2_000,
      signal: new AbortController().signal,
    });

    expect(output).toMatchObject({
      status: "candidate",
      execution: {
        provider: "operator-provider",
        model: "operator-model",
      },
    });
    expect(extractStructuredWithModel).toHaveBeenCalledOnce();
  });

  it("rejects extraction before calling OpenClaw when model config is absent", async () => {
    const extractStructuredWithModel = vi.fn();
    const api = compatibleApi({
      commands: [],
      hooks: new Map(),
      cliRegistrations: [],
      extractStructuredWithModel,
    });
    const runtime = registerStellaFitnessPlugin(
      api as unknown as Parameters<typeof registerStellaFitnessPlugin>[0],
    );

    await expect(
      runtime?.extractWorkoutLog({
        runId: "plugin-unconfigured",
        media: sanitizedMediaFixture(Buffer.from("sanitized")),
        timeoutMs: 2_000,
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow("extraction is unconfigured");
    expect(extractStructuredWithModel).not.toHaveBeenCalled();
  });

  it("fails registration before model access when extraction model is not allowlisted", () => {
    const commands: Array<Record<string, unknown>> = [];
    const extractStructuredWithModel = vi.fn();
    const api = compatibleApi({
      commands,
      hooks: new Map(),
      cliRegistrations: [],
      pluginConfig: {
        extraction: {
          provider: "operator-provider",
          model: "operator-model",
        },
      },
      extractStructuredWithModel,
    });

    expect(() =>
      registerStellaFitnessPlugin(
        api as unknown as Parameters<typeof registerStellaFitnessPlugin>[0],
      ),
    ).toThrow("model-permission");
    expect(commands).toEqual([]);
    expect(extractStructuredWithModel).not.toHaveBeenCalled();
  });

  it("fails registration before exposing commands when the host is incompatible", () => {
    const commands: Array<Record<string, unknown>> = [];
    const api = compatibleApi({
      commands,
      hooks: new Map(),
      cliRegistrations: [],
    });
    api.runtime.version = "2026.7.2";

    expect(() =>
      plugin.register!(
        api as unknown as Parameters<NonNullable<typeof plugin.register>>[0],
      ),
    ).toThrow("host-version");
    expect(commands).toEqual([]);
  });
});

function compatibleApi(options: {
  commands: Array<Record<string, unknown>>;
  hooks: Map<string, (...args: unknown[]) => unknown>;
  cliRegistrations: Array<Record<string, unknown>>;
  pluginConfig?: Record<string, unknown>;
  openclawConfig?: Record<string, unknown>;
  extractStructuredWithModel?: ReturnType<typeof vi.fn>;
}) {
  return {
    registrationMode: "full",
    config: options.openclawConfig ?? {},
    pluginConfig: options.pluginConfig,
    runtime: {
      version: "2026.7.1-2",
      mediaUnderstanding: {
        extractStructuredWithModel:
          options.extractStructuredWithModel ?? vi.fn(),
      },
    },
    registerCommand(command: Record<string, unknown>) {
      options.commands.push(command);
    },
    registerCli(
      registrar: (context: unknown) => unknown,
      registrationOptions: Record<string, unknown>,
    ) {
      options.cliRegistrations.push({
        registrar,
        options: registrationOptions,
      });
    },
    on(name: string, handler: (...args: unknown[]) => unknown) {
      options.hooks.set(name, handler);
    },
  };
}

function allowedModelConfig() {
  return {
    agents: {
      defaults: {
        models: { "operator-provider/operator-model": {} },
      },
    },
  };
}
