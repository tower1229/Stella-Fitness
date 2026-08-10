import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import plugin, { registerStellaFitnessPlugin } from "../src/plugin.js";
import { sanitizedMediaFixture } from "./support/sanitized-media.js";

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

const READY_FOR_SETUP_STATUS =
  "Stella Fitness: READY_FOR_SETUP\ncontract: openclaw>=2026.6.34\nscope: recording-only\nreason: EXTRACTION_MODEL_REQUIRED: Configure an allowlisted extraction provider and model";

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
    const api = compatibleApi({
      commands,
      hooks,
      cliRegistrations,
      pluginConfig: configuredPersonalDirectory(),
      openclawConfig: permittedOpenClawConfig(),
    });

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
    ).resolves.toEqual({ text: READY_FOR_SETUP_STATUS });

    expect(hooks.has("before_agent_reply")).toBe(true);
    expect(hooks.has("before_agent_run")).toBe(true);
    await expect(
      hooks.get("before_agent_reply")?.({ cleanedBody: "stella status" }),
    ).resolves.toEqual({
      handled: true,
      reply: { text: READY_FOR_SETUP_STATUS },
    });
    await expect(
      hooks.get("before_agent_run")?.({ prompt: "stella status" }),
    ).resolves.toEqual({
      outcome: "block",
      reason: "stella-status-is-plugin-owned",
      message: READY_FOR_SETUP_STATUS,
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
        ...configuredPersonalDirectory(),
        extraction: {
          provider: "operator-provider",
          model: "operator-model",
        },
      },
      openclawConfig: permittedOpenClawConfig({ allowModel: true }),
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
      pluginConfig: configuredPersonalDirectory(),
      openclawConfig: permittedOpenClawConfig(),
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
    ).rejects.toThrow("READY_FOR_SETUP: EXTRACTION_MODEL_REQUIRED");
    expect(extractStructuredWithModel).not.toHaveBeenCalled();
  });

  it("blocks personal input before model access when extraction model is not allowlisted", async () => {
    const commands: Array<Record<string, unknown>> = [];
    const extractStructuredWithModel = vi.fn();
    const api = compatibleApi({
      commands,
      hooks: new Map(),
      cliRegistrations: [],
      pluginConfig: {
        ...configuredPersonalDirectory(),
        extraction: {
          provider: "operator-provider",
          model: "operator-model",
        },
      },
      openclawConfig: permittedOpenClawConfig(),
      extractStructuredWithModel,
    });

    const runtime = registerStellaFitnessPlugin(
      api as unknown as Parameters<typeof registerStellaFitnessPlugin>[0],
    );

    expect(runtime?.preflight()).toMatchObject({
      readiness: "BLOCKED_CONFIGURATION",
      reasons: [
        expect.objectContaining({ code: "EXTRACTION_MODEL_NOT_ALLOWLISTED" }),
      ],
    });
    await expect(
      runtime?.extractWorkoutLog({
        runId: "plugin-denied-model",
        media: sanitizedMediaFixture(Buffer.from("sanitized")),
        timeoutMs: 2_000,
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow("EXTRACTION_MODEL_NOT_ALLOWLISTED");
    expect(extractStructuredWithModel).not.toHaveBeenCalled();
  });

  it("reports limited readiness and rejects media when structured extraction is missing", async () => {
    const commands: Array<Record<string, unknown>> = [];
    const api = compatibleApi({
      commands,
      hooks: new Map(),
      cliRegistrations: [],
      pluginConfig: {
        ...configuredPersonalDirectory(),
        extraction: {
          provider: "operator-provider",
          model: "operator-model",
        },
      },
      openclawConfig: permittedOpenClawConfig({ allowModel: true }),
    });
    api.runtime.mediaUnderstanding.extractStructuredWithModel = undefined as never;

    const runtime = registerStellaFitnessPlugin(
      api as unknown as Parameters<typeof registerStellaFitnessPlugin>[0],
    );

    expect(runtime?.preflight()).toMatchObject({
      readiness: "READY_WITH_LIMITED_CAPABILITIES",
      reasons: [expect.objectContaining({ code: "STRUCTURED_MEDIA_REQUIRED" })],
    });
    await expect(
      runtime?.extractWorkoutLog({
        runId: "plugin-missing-media",
        media: sanitizedMediaFixture(Buffer.from("sanitized")),
        timeoutMs: 2_000,
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow("STRUCTURED_MEDIA_REQUIRED");
    expect(commands).toHaveLength(1);
  });

  it("accepts corrected configuration after rerunning preflight", async () => {
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
    const openclawConfig = permittedOpenClawConfig();
    const api = compatibleApi({
      commands: [],
      hooks: new Map(),
      cliRegistrations: [],
      openclawConfig,
      extractStructuredWithModel,
    });
    const runtime = registerStellaFitnessPlugin(
      api as unknown as Parameters<typeof registerStellaFitnessPlugin>[0],
    );
    expect(runtime?.preflight().readiness).toBe("BLOCKED_CONFIGURATION");

    const correctedPluginConfig = {
      ...configuredPersonalDirectory(),
      extraction: {
        provider: "operator-provider",
        model: "operator-model",
      },
    };
    api.pluginConfig = correctedPluginConfig;
    openclawConfig.agents = allowedModelConfig().agents;
    openclawConfig.plugins.entries["stella-fitness"]!.config =
      correctedPluginConfig;

    expect(runtime?.preflight()).toEqual({ readiness: "READY", reasons: [] });
    await expect(
      runtime?.extractWorkoutLog({
        runId: "plugin-corrected",
        media: sanitizedMediaFixture(Buffer.from("sanitized")),
        timeoutMs: 2_000,
        signal: new AbortController().signal,
      }),
    ).resolves.toMatchObject({ status: "candidate" });
    expect(extractStructuredWithModel).toHaveBeenCalledOnce();
  });

  it("fails closed when corrected Plugin config is removed again", () => {
    const openclawConfig = permittedOpenClawConfig({ allowModel: true });
    const initialPluginConfig = {
      ...configuredPersonalDirectory(),
      extraction: {
        provider: "operator-provider",
        model: "operator-model",
      },
    };
    const api = compatibleApi({
      commands: [],
      hooks: new Map(),
      cliRegistrations: [],
      pluginConfig: initialPluginConfig,
      openclawConfig,
    });
    const runtime = registerStellaFitnessPlugin(
      api as unknown as Parameters<typeof registerStellaFitnessPlugin>[0],
    );
    expect(runtime?.preflight().readiness).toBe("READY");

    openclawConfig.plugins.entries["stella-fitness"]!.config = undefined;

    expect(runtime?.preflight()).toMatchObject({
      readiness: "BLOCKED_CONFIGURATION",
      reasons: [
        expect.objectContaining({ code: "PERSONAL_DATA_DIRECTORY_REQUIRED" }),
      ],
    });
  });
});

function compatibleApi(options: {
  commands: Array<Record<string, unknown>>;
  hooks: Map<string, (...args: unknown[]) => unknown>;
  cliRegistrations: Array<Record<string, unknown>>;
  pluginConfig?: Record<string, unknown>;
  openclawConfig?: TestOpenClawConfig;
  extractStructuredWithModel?: ReturnType<typeof vi.fn>;
}) {
  const stateRoot = temporaryRoot();
  const openclawConfig = options.openclawConfig ?? permittedOpenClawConfig();
  if (options.pluginConfig !== undefined) {
    openclawConfig.plugins.entries["stella-fitness"]!.config =
      options.pluginConfig;
  }
  return {
    id: "stella-fitness",
    registrationMode: "full",
    config: openclawConfig,
    pluginConfig: options.pluginConfig,
    runtime: {
      version: "2026.6.34",
      config: {
        current: () => openclawConfig,
      },
      state: {
        resolveStateDir: () => stateRoot,
      },
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

type TestOpenClawConfig = {
  agents?: ReturnType<typeof allowedModelConfig>["agents"];
  plugins: {
    entries: {
      "stella-fitness": {
        hooks: { allowConversationAccess: boolean };
        config: Record<string, unknown> | undefined;
      };
    };
  };
};

function permittedOpenClawConfig(options?: {
  allowModel?: boolean;
}): TestOpenClawConfig {
  return {
    ...(options?.allowModel ? allowedModelConfig() : {}),
    plugins: {
      entries: {
        "stella-fitness": {
          hooks: { allowConversationAccess: true },
          config: {},
        },
      },
    },
  };
}

function configuredPersonalDirectory(): { personalDataDirectory: string } {
  const personalDataDirectory = join(temporaryRoot(), "personal");
  mkdirSync(personalDataDirectory);
  return { personalDataDirectory };
}

function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "stella-plugin-test-"));
  temporaryRoots.push(root);
  return root;
}
