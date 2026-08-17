import { createHash } from "node:crypto";
import {
  existsSync,
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
  "Stella Fitness: READY_FOR_SETUP\ncontract: openclaw>=2026.6.34\nscope: recording-only\ntechnical-readiness: personal-data-directory: ready - Personal Data Directory is readable and writable\ntechnical-readiness: conversation: ready - Plugin conversation hook access is enabled\ntechnical-readiness: media: ready - OpenClaw structured media extraction is available\ntechnical-readiness: model-permission: setup-required - Configure an allowlisted extraction provider and model\nreason: EXTRACTION_MODEL_REQUIRED: Configure an allowlisted extraction provider and model";

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
      hooks.get("before_agent_reply")?.(
        { cleanedBody: "stella status" },
        { sessionKey: "agent:fitness:webchat:status" },
      ),
    ).resolves.toEqual({
      handled: true,
      reply: { text: READY_FOR_SETUP_STATUS },
    });
    await expect(
      hooks.get("before_agent_run")?.(
        { prompt: "stella status" },
        { sessionKey: "agent:fitness:webchat:status" },
      ),
    ).resolves.toEqual({
      outcome: "block",
      reason: "stella-status-is-plugin-owned",
      message: READY_FOR_SETUP_STATUS,
      category: "plugin-command",
    });
    await expect(hooks.get("before_agent_reply")?.(
      { cleanedBody: "给出本周训练计划" },
      { sessionKey: "agent:fitness:webchat:week-before-activation" },
    )).resolves.toMatchObject({
      handled: true,
      reply: {
        text: expect.stringContaining("journey: PREREQUISITES_REQUIRED"),
      },
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

  it("starts the Built-in Program journey from the configured dedicated agent without conversation binding", async () => {
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
    const startCommand = commands.find(
      (candidate) => candidate.name === "stella-start",
    );
    const handler = startCommand?.handler as (context: {
      args?: string;
      channel: string;
      commandBody: string;
      isAuthorizedSender: boolean;
      sessionKey: string;
    }) => Promise<{ text: string }>;

    await expect(
      handler({
        channel: "webchat",
        commandBody: "/stella-start",
        isAuthorizedSender: true,
        sessionKey: "agent:fitness:webchat:test-start",
      }),
    ).resolves.toMatchObject({
      text: expect.stringMatching(/zhuoshu-12-week@0\.2\.0.+PREREQUISITES_REQUIRED/su),
    });

    const setup = JSON.parse(
      readFileSync(
        join(personalDataDirectory.personalDataDirectory, "program", "setup.json"),
        "utf8",
      ),
    );
    expect(setup).toMatchObject({
      schemaVersion: "stella-fitness/program-setup/v0.1",
      prerequisiteAcknowledgements: {},
    });
    expect(commands.map(({ name }) => name)).not.toContain("stella-setup");
  });

  it("does not let a Journey command write outside the configured dedicated agent", async () => {
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
    const command = commands.find(({ name }) => name === "stella-prerequisite");
    const handler = command?.handler as (context: {
      args: string;
      channel: string;
      commandBody: string;
      isAuthorizedSender: boolean;
      sessionKey: string;
    }) => Promise<unknown>;

    await expect(handler({
      args: "adjustable-dumbbells",
      channel: "test",
      commandBody: "/stella-prerequisite adjustable-dumbbells",
      isAuthorizedSender: true,
      sessionKey: "agent:main:webchat:wrong-agent",
    })).resolves.toEqual({
      text: "agent-scope: unavailable (Use Stella Fitness from its configured dedicated agent.)",
    });
    expect(readdirSync(personalDataDirectory.personalDataDirectory)).toEqual([]);
  });

  it("offers the full built-in workbook as a WebChat download without requiring Program activation", async () => {
    const commands: Array<Record<string, unknown>> = [];
    const httpRoutes: Array<Record<string, unknown>> = [];
    const personalDataDirectory = configuredPersonalDirectory();
    const routeApi = compatibleApi({
      commands: [],
      hooks: new Map(),
      cliRegistrations: [],
      httpRoutes,
      pluginConfig: personalDataDirectory,
      openclawConfig: permittedOpenClawConfig(),
    });
    registerStellaFitnessPlugin(
      routeApi as unknown as Parameters<typeof registerStellaFitnessPlugin>[0],
    );
    const commandApi = compatibleApi({
      commands,
      hooks: new Map(),
      cliRegistrations: [],
      pluginConfig: personalDataDirectory,
      openclawConfig: permittedOpenClawConfig(),
    });
    registerStellaFitnessPlugin(
      commandApi as unknown as Parameters<typeof registerStellaFitnessPlugin>[0],
    );
    const command = commands.find(({ name }) => name === "stella-print");
    const handler = command?.handler as (context: {
      channel: string;
      commandBody: string;
      isAuthorizedSender: boolean;
      sessionKey: string;
    }) => Promise<unknown>;

    expect(command).toMatchObject({
      name: "stella-print",
      acceptsArgs: false,
      requireAuth: true,
    });
    const response = await handler({
      channel: "webchat",
      commandBody: "/stella-print",
      isAuthorizedSender: true,
      sessionKey: "agent:fitness:webchat:print",
    });
    expect(response).toEqual({
      text: expect.stringMatching(
        /^完整 12 周训练日志工作簿\n\[下载 zhuoshu-workout-log\.xlsx\]\(\/plugins\/stella-fitness\/printable-log\/[0-9a-f-]+\/zhuoshu-workout-log\.xlsx\)$/u,
      ),
    });
    expect(httpRoutes).toContainEqual(expect.objectContaining({
      path: "/plugins/stella-fitness/printable-log/",
      auth: "plugin",
      match: "prefix",
    }));
    const downloadUrl = /\]\(([^)]+)\)$/u.exec(
      (response as { text: string }).text,
    )?.[1];
    expect(downloadUrl).toBeDefined();
    const route = httpRoutes[0] as {
      handler: (
        request: { method: string; url: string },
        response: {
          statusCode?: number;
          setHeader(name: string, value: string): void;
          end(body?: Buffer): void;
        },
      ) => Promise<boolean>;
    };
    const headers = new Map<string, string>();
    let body: Buffer | undefined;
    const downloadResponse: {
      statusCode?: number;
      setHeader(name: string, value: string): void;
      end(value?: Buffer): void;
    } = {
      setHeader(name, value) {
        headers.set(name.toLowerCase(), value);
      },
      end(value) {
        body = value;
      },
    };
    await route.handler(
      { method: "GET", url: downloadUrl! },
      downloadResponse,
    );
    expect(downloadResponse.statusCode).toBe(200);
    expect(headers.get("content-disposition")).toBe(
      'attachment; filename="zhuoshu-workout-log.xlsx"',
    );
    expect(headers.get("content-type")).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    expect(body).toBeDefined();
    expect(createHash("sha256").update(body!).digest("hex")).toBe(
      "a113a16f9844ceb518307369bd45979af3aa703e67da8eb3bbb6b5e991aebcca",
    );
    expect(readdirSync(personalDataDirectory.personalDataDirectory)).toEqual([]);
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

    await expect(hooks.get("before_agent_reply")?.(
      { cleanedBody: "今天体重 68.4 kg" },
      { sessionKey: "agent:main:webchat:wrong-agent" },
    )).resolves.toBeUndefined();
    expect(readdirSync(personalDataDirectory.personalDataDirectory)).toEqual([]);

    const handled = await hooks.get("before_agent_reply")?.(
      { cleanedBody: "今天体重 68.4 kg" },
      {
        messageProvider: "test-channel",
        sessionKey: "agent:fitness:webchat:body-weight",
      },
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
    expect(
      readdirSync(personalDataDirectory.personalDataDirectory),
    ).toContain("program");
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
    await replyHook(
      { cleanedBody: "今天体重 68.4 kg" },
      { sessionKey: "agent:fitness:webchat:correction" },
    );
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
      { sessionKey: "agent:fitness:webchat:correction" },
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

  it("refuses a body-weight evaluation question without persisting it", async () => {
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
      hooks.get("before_agent_run")?.(
        { prompt: input },
        { sessionKey: "agent:fitness:webchat:evaluation" },
      ),
    ).resolves.toMatchObject({
      outcome: "block",
      reason: "stella-dedicated-input-is-plugin-owned",
      message: expect.stringContaining("does not diagnose, advise or adjust"),
    });
    expect(readdirSync(personalDataDirectory.personalDataDirectory)).toEqual([
      "program",
    ]);
  });

  it("claims Journey input only from the configured dedicated agent without plugin binding", async () => {
    const hooks = new Map<string, (...args: unknown[]) => unknown>();
    const directories = configuredPersonalDirectory();
    const api = compatibleApi({
      commands: [],
      hooks,
      cliRegistrations: [],
      pluginConfig: directories,
      openclawConfig: permittedOpenClawConfig(),
    });
    registerStellaFitnessPlugin(
      api as unknown as Parameters<typeof registerStellaFitnessPlugin>[0],
    );
    const event = {
      content: "/stella-prerequisite adjustable-dumbbells",
      channel: "webchat",
      messageId: "dedicated-agent-command",
      timestamp: "2026-08-14T03:00:00.000Z",
      isGroup: false,
    };

    await expect(hooks.get("inbound_claim")?.(
      event,
      { sessionKey: "agent:main:webchat:wrong-agent" },
    )).resolves.toBeUndefined();
    await expect(hooks.get("inbound_claim")?.(
      event,
      { sessionKey: "agent:fitness:webchat:dedicated-agent" },
    )).resolves.toMatchObject({
      handled: true,
      reply: { text: expect.stringContaining("pull-up-bar") },
    });
  });

  it("claims pre-routing Telegram input only when the channel routes to the dedicated agent", async () => {
    const hooks = new Map<string, (...args: unknown[]) => unknown>();
    const directories = configuredPersonalDirectory();
    const openclawConfig = permittedOpenClawConfig();
    openclawConfig.bindings = [{
      agentId: "fitness",
      match: { channel: "telegram", accountId: "default" },
    }];
    const api = compatibleApi({
      commands: [],
      hooks,
      cliRegistrations: [],
      pluginConfig: directories,
      openclawConfig,
    });
    registerStellaFitnessPlugin(
      api as unknown as Parameters<typeof registerStellaFitnessPlugin>[0],
    );

    await expect(hooks.get("inbound_claim")?.(
      {
        content: "我已准备好可拆卸哑铃",
        channel: "telegram",
        accountId: "default",
        messageId: "pre-routing-prerequisite",
        timestamp: "2026-08-14T03:00:00.000Z",
      },
      { channelId: "515151" },
    )).resolves.toMatchObject({
      handled: true,
      reply: { text: expect.stringContaining("pull-up-bar") },
    });
  });

  it("claims dedicated-agent natural-language Journey input before model execution", async () => {
    const hooks = new Map<string, (...args: unknown[]) => unknown>();
    const directories = configuredPersonalDirectory();
    const api = compatibleApi({
      commands: [],
      hooks,
      cliRegistrations: [],
      pluginConfig: directories,
      openclawConfig: permittedOpenClawConfig(),
    });
    registerStellaFitnessPlugin(
      api as unknown as Parameters<typeof registerStellaFitnessPlugin>[0],
    );

    await expect(hooks.get("before_agent_reply")?.(
      { cleanedBody: "我已准备好可拆卸哑铃" },
      {
        agentId: "fitness",
        messageProvider: "telegram",
        runId: "natural-prerequisite-run",
      },
    )).resolves.toMatchObject({
      handled: true,
      reply: { text: expect.stringContaining("pull-up-bar") },
    });
  });

  it("handles dedicated-agent Journey input at the run gate when the reply hook is skipped", async () => {
    const hooks = new Map<string, (...args: unknown[]) => unknown>();
    const directories = configuredPersonalDirectory();
    const api = compatibleApi({
      commands: [],
      hooks,
      cliRegistrations: [],
      pluginConfig: directories,
      openclawConfig: permittedOpenClawConfig(),
    });
    registerStellaFitnessPlugin(
      api as unknown as Parameters<typeof registerStellaFitnessPlugin>[0],
    );

    await expect(hooks.get("before_agent_run")?.(
      { prompt: "我已准备好可拆卸哑铃" },
      {
        agentId: "fitness",
        messageProvider: "telegram",
        runId: "run-gate-prerequisite",
      },
    )).resolves.toMatchObject({
      outcome: "block",
      reason: "stella-dedicated-input-is-plugin-owned",
      message: expect.stringContaining("pull-up-bar"),
    });
  });

  it("persists the same clear 12RM batch at the run gate", async () => {
    const hooks = new Map<string, (...args: unknown[]) => unknown>();
    const directories = configuredPersonalDirectory();
    registerStellaFitnessPlugin(
      compatibleApi({
        commands: [],
        hooks,
        cliRegistrations: [],
        pluginConfig: directories,
        openclawConfig: permittedOpenClawConfig(),
      }) as unknown as Parameters<typeof registerStellaFitnessPlugin>[0],
    );
    const run = hooks.get("before_agent_run")!;
    const context = { agentId: "fitness", messageProvider: "webchat" };
    for (const [index, prompt] of [
      "我已准备好可拆卸哑铃",
      "我已准备好引体向上杆",
      "我已打印训练日志",
      "我已了解训练记录协议",
      "体重 67 kg",
    ].entries()) {
      await expect(run(
        { prompt },
        { ...context, runId: `run-gate-batch-${index}` },
      )).resolves.toMatchObject({ outcome: "block" });
    }

    await expect(run({
      prompt: [
        "高脚杯深蹲 12RM 29 kg",
        "哑铃卧推 12RM 29 kg",
        "哑铃硬拉 12RM 29 kg",
      ].join("\n"),
    }, { ...context, runId: "run-gate-batch-12rm" })).resolves.toMatchObject({
      outcome: "block",
      message: expect.stringContaining("journey: READY_TO_ACTIVATE"),
    });
    expect(readdirSync(join(
      directories.personalDataDirectory,
      "observations",
      "special-session",
    ))).toHaveLength(3);
  });

  it("does not classify Host media markers or paths as dedicated-agent text", async () => {
    const hooks = new Map<string, (...args: unknown[]) => unknown>();
    const api = compatibleApi({
      commands: [],
      hooks,
      cliRegistrations: [],
      pluginConfig: configuredPersonalDirectory(),
      openclawConfig: permittedOpenClawConfig(),
    });
    registerStellaFitnessPlugin(
      api as unknown as Parameters<typeof registerStellaFitnessPlugin>[0],
    );

    await expect(hooks.get("before_agent_run")?.(
      {
        prompt: "[media attached: /tmp/training-adjustment.png (image/png)]\n训练日志",
      },
      { agentId: "fitness", messageProvider: "telegram" },
    )).resolves.toEqual({ outcome: "pass" });
  });

  it("routes a dedicated-agent baseline fact through Program Journey confirmation", async () => {
    const hooks = new Map<string, (...args: unknown[]) => unknown>();
    const directories = configuredPersonalDirectory();
    const api = compatibleApi({
      commands: [],
      hooks,
      cliRegistrations: [],
      pluginConfig: directories,
      openclawConfig: permittedOpenClawConfig(),
    });
    registerStellaFitnessPlugin(
      api as unknown as Parameters<typeof registerStellaFitnessPlugin>[0],
    );
    const replyHook = hooks.get("before_agent_reply")!;
    const context = {
      sessionKey: "agent:fitness:main",
      messageProvider: "telegram",
    };
    for (const [index, cleanedBody] of [
      "我已准备好可拆卸哑铃",
      "我已准备好引体向上杆",
      "我已打印训练日志",
      "我已了解训练记录协议",
    ].entries()) {
      await replyHook(
        { cleanedBody },
        { ...context, runId: `baseline-prerequisite-${index}` },
      );
    }

    await expect(replyHook(
      { cleanedBody: "体重 68.4" },
      { ...context, runId: "baseline-weight" },
    )).resolves.toMatchObject({
      handled: true,
      reply: {
        text: expect.stringMatching(
          /^Program Journey needs confirmation: [0-9a-f-]{36}\n- unit: 请确认体重单位：kg 还是 lb？/u,
        ),
      },
    });
  });

  it("refuses diagnosis and plan-adjustment questions in the dedicated agent", async () => {
    const hooks = new Map<string, (...args: unknown[]) => unknown>();
    const api = compatibleApi({
      commands: [],
      hooks,
      cliRegistrations: [],
      pluginConfig: configuredPersonalDirectory(),
      openclawConfig: permittedOpenClawConfig(),
    });
    registerStellaFitnessPlugin(
      api as unknown as Parameters<typeof registerStellaFitnessPlugin>[0],
    );

    await expect(
      hooks.get("inbound_claim")?.(
        {
          content: "体重没涨，我应该怎么调整饮食和训练？",
          channel: "test",
          isGroup: false,
        },
        { sessionKey: "agent:fitness:webchat:test" },
      ),
    ).resolves.toEqual({
      handled: true,
      reply: {
        text:
          "Stella Fitness only reports source-program, Program State and recorded facts; it does not diagnose, advise or adjust the plan.",
      },
    });
    await expect(
      hooks.get("inbound_claim")?.(
        {
          content: "今天练什么，腰疼需要调整吗？",
          channel: "test",
          isGroup: false,
        },
        { sessionKey: "agent:fitness:webchat:test" },
      ),
    ).resolves.toEqual({
      handled: true,
      reply: {
        text:
          "Stella Fitness only reports source-program, Program State and recorded facts; it does not diagnose, advise or adjust the plan.",
      },
    });
    await expect(
      hooks.get("inbound_claim")?.(
        {
          content: "你好，今天天气不错。",
          channel: "test",
          isGroup: false,
        },
        { sessionKey: "agent:fitness:webchat:test" },
      ),
    ).resolves.toBeUndefined();
    for (const content of [
      "碳水吃多少？",
      "能不能加一组？",
      "这个会不会有危险？",
      "这个问题 Stella 能回答吗？",
    ]) {
      await expect(
        hooks.get("inbound_claim")?.(
          { content, channel: "test", isGroup: false },
          { sessionKey: "agent:fitness:webchat:test" },
        ),
      ).resolves.toEqual({
        handled: true,
        reply: {
          text:
            "Stella Fitness only reports source-program, Program State and recorded facts; it does not diagnose, advise or adjust the plan.",
        },
      });
    }
    await expect(
      hooks.get("inbound_claim")?.(
        {
          content: "我的训练表现怎么样？",
          channel: "test",
          isGroup: false,
        },
        { sessionKey: "agent:fitness:webchat:test" },
      ),
    ).resolves.toEqual({
      handled: true,
      reply: {
        text:
          "Stella Fitness only reports source-program, Program State and recorded facts; it does not diagnose, advise or adjust the plan.",
      },
    });
    await expect(
      hooks.get("inbound_claim")?.(
        {
          content: "这个动作会伤腰吗，需要多休息吗？",
          channel: "test",
          isGroup: false,
        },
        { sessionKey: "agent:fitness:webchat:test" },
      ),
    ).resolves.toEqual({
      handled: true,
      reply: {
        text:
          "Stella Fitness only reports source-program, Program State and recorded facts; it does not diagnose, advise or adjust the plan.",
      },
    });
    await expect(
      hooks.get("inbound_claim")?.(
        {
          content: "/stella-prerequisite adjustable-dumbbells",
          channel: "test",
          isGroup: false,
        },
        { sessionKey: "agent:fitness:webchat:test" },
      ),
    ).resolves.toMatchObject({
      handled: true,
      reply: { text: expect.stringContaining("pull-up-bar") },
    });
  });

  it("claims dedicated-agent advice questions before model execution", async () => {
    const hooks = new Map<string, (...args: unknown[]) => unknown>();
    const api = compatibleApi({
      commands: [],
      hooks,
      cliRegistrations: [],
      pluginConfig: configuredPersonalDirectory(),
      openclawConfig: permittedOpenClawConfig(),
    });
    registerStellaFitnessPlugin(
      api as unknown as Parameters<typeof registerStellaFitnessPlugin>[0],
    );

    await expect(hooks.get("before_agent_reply")?.(
      { cleanedBody: "我应该怎么调整训练和饮食？" },
      { sessionKey: "agent:fitness:main", messageProvider: "telegram" },
    )).resolves.toEqual({
      handled: true,
      reply: {
        text: "Stella Fitness only reports source-program, Program State and recorded facts; it does not diagnose, advise or adjust the plan.",
      },
    });
  });

  it("advances prerequisite acknowledgements from controlled natural language in the dedicated agent", async () => {
    const hooks = new Map<string, (...args: unknown[]) => unknown>();
    const directories = configuredPersonalDirectory();
    const api = compatibleApi({
      commands: [],
      hooks,
      cliRegistrations: [],
      pluginConfig: directories,
      openclawConfig: permittedOpenClawConfig(),
    });
    registerStellaFitnessPlugin(
      api as unknown as Parameters<typeof registerStellaFitnessPlugin>[0],
    );
    const inbound = hooks.get("inbound_claim")!;
    const inputs = [
      "我已准备好可拆卸哑铃",
      "我已准备好引体向上杆",
      "我已打印训练日志",
      "我已了解训练记录协议",
    ];

    for (const [index, content] of inputs.entries()) {
      await expect(inbound(
        {
          content,
          channel: "test-channel",
          messageId: `natural-prerequisite-${index}`,
          timestamp: `2026-08-12T0${index}:00:00.000Z`,
          isGroup: false,
        },
        { sessionKey: "agent:fitness:webchat:test" },
      )).resolves.toMatchObject({ handled: true });
    }

    const setup = JSON.parse(readFileSync(
      join(directories.personalDataDirectory, "program", "setup.json"),
      "utf8",
    ));
    expect(setup.prerequisiteAcknowledgements).toMatchObject({
      "adjustable-dumbbells": {
        acknowledgedAt: "2026-08-12T00:00:00.000Z",
        idempotencyKey: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
        source: { channel: "test-channel", messageId: "natural-prerequisite-0" },
      },
      "pull-up-bar": expect.any(Object),
      "printed-workout-log": expect.any(Object),
      "recording-protocol": expect.any(Object),
    });
    await expect(inbound(
      {
        content: "我已了解训练记录协议",
        channel: "test-channel",
        messageId: "natural-prerequisite-3",
        timestamp: "2026-08-12T04:00:00.000Z",
        isGroup: false,
      },
      { sessionKey: "agent:fitness:webchat:test" },
    )).resolves.toMatchObject({ handled: true });
  });

  it("reaches READY_TO_ACTIVATE through baseline and three text 12RM facts in the dedicated agent", async () => {
    const hooks = new Map<string, (...args: unknown[]) => unknown>();
    const directories = configuredPersonalDirectory();
    const api = compatibleApi({
      commands: [],
      hooks,
      cliRegistrations: [],
      pluginConfig: directories,
      openclawConfig: permittedOpenClawConfig(),
    });
    registerStellaFitnessPlugin(
      api as unknown as Parameters<typeof registerStellaFitnessPlugin>[0],
    );
    const inbound = hooks.get("inbound_claim")!;
    const bound = { sessionKey: "agent:fitness:webchat:test" };
    const messages = [
      "我已准备好可拆卸哑铃",
      "我已准备好引体向上杆",
      "我已打印训练日志",
      "我已了解训练记录协议",
      "体重 150 lb",
      "高脚杯深蹲 12RM 32 kg",
      "哑铃卧推 12RM 24 kg",
      "哑铃硬拉 12RM 40 kg",
    ];

    let result: unknown;
    for (const [index, content] of messages.entries()) {
      result = await inbound({
        content,
        channel: "test-channel",
        messageId: `journey-message-${index}`,
        timestamp: `2026-08-12T0${index}:00:00.000Z`,
        isGroup: false,
      }, bound);
      expect(result).toMatchObject({ handled: true });
    }
    expect(result).toMatchObject({
      reply: {
        text: expect.stringContaining("journey: READY_TO_ACTIVATE"),
      },
    });
    const specialSessions = readdirSync(join(
      directories.personalDataDirectory,
      "observations",
      "special-session",
    )).map((file) => JSON.parse(readFileSync(join(
      directories.personalDataDirectory,
      "observations",
      "special-session",
      file,
    ), "utf8")));
    expect(specialSessions.map(({ exerciseId, result: recorded }) => [
      exerciseId,
      recorded.value,
    ]).sort(([left], [right]) => String(left).localeCompare(String(right)))).toEqual([
      ["dumbbell-bench-press", 24],
      ["dumbbell-deadlift", 40],
      ["goblet-squat", 32],
    ]);

    const deadlift = specialSessions.find(
      ({ exerciseId }) => exerciseId === "dumbbell-deadlift",
    );
    const deleted = await inbound({
      content: `/stella-12rm delete ${deadlift.id} confirm`,
      channel: "test-channel",
      messageId: "journey-delete-12rm",
      timestamp: "2026-08-12T08:00:00.000Z",
      isGroup: false,
    }, bound);
    expect(deleted).toMatchObject({
      handled: true,
      reply: { text: expect.stringContaining("journey: INITIAL_12RM_REQUIRED") },
    });
    expect(readdirSync(join(
      directories.personalDataDirectory,
      "observations",
      "special-session",
    ))).toHaveLength(4);
  });

  it("records a clear three-exercise 12RM message through the WebChat fallback hook", async () => {
    const hooks = new Map<string, (...args: unknown[]) => unknown>();
    const directories = configuredPersonalDirectory();
    registerStellaFitnessPlugin(
      compatibleApi({
        commands: [],
        hooks,
        cliRegistrations: [],
        pluginConfig: directories,
        openclawConfig: permittedOpenClawConfig(),
      }) as unknown as Parameters<typeof registerStellaFitnessPlugin>[0],
    );
    const reply = hooks.get("before_agent_reply")!;
    const context = {
      messageProvider: "webchat",
      sessionKey: "agent:fitness:webchat:batch-12rm",
    };
    for (const content of [
      "我已准备好可拆卸哑铃",
      "我已准备好引体向上杆",
      "我已打印训练日志",
      "我已了解训练记录协议",
      "体重 67 kg",
    ]) {
      await expect(reply({ cleanedBody: content }, context)).resolves.toMatchObject({
        handled: true,
      });
    }

    await expect(reply({
      cleanedBody: [
        "高脚杯深蹲 12RM 29 kg",
        "哑铃卧推 12RM 29 kg",
        "哑铃硬拉 12RM 29 kg",
      ].join("\n"),
    }, context)).resolves.toMatchObject({
      handled: true,
      reply: {
        text: expect.stringMatching(
          /Initial 12RM recorded:.+goblet-squat 29 kg.+dumbbell-bench-press 29 kg.+dumbbell-deadlift 29 kg.+journey: READY_TO_ACTIVATE/su,
        ),
      },
    });

    const setup = JSON.parse(readFileSync(
      join(directories.personalDataDirectory, "program", "setup.json"),
      "utf8",
    ));
    expect(Object.keys(setup.initial12RMObservationIds).sort()).toEqual([
      "dumbbell-bench-press",
      "dumbbell-deadlift",
      "goblet-squat",
    ]);
    expect(readdirSync(join(
      directories.personalDataDirectory,
      "observations",
      "special-session",
    ))).toHaveLength(3);
  });

  it("replays one batch idempotently after Plugin restart", async () => {
    const directories = configuredPersonalDirectory();
    const context = {
      messageProvider: "webchat",
      sessionKey: "agent:fitness:webchat:batch-replay",
    };
    const createHooks = () => {
      const hooks = new Map<string, (...args: unknown[]) => unknown>();
      registerStellaFitnessPlugin(
        compatibleApi({
          commands: [],
          hooks,
          cliRegistrations: [],
          pluginConfig: directories,
          openclawConfig: permittedOpenClawConfig(),
        }) as unknown as Parameters<typeof registerStellaFitnessPlugin>[0],
      );
      return hooks;
    };
    let hooks = createHooks();
    const reply = hooks.get("before_agent_reply")!;
    for (const content of [
      "我已准备好可拆卸哑铃",
      "我已准备好引体向上杆",
      "我已打印训练日志",
      "我已了解训练记录协议",
      "体重 67 kg",
    ]) {
      await reply({ cleanedBody: content }, context);
    }
    const batch = [
      "高脚杯深蹲 12RM 29 kg",
      "哑铃卧推 12RM 29 kg",
      "哑铃硬拉 12RM 29 kg",
    ].join("\n");
    await reply({ cleanedBody: batch }, context);
    const directory = join(
      directories.personalDataDirectory,
      "observations",
      "special-session",
    );
    const originalFiles = readdirSync(directory).sort();

    hooks = createHooks();
    await expect(hooks.get("before_agent_reply")?.(
      { cleanedBody: batch },
      context,
    )).resolves.toMatchObject({
      handled: true,
      reply: { text: expect.stringContaining("journey: READY_TO_ACTIVATE") },
    });
    expect(readdirSync(directory).sort()).toEqual(originalFiles);

    await expect(hooks.get("before_agent_reply")?.(
      { cleanedBody: batch.replaceAll("29 kg", "30 kg") },
      context,
    )).resolves.toMatchObject({
      handled: true,
      reply: { text: expect.stringContaining("No success was recorded") },
    });
    expect(readdirSync(directory).sort()).toEqual(originalFiles);
  });

  it("rejects an ambiguous 12RM batch without persisting any part of it", async () => {
    const hooks = new Map<string, (...args: unknown[]) => unknown>();
    const directories = configuredPersonalDirectory();
    registerStellaFitnessPlugin(
      compatibleApi({
        commands: [],
        hooks,
        cliRegistrations: [],
        pluginConfig: directories,
        openclawConfig: permittedOpenClawConfig(),
      }) as unknown as Parameters<typeof registerStellaFitnessPlugin>[0],
    );
    const reply = hooks.get("before_agent_reply")!;
    const context = {
      messageProvider: "webchat",
      sessionKey: "agent:fitness:webchat:ambiguous-batch",
    };
    for (const content of [
      "我已准备好可拆卸哑铃",
      "我已准备好引体向上杆",
      "我已打印训练日志",
      "我已了解训练记录协议",
      "体重 67 kg",
    ]) {
      await reply({ cleanedBody: content }, context);
    }

    await expect(reply({
      cleanedBody: [
        "高脚杯深蹲 12RM 29 kg",
        "哑铃卧推 12RM 29",
        "哑铃硬拉 12RM 29 kg",
      ].join("\n"),
    }, context)).resolves.toMatchObject({
      handled: true,
      reply: { text: expect.stringContaining("本批次未保存") },
    });
    await expect(reply({
      cleanedBody: [
        "高脚杯深蹲 12RM 29 kg",
        "哑铃卧推 12RM 29 kg",
        "哑铃硬拉 12RM 29 kg",
        "高脚杯深蹲 12RM 30 kg",
      ].join("\n"),
    }, context)).resolves.toMatchObject({
      handled: true,
      reply: { text: expect.stringContaining("最多记录三个") },
    });
    expect(existsSync(join(
      directories.personalDataDirectory,
      "observations",
      "special-session",
    ))).toBe(false);
  });

  it("records a due checkpoint through the same WebChat fallback hook", async () => {
    const hooks = new Map<string, (...args: unknown[]) => unknown>();
    const directories = configuredPersonalDirectory();
    registerStellaFitnessPlugin(
      compatibleApi({
        commands: [],
        hooks,
        cliRegistrations: [],
        pluginConfig: directories,
        openclawConfig: permittedOpenClawConfig(),
      }) as unknown as Parameters<typeof registerStellaFitnessPlugin>[0],
    );
    const inbound = hooks.get("inbound_claim")!;
    const bound = { sessionKey: "agent:fitness:webchat:checkpoint-fallback" };
    for (const [index, content] of [
      "我已准备好可拆卸哑铃",
      "我已准备好引体向上杆",
      "我已打印训练日志",
      "我已了解训练记录协议",
      "体重 68.4 kg",
      "高脚杯深蹲 12RM 32 kg",
      "哑铃卧推 12RM 24 kg",
      "哑铃硬拉 12RM 40 kg",
    ].entries()) {
      await inbound({
        content,
        channel: "webchat",
        messageId: `checkpoint-fallback-${index}`,
        timestamp: `2026-08-10T0${index}:00:00.000Z`,
        isGroup: false,
      }, bound);
    }
    await inbound({
      content: "/stella-activate 2026-08-10",
      channel: "webchat",
      messageId: "checkpoint-fallback-activate",
      timestamp: "2026-08-10T08:00:00.000Z",
      isGroup: false,
    }, bound);

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-07T08:00:00.000Z"));
    try {
      await expect(hooks.get("before_agent_reply")?.(
        { cleanedBody: "体重 69 kg" },
        {
          messageProvider: "webchat",
          runId: "checkpoint-fallback-run",
          sessionKey: "agent:fitness:webchat:checkpoint-fallback",
        },
      )).resolves.toMatchObject({
        handled: true,
        reply: {
          text: expect.stringContaining("Week 4 body weight recorded: 69 kg"),
        },
      });
    } finally {
      vi.useRealTimers();
    }

    const state = JSON.parse(readFileSync(
      join(directories.personalDataDirectory, "program", "state.json"),
      "utf8",
    ));
    expect(state.phaseCheckpointObservationIds).toMatchObject({
      "4": expect.any(String),
    });
  });

  it("activates with the first session and keeps all bound Program Facts deterministic after restart", async () => {
    const directories = configuredPersonalDirectory();
    const bound = { sessionKey: "agent:fitness:webchat:test" };
    const createHooks = () => {
      const hooks = new Map<string, (...args: unknown[]) => unknown>();
      registerStellaFitnessPlugin(
        compatibleApi({
          commands: [],
          hooks,
          cliRegistrations: [],
          pluginConfig: directories,
          openclawConfig: permittedOpenClawConfig(),
        }) as unknown as Parameters<typeof registerStellaFitnessPlugin>[0],
      );
      return hooks;
    };
    let hooks = createHooks();
    let inbound = hooks.get("inbound_claim")!;
    for (const [index, content] of [
      "我已准备好可拆卸哑铃",
      "我已准备好引体向上杆",
      "我已打印训练日志",
      "我已了解训练记录协议",
      "体重 68.4 kg",
      "高脚杯深蹲 12RM 32 kg",
      "哑铃卧推 12RM 24 kg",
      "哑铃硬拉 12RM 40 kg",
    ].entries()) {
      await inbound({
        content,
        channel: "test-channel",
        messageId: `activation-message-${index}`,
        timestamp: `2026-08-10T0${index}:00:00.000Z`,
        isGroup: false,
      }, bound);
    }

    const activation = await inbound({
      content: "/stella-activate 2026-08-10",
      channel: "test-channel",
      messageId: "activate",
      timestamp: "2026-08-10T08:00:00.000Z",
      isGroup: false,
    }, bound);
    expect(activation).toMatchObject({
      handled: true,
      reply: {
        text: expect.stringMatching(
          /Program State activated:.+today Planned Session: 2026-08-10.+rest:/su,
        ),
      },
    });

    await expect(inbound({
      content: "/stella-facts symbol goblet-squat A",
      channel: "test-channel",
      timestamp: "2026-08-10T08:01:00.000Z",
      isGroup: false,
    }, bound)).resolves.toMatchObject({
      handled: true,
      reply: { text: "goblet-squat A: 32 kg" },
    });
    await expect(inbound({
      content: "/stella-weight 69 kg",
      channel: "test-channel",
      messageId: "week-4-checkpoint",
      timestamp: "2026-09-07T08:00:00.000Z",
      isGroup: false,
    }, bound)).resolves.toMatchObject({
      handled: true,
      reply: { text: expect.stringContaining("checkpoint body weight recorded: 69 kg") },
    });
    await expect(inbound({
      content: "/stella-facts weight",
      channel: "test-channel",
      timestamp: "2026-09-07T08:01:00.000Z",
      isGroup: false,
    }, bound)).resolves.toMatchObject({
      handled: true,
      reply: {
        text: expect.stringMatching(
          /Weight Facts:.+baseline: 68\.4 kg.+current: 69 kg.+week-4: 69 kg.+toward-goal.+week-8: insufficient-data/su,
        ),
      },
    });
    await expect(inbound({
      content: "当前阶段、第几周、训练日、动作、组次、次数、持续时间和休息分别是什么？",
      channel: "test-channel",
      timestamp: "2026-08-10T08:02:00.000Z",
      isGroup: false,
    }, bound)).resolves.toMatchObject({
      handled: true,
      reply: {
        text: expect.stringMatching(
          /today Planned Session: 2026-08-10.+stage: phase-1, week: 1, day: monday.+rest:/su,
        ),
      },
    });
    await expect(inbound({
      content: "今天应该练什么？",
      channel: "test-channel",
      timestamp: "2026-08-10T08:02:30.000Z",
      isGroup: false,
    }, bound)).resolves.toMatchObject({
      handled: true,
      reply: { text: expect.stringContaining("today Planned Session: 2026-08-10") },
    });
    await expect(inbound({
      content: "给出本周训练计划",
      channel: "test-channel",
      timestamp: "2026-08-14T08:02:40.000Z",
      isGroup: false,
    }, bound)).resolves.toMatchObject({
      handled: true,
      reply: {
        text: expect.stringMatching(
          /week Planned Sessions: 2026-08-10 to 2026-08-16.+2026-08-10 monday.+type: full-body.+2026-08-11 tuesday: No Planned Session\..+2026-08-12 wednesday.+type: full-body.+2026-08-14 friday.+type: full-body.+2026-08-16 sunday: No Planned Session\./su,
        ),
      },
    });
    await expect(inbound({
      content: "/stella-facts week 2026-08-14",
      channel: "test-channel",
      timestamp: "2026-08-14T08:02:50.000Z",
      isGroup: false,
    }, bound)).resolves.toMatchObject({
      handled: true,
      reply: {
        text: expect.stringContaining(
          "week Planned Sessions: 2026-08-10 to 2026-08-16",
        ),
      },
    });
    await expect(inbound({
      content: "高脚杯深蹲当前 N 是多少？",
      channel: "test-channel",
      timestamp: "2026-08-10T08:03:00.000Z",
      isGroup: false,
    }, bound)).resolves.toMatchObject({
      handled: true,
      reply: { text: expect.stringContaining("goblet-squat N: binding pending") },
    });
    await expect(inbound({
      content: "我应该怎么调整训练和饮食？",
      channel: "test-channel",
      timestamp: "2026-08-10T08:04:00.000Z",
      isGroup: false,
    }, bound)).resolves.toEqual({
      handled: true,
      reply: {
        text: "Stella Fitness only reports source-program, Program State and recorded facts; it does not diagnose, advise or adjust the plan.",
      },
    });

    hooks = createHooks();
    inbound = hooks.get("inbound_claim")!;
    await expect(inbound({
      content: "下次练什么",
      channel: "test-channel",
      timestamp: "2026-08-10T09:00:00.000Z",
      isGroup: false,
    }, bound)).resolves.toMatchObject({
      handled: true,
      reply: { text: expect.stringContaining("next Planned Session: 2026-08-12") },
    });
    await expect(hooks.get("before_agent_run")?.(
      { prompt: "给出本周训练计划" },
      { agentId: "fitness", runId: "week-facts-run-gate" },
    )).resolves.toMatchObject({
      outcome: "block",
      reason: "stella-dedicated-input-is-plugin-owned",
      message: expect.stringMatching(
        /week Planned Sessions:.+monday.+tuesday: No Planned Session\./su,
      ),
    });
    await expect(hooks.get("before_agent_reply")?.(
      { cleanedBody: "给出本周训练计划" },
      { sessionKey: "agent:fitness:webchat:week-facts" },
    )).resolves.toMatchObject({
      handled: true,
      reply: {
        text: expect.stringMatching(
          /week Planned Sessions:.+monday.+tuesday: No Planned Session\./su,
        ),
      },
    });
  });

  it("does not resolve a persisted Journey confirmation outside the dedicated agent", async () => {
    const hooks = new Map<string, (...args: unknown[]) => unknown>();
    const directories = configuredPersonalDirectory();
    const api = compatibleApi({
      commands: [],
      hooks,
      cliRegistrations: [],
      pluginConfig: directories,
      openclawConfig: permittedOpenClawConfig(),
    });
    registerStellaFitnessPlugin(
      api as unknown as Parameters<typeof registerStellaFitnessPlugin>[0],
    );
    const inbound = hooks.get("inbound_claim")!;
    const bound = { sessionKey: "agent:fitness:webchat:test" };
    for (const [index, content] of [
      "我已准备好可拆卸哑铃",
      "我已准备好引体向上杆",
      "我已打印训练日志",
      "我已了解训练记录协议",
    ].entries()) {
      await inbound({
        content,
        channel: "test-channel",
        messageId: `confirmation-prerequisite-${index}`,
        timestamp: `2026-08-12T0${index}:00:00.000Z`,
        isGroup: false,
      }, bound);
    }
    const pending = await inbound({
      content: "体重 150",
      channel: "test-channel",
      messageId: "pending-baseline",
      timestamp: "2026-08-12T04:00:00.000Z",
      isGroup: false,
    }, bound) as { reply: { text: string } };
    const confirmationId = /Program Journey needs confirmation: ([0-9a-f-]{36})/u.exec(
      pending.reply.text,
    )?.[1];
    const confirmationEvent = {
      content: `/stella-confirm ${confirmationId} {"unit":"lb"}`,
      channel: "test-channel",
      messageId: "confirm-baseline-boundary",
      timestamp: "2026-08-12T04:05:00.000Z",
      isGroup: false,
    };

    await expect(inbound(confirmationEvent, {})).resolves.toBeUndefined();
    expect(existsSync(join(
      directories.personalDataDirectory,
      "observations",
      "body-weight",
    ))).toBe(false);
    await expect(inbound(confirmationEvent, bound)).resolves.toMatchObject({
      handled: true,
      reply: { text: expect.stringContaining("journey: INITIAL_12RM_REQUIRED") },
    });
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
        { sessionKey: "agent:fitness:webchat:test" },
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
      { sessionKey: "agent:fitness:webchat:test" },
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

  it("handles a routed workout-log image at reply_dispatch without Plugin binding", async () => {
    const hooks = new Map<string, (...args: unknown[]) => unknown>();
    const personalDataDirectory = configuredPersonalDirectory();
    const mediaPath = join(
      personalDataDirectory.personalDataDirectory,
      "routed-workout.png",
    );
    writeFileSync(mediaPath, rawMediaUploadFixture().bytes);
    const api = compatibleApi({
      commands: [],
      hooks,
      cliRegistrations: [],
      pluginConfig: {
        ...personalDataDirectory,
        extraction: { provider: "operator-provider", model: "operator-model" },
      },
      openclawConfig: permittedOpenClawConfig({ allowModel: true }),
      extractStructuredWithModel: vi.fn().mockResolvedValue({
        parsed: workoutLogCandidate(),
        provider: "operator-provider",
        model: "operator-model",
        contentType: "json",
      }),
    });
    registerStellaFitnessPlugin(
      api as unknown as Parameters<typeof registerStellaFitnessPlugin>[0],
    );

    await hooks.get("message_received")?.(
      {
        content: "训练日志",
        timestamp: Date.parse("2026-08-10T08:00:00.000Z"),
        messageId: "routed-workout",
        metadata: { mediaPath, mediaType: "image/png" },
      },
      {
        channelId: "telegram",
        sessionKey: "agent:fitness:telegram:direct:515151",
      },
    );
    const sendFinalReply = vi.fn().mockReturnValue(true);
    await expect(hooks.get("reply_dispatch")?.(
      {
        ctx: { BodyForAgent: "训练日志", Provider: "telegram" },
        sessionKey: "agent:fitness:telegram:direct:515151",
      },
      {
        dispatcher: {
          sendFinalReply,
          markComplete: vi.fn(),
          getQueuedCounts: () => ({ tool: 0, block: 0, final: 1 }),
        },
        recordProcessed: vi.fn(),
        markIdle: vi.fn(),
      },
    )).resolves.toMatchObject({
      handled: true,
      queuedFinal: true,
    });
    expect(sendFinalReply).toHaveBeenCalledWith({
      text: expect.stringMatching(/^Workout recorded:/u),
    });
  });

  it("asks the user to crop a multi-session workout-log page", async () => {
    const hooks = new Map<string, (...args: unknown[]) => unknown>();
    const personalDataDirectory = configuredPersonalDirectory();
    const mediaPath = join(
      personalDataDirectory.personalDataDirectory,
      "multi-session-workout.png",
    );
    writeFileSync(mediaPath, rawMediaUploadFixture().bytes);
    const api = compatibleApi({
      commands: [],
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
        parsed: {
          layout: "multi-session-page",
          reason: "multiple-session-blocks",
        },
        provider: "operator-provider",
        model: "operator-model",
        contentType: "json",
      }),
    });
    registerStellaFitnessPlugin(
      api as unknown as Parameters<typeof registerStellaFitnessPlugin>[0],
    );

    await expect(hooks.get("inbound_claim")?.({
      content: "记录训练",
      channel: "test-channel",
      messageId: "multi-session-message",
      metadata: { mediaPath, mediaType: "image/png" },
    }, { sessionKey: "agent:fitness:webchat:test" })).resolves.toMatchObject({
      handled: true,
      reply: {
        text: expect.stringContaining("crop the photo to exactly one session"),
      },
    });
  });

  it("confirms uncertain image fields through the dedicated agent", async () => {
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
      { sessionKey: "agent:fitness:webchat:test" },
    );
    const pendingText = (pending as { reply: { text: string } }).reply.text;
    expect(pendingText).toContain(
      "- exercises.0.load.value (conflict): 20 kg / 25 kg",
    );
    const confirmationId = /Workout log needs confirmation: ([0-9a-f-]{36})/u.exec(
      pendingText,
    )?.[1];
    const command = commands.find(({ name }) => name === "stella-confirm");
    const handler = command?.handler as (context: {
      args: string;
      channel: string;
      commandBody: string;
      isAuthorizedSender: boolean;
      sessionKey: string;
    }) => Promise<unknown>;
    const rawValues =
      '{"exercises.0.load.value":{"kind":"kg","value":25,"unit":"kg","raw":"25"}}';
    await expect(handler({
      args: `${confirmationId} ${rawValues}`,
      channel: "test-channel",
      commandBody: `/stella-confirm ${confirmationId} ${rawValues}`,
      isAuthorizedSender: true,
      sessionKey: "agent:fitness:webchat:test",
    })).resolves.toMatchObject({
      text: expect.stringMatching(
        /^Workout recorded: stage 1, week 1, monday, full-body\nobservation: [0-9a-f-]{36}$/u,
      ),
    });
  });

  it("routes an explicitly identified workout correction through image ingress", async () => {
    const hooks = new Map<string, (...args: unknown[]) => unknown>();
    const personalDataDirectory = configuredPersonalDirectory();
    const mediaPath = join(
      personalDataDirectory.personalDataDirectory,
      "workout-correction.png",
    );
    writeFileSync(mediaPath, rawMediaUploadFixture().bytes);
    const correctedCandidate = workoutLogCandidate();
    correctedCandidate.exercises[0]!.sets[0]!.value = 12;
    const extractStructuredWithModel = vi.fn()
      .mockResolvedValueOnce({
        parsed: workoutLogCandidate(),
        provider: "operator-provider",
        model: "operator-model",
      })
      .mockResolvedValueOnce({
        parsed: correctedCandidate,
        provider: "operator-provider",
        model: "operator-model",
      });
    const api = compatibleApi({
      commands: [],
      hooks,
      cliRegistrations: [],
      pluginConfig: {
        ...personalDataDirectory,
        extraction: { provider: "operator-provider", model: "operator-model" },
      },
      openclawConfig: permittedOpenClawConfig({ allowModel: true }),
      extractStructuredWithModel,
    });
    registerStellaFitnessPlugin(
      api as unknown as Parameters<typeof registerStellaFitnessPlugin>[0],
    );
    const inbound = hooks.get("inbound_claim")!;
    const original = await inbound(
      {
        content: "训练日志",
        channel: "test-channel",
        runId: "workout-correction-original",
        metadata: { mediaPath, mediaType: "image/png" },
      },
        { sessionKey: "agent:fitness:webchat:test" },
    ) as { reply: { text: string } };
    const originalId = /observation: ([0-9a-f-]{36})/u.exec(
      original.reply.text,
    )?.[1];

    const correction = await inbound(
      {
        content: `纠正训练记录 ${originalId}`,
        channel: "test-channel",
        runId: "workout-correction-reupload",
        metadata: { mediaPath, mediaType: "image/png" },
      },
      { sessionKey: "agent:fitness:webchat:test" },
    );

    expect(correction).toMatchObject({
      handled: true,
      reply: {
        text: expect.stringMatching(
          new RegExp(
            `^Workout corrected: stage 1, week 1, monday, full-body\\ncorrection: [0-9a-f-]{36} replaces: ${originalId}$`,
            "u",
          ),
        ),
      },
    });
    expect(extractStructuredWithModel).toHaveBeenCalledTimes(2);
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
      "stella-start",
      "stella-prerequisite",
      "stella-weight",
      "stella-12rm",
      "stella-activate",
      "stella-facts",
      "stella-print",
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

    expect(runtime?.preflight()).toMatchObject({ readiness: "READY", reasons: [] });
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
  httpRoutes?: Array<Record<string, unknown>>;
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
    registerHttpRoute(route: Record<string, unknown>) {
      options.httpRoutes?.push(route);
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
  bindings?: Array<{
    agentId: string;
    match: { channel: string; accountId?: string };
  }>;
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

function configuredPersonalDirectory(): {
  personalDataDirectory: string;
  dedicatedAgentId: string;
} {
  const personalDataDirectory = join(temporaryRoot(), "personal");
  mkdirSync(personalDataDirectory);
  return { personalDataDirectory, dedicatedAgentId: "fitness" };
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
