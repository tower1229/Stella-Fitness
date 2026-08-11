import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import plugin, { registerStellaFitnessPlugin } from "../src/plugin.js";
import { rawMediaUploadFixture } from "./support/sanitized-media.js";
import { workoutLogCandidate } from "./support/workout-log-candidate.js";

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

  it("registers an explicit two-step Program setup command", async () => {
    const commands: Array<Record<string, unknown>> = [];
    const personalDataDirectory = configuredPersonalDirectory();
    const api = compatibleApi({
      commands,
      hooks: new Map(),
      cliRegistrations: [],
      pluginConfig: personalDataDirectory,
      openclawConfig: permittedOpenClawConfig(),
    });
    registerStellaFitnessPlugin(
      api as unknown as Parameters<typeof registerStellaFitnessPlugin>[0],
    );
    const setupCommand = commands.find(
      (candidate) => candidate.name === "stella-setup",
    );
    const requestConversationBinding = vi.fn().mockResolvedValue({
      status: "bound",
      binding: { bindingId: "stella-binding-1" },
    });
    const handler = setupCommand?.handler as (context: {
      args?: string;
      requestConversationBinding: typeof requestConversationBinding;
    }) => Promise<{ text: string }>;

    await expect(
      handler({
        args: `select ${programFixturePath()}`,
        requestConversationBinding,
      }),
    ).resolves.toMatchObject({
      text: expect.stringContaining("ProgramSpec selected: zhuoshu-12-week@0.2.0"),
    });
    await expect(
      handler({ args: "confirm 2026-08-10", requestConversationBinding }),
    ).resolves.toMatchObject({
      text: expect.stringMatching(
        /Program State initialized:.+\n.+\n.+\nconversation-binding: active/su,
      ),
    });
    expect(requestConversationBinding).toHaveBeenCalledWith({
      summary: "Stella Fitness workout recording",
      detachHint:
        "Detach the Stella Fitness conversation binding to stop recording here.",
      data: { workflow: "workout-recording" },
    });

    const state = JSON.parse(
      readFileSync(
        join(personalDataDirectory.personalDataDirectory, "program", "state.json"),
        "utf8",
      ),
    );
    expect(state).toMatchObject({
      schemaVersion: "stella-fitness/program-state/v0.2",
      program: { id: "zhuoshu-12-week", version: "0.2.0" },
      cycle: { startDate: "2026-08-10" },
    });
  });

  it("claims clear body-weight text and returns only the recorded facts", async () => {
    const hooks = new Map<string, (...args: unknown[]) => unknown>();
    const personalDataDirectory = configuredPersonalDirectory();
    const api = compatibleApi({
      commands: [],
      hooks,
      cliRegistrations: [],
      pluginConfig: personalDataDirectory,
      openclawConfig: permittedOpenClawConfig(),
    });
    registerStellaFitnessPlugin(
      api as unknown as Parameters<typeof registerStellaFitnessPlugin>[0],
    );

    const handled = await hooks.get("before_agent_reply")?.(
      { cleanedBody: "今天体重 68.4 kg" },
      { messageProvider: "test-channel" },
    );

    expect(handled).toMatchObject({
      handled: true,
      reply: {
        text: expect.stringMatching(
          /^Body weight recorded: 68\.4 kg\noccurred-at: .+\nobservation: [0-9a-f-]{36}\ntimeline:\n- .+ 68\.4 kg$/,
        ),
      },
    });
    expect(JSON.stringify(handled)).not.toMatch(
      /trend|ideal|training adjustment|nutrition|health conclusion/i,
    );
    expect(
      readdirSync(
        join(
          personalDataDirectory.personalDataDirectory,
          "observations",
          "body-weight",
        ),
      ),
    ).toHaveLength(1);
    await expect(
      hooks.get("before_agent_run")?.({ prompt: "今天体重 68.4 kg" }),
    ).resolves.toEqual({
      outcome: "block",
      reason: "stella-body-weight-is-plugin-owned",
      message: "Body-weight recording is handled by Stella Fitness.",
      category: "plugin-command",
    });
  });

  it("claims an explicit body-weight correction and preserves lineage", async () => {
    const hooks = new Map<string, (...args: unknown[]) => unknown>();
    const personalDataDirectory = configuredPersonalDirectory();
    const api = compatibleApi({
      commands: [],
      hooks,
      cliRegistrations: [],
      pluginConfig: personalDataDirectory,
      openclawConfig: permittedOpenClawConfig(),
    });
    registerStellaFitnessPlugin(
      api as unknown as Parameters<typeof registerStellaFitnessPlugin>[0],
    );
    const replyHook = hooks.get("before_agent_reply")!;
    await replyHook({ cleanedBody: "今天体重 68.4 kg" }, {});
    const directory = join(
      personalDataDirectory.personalDataDirectory,
      "observations",
      "body-weight",
    );
    const originalId = readdirSync(directory)[0]!.replace(/\.json$/u, "");

    const handled = await replyHook(
      {
        cleanedBody: `2026-08-09T07:00:00+08:00 纠正体重 ${originalId} 为 67.9 kg`,
      },
      {},
    );

    expect(handled).toMatchObject({
      handled: true,
      reply: {
        text: expect.stringMatching(
          /^Body weight corrected: 67\.9 kg\n.+\ntimeline:\n- 2026-08-08T23:00:00\.000Z 67\.9 kg$/,
        ),
      },
    });
    const observations = readdirSync(directory).map((file) =>
      JSON.parse(readFileSync(join(directory, file), "utf8")),
    );
    expect(observations).toHaveLength(2);
    expect(observations).toContainEqual(
      expect.objectContaining({
        value: { amount: 67.9, unit: "kg" },
        provenance: {
          kind: "body-weight-correction",
          recordedAt: expect.any(String),
          replacesObservationId: originalId,
        },
      }),
    );
  });

  it("does not claim or persist a body-weight evaluation question", async () => {
    const hooks = new Map<string, (...args: unknown[]) => unknown>();
    const personalDataDirectory = configuredPersonalDirectory();
    const api = compatibleApi({
      commands: [],
      hooks,
      cliRegistrations: [],
      pluginConfig: personalDataDirectory,
      openclawConfig: permittedOpenClawConfig(),
    });
    registerStellaFitnessPlugin(
      api as unknown as Parameters<typeof registerStellaFitnessPlugin>[0],
    );
    const input = "体重 68.4 kg 健康吗，要调整训练或饮食吗？";

    await expect(
      hooks.get("before_agent_reply")?.({ cleanedBody: input }, {}),
    ).resolves.toBeUndefined();
    await expect(
      hooks.get("before_agent_run")?.({ prompt: input }),
    ).resolves.toEqual({ outcome: "pass" });
    expect(readdirSync(personalDataDirectory.personalDataDirectory)).toEqual([]);
  });

  it("connects configured Plugin runtime to OpenClaw structured extraction", async () => {
    const extractStructuredWithModel = vi.fn().mockResolvedValue({
      text: '{"stage":1}',
      parsed: workoutLogCandidate(),
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
    const output = await runtime?.ingestWorkoutLog({
      runId: "plugin-run-1",
      upload: rawMediaUploadFixture(),
      timeoutMs: 2_000,
      signal: new AbortController().signal,
    });

    expect(output).toMatchObject({
      status: "recorded",
      execution: {
        provider: "operator-provider",
        model: "operator-model",
      },
    });
    expect(extractStructuredWithModel).toHaveBeenCalledOnce();
  });

  it("claims an inbound workout-log image and returns the recorded Observation", async () => {
    const hooks = new Map<string, (...args: unknown[]) => unknown>();
    const commands: Array<Record<string, unknown>> = [];
    const personalDataDirectory = configuredPersonalDirectory();
    const mediaPath = join(
      personalDataDirectory.personalDataDirectory,
      "inbound-workout.png",
    );
    writeFileSync(mediaPath, rawMediaUploadFixture().bytes);
    const extractStructuredWithModel = vi.fn().mockResolvedValue({
      parsed: workoutLogCandidate(),
      provider: "operator-provider",
      model: "operator-model",
      contentType: "json",
    });
    const api = compatibleApi({
      commands,
      hooks,
      cliRegistrations: [],
      pluginConfig: {
        ...personalDataDirectory,
        extraction: {
          provider: "operator-provider",
          model: "operator-model",
        },
      },
      openclawConfig: permittedOpenClawConfig({ allowModel: true }),
      extractStructuredWithModel,
    });
    registerStellaFitnessPlugin(
      api as unknown as Parameters<typeof registerStellaFitnessPlugin>[0],
    );

    await expect(
      hooks.get("inbound_claim")?.(
        {
          content: "看看这张照片",
          channel: "test-channel",
          messageId: "ordinary-image-message",
          metadata: { mediaPath, mediaType: "image/png" },
        },
        {},
      ),
    ).resolves.toBeUndefined();
    expect(extractStructuredWithModel).not.toHaveBeenCalled();

    const result = await hooks.get("inbound_claim")?.(
      {
        content: "记录训练",
        channel: "test-channel",
        timestamp: Date.parse("2026-08-10T08:00:00.000Z"),
        messageId: "workout-message-1",
        runId: "workout-hook-run-1",
        metadata: { mediaPath, mediaType: "image/png" },
      },
      {},
    );

    expect(result).toMatchObject({
      handled: true,
      reply: {
        text: expect.stringMatching(
          /^Workout recorded: stage 1, week 1, monday, full-body\nobservation: [0-9a-f-]{36}$/u,
        ),
      },
    });
    expect(extractStructuredWithModel).toHaveBeenCalledOnce();
    expect(
      readdirSync(
        join(
          personalDataDirectory.personalDataDirectory,
          "observations",
          "workout-log",
        ),
      ),
    ).toHaveLength(1);
  });

  it("exposes only uncertain image fields through the confirmation command", async () => {
    const hooks = new Map<string, (...args: unknown[]) => unknown>();
    const commands: Array<Record<string, unknown>> = [];
    const personalDataDirectory = configuredPersonalDirectory();
    const mediaPath = join(
      personalDataDirectory.personalDataDirectory,
      "uncertain-workout.png",
    );
    writeFileSync(mediaPath, rawMediaUploadFixture().bytes);
    const candidate = workoutLogCandidate() as unknown as {
      exercises: Array<{
        load: { value: unknown; confidence: "high" | "low" };
      }>;
      uncertainFields: Array<{
        path: string;
        kind: "unknown" | "low-confidence" | "conflict";
        candidates?: string[];
      }>;
    };
    candidate.exercises[0]!.load = { value: null, confidence: "high" };
    candidate.uncertainFields = [
      {
        path: "exercises[0].load.value",
        kind: "conflict",
        candidates: ["20 kg", "25 kg"],
      },
    ];
    const api = compatibleApi({
      commands,
      hooks,
      cliRegistrations: [],
      pluginConfig: {
        ...personalDataDirectory,
        extraction: {
          provider: "operator-provider",
          model: "operator-model",
        },
      },
      openclawConfig: permittedOpenClawConfig({ allowModel: true }),
      extractStructuredWithModel: vi.fn().mockResolvedValue({
        parsed: candidate,
        provider: "operator-provider",
        model: "operator-model",
        contentType: "json",
      }),
    });
    registerStellaFitnessPlugin(
      api as unknown as Parameters<typeof registerStellaFitnessPlugin>[0],
    );

    const pending = await hooks.get("inbound_claim")?.(
      {
        content: "训练日志",
        channel: "test-channel",
        messageId: "workout-message-2",
        runId: "workout-hook-run-2",
        metadata: { mediaPath, mediaType: "image/png" },
      },
      {},
    );
    const pendingText = (pending as { reply: { text: string } }).reply.text;
    expect(pendingText).toContain(
      "- exercises[0].load.value (conflict): 20 kg / 25 kg",
    );
    const confirmationId = /Workout log needs confirmation: ([0-9a-f-]{36})/u.exec(
      pendingText,
    )?.[1];
    const command = commands.find(({ name }) => name === "stella-confirm");
    const handler = command?.handler as (context: {
      args?: string;
    }) => Promise<{ text: string }>;

    await expect(
      handler({
        args: `${confirmationId} {"exercises[0].load.value":{"kind":"kg","value":25,"unit":"kg","raw":"25"}}`,
      }),
    ).resolves.toMatchObject({
      text: expect.stringMatching(
        /^Workout recorded: stage 1, week 1, monday, full-body\nobservation: [0-9a-f-]{36}$/u,
      ),
    });
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
      runtime?.ingestWorkoutLog({
        runId: "plugin-unconfigured",
        upload: rawMediaUploadFixture(),
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
      runtime?.ingestWorkoutLog({
        runId: "plugin-denied-model",
        upload: rawMediaUploadFixture(),
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
      runtime?.ingestWorkoutLog({
        runId: "plugin-missing-media",
        upload: rawMediaUploadFixture(),
        timeoutMs: 2_000,
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow("STRUCTURED_MEDIA_REQUIRED");
    expect(commands.map(({ name }) => name)).toEqual([
      "stella-status",
      "stella-setup",
      "stella-confirm",
    ]);
  });

  it("accepts corrected configuration after rerunning preflight", async () => {
    const extractStructuredWithModel = vi.fn().mockResolvedValue({
      text: '{"stage":1}',
      parsed: workoutLogCandidate(),
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
      runtime?.ingestWorkoutLog({
        runId: "plugin-corrected",
        upload: rawMediaUploadFixture(),
        timeoutMs: 2_000,
        signal: new AbortController().signal,
      }),
    ).resolves.toMatchObject({ status: "recorded" });
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
    registerService() {},
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

function programFixturePath(): string {
  return new URL(
    "../knowledge/programs/zhuoshu-12-week/program-spec.v0.2.yaml",
    import.meta.url,
  ).pathname;
}

function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "stella-plugin-test-"));
  temporaryRoots.push(root);
  return root;
}
