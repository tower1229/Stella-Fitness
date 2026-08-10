import { readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  definePluginEntry,
  type OpenClawConfig,
  type OpenClawPluginDefinition,
} from "openclaw/plugin-sdk/plugin-entry";
import { parse } from "yaml";

import { assertOperatorModelPermission } from "./contracts/openclaw.js";
import { createOpenClawExtractionRuntime } from "./extraction/openclaw.js";
import type { ExtractionRuntime } from "./extraction/runtime.js";
import {
  runConfigurationPreflight,
  type ConfigurationPreflightResult,
  type ExtractionPermission,
} from "./preflight.js";
import {
  createStellaFitnessRuntime,
  type StellaFitnessRuntime,
} from "./plugin-runtime.js";
import { createStatusResponse } from "./status.js";

const STATUS_INPUT = "stella status";
const PLUGIN_ID = "stella-fitness";
const BODY_WEIGHT_RECORDING_INPUT =
  /^\s*(?:(?:\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2}))?|今天|昨天|前天|today|yesterday)\s*)?(?:我\s*)?(?:记录\s*)?(?:体重|body\s*weight|weight)\s*(?:是|为|:|：)?\s*[+-]?\d+(?:\.\d+)?\s*(?:(?:kg|kgs?|lb|lbs?)\b|公斤|千克|磅)?(?:\s*(?:或|还是|or)\s*[+-]?\d+(?:\.\d+)?\s*(?:(?:kg|kgs?|lb|lbs?)\b|公斤|千克|磅)?)?\s*[。.!]?\s*$/iu;

const plugin: OpenClawPluginDefinition = definePluginEntry({
  id: "stella-fitness",
  name: "Stella Fitness",
  description:
    "Deterministic training-plan execution and recording without diagnosis or supervision",
  register(api) {
    registerStellaFitnessPlugin(api);
  },
});

export default plugin;

export function registerStellaFitnessPlugin(
  api: Parameters<NonNullable<OpenClawPluginDefinition["register"]>>[0],
): StellaFitnessRuntime | undefined {
  let statusText = () => "Stella Fitness status requires full runtime inspection";
  registerStatusCli(api, () => statusText());
  if (api.registrationMode === "cli-metadata") {
    return undefined;
  }

  const preflight = createPreflightRunner(api);
  statusText = () => createStatusResponse(preflight()).text;
  preflight();
  const stellaRuntime = createStellaFitnessRuntime({
    extractionRuntime: createCurrentExtractionRuntime(api),
    personalDataDirectory: () =>
      resolvePersonalDataDirectory(
        currentPluginConfig(currentOpenClawConfig(api)),
      ),
    runtimeDirectory: () =>
      join(api.runtime.state.resolveStateDir(process.env), PLUGIN_ID),
    preflight,
  });
  api.registerService({
    id: "stella-fitness-media-lifecycle",
    start() {},
    async stop() {
      await stellaRuntime.shutdown();
    },
  });

  api.registerCommand({
    name: "stella-status",
    description: "Show the deterministic Stella Fitness Plugin status",
    acceptsArgs: false,
    requireAuth: true,
    async handler() {
      return createStatusResponse(preflight());
    },
  });

  api.registerCommand({
    name: "stella-setup",
    description: "Select a ProgramSpec and confirm the cycle start date",
    acceptsArgs: true,
    requireAuth: true,
    async handler(context) {
      const input = parseSetupCommand(context.args);
      if (input.kind === "help") {
        return { text: setupHelp() };
      }
      if (input.kind === "select") {
        const setup = await stellaRuntime.selectProgram(
          parse(await readFile(input.programSpecPath, "utf8")),
        );
        return {
          text: [
            `ProgramSpec selected: ${setup.program.id}@${setup.program.version}`,
            `setup: ${setup.id}`,
            "Confirm the cycle start date with /stella-setup confirm YYYY-MM-DD",
          ].join("\n"),
        };
      }
      const state = await stellaRuntime.confirmCycleStart(input.cycleStart);
      return {
        text: [
          `Program State initialized: ${state.id}`,
          `program: ${state.program.id}@${state.program.version}`,
          `cycle-start: ${state.cycle.startDate}`,
        ].join("\n"),
      };
    },
  });

  api.on(
    "before_agent_reply",
    async (event, context) => {
      if (normalizeStatusInput(event.cleanedBody) === STATUS_INPUT) {
        return { handled: true, reply: createStatusResponse(preflight()) };
      }
      if (!isBodyWeightInput(event.cleanedBody)) {
        return;
      }
      const receivedAt = new Date().toISOString();
      const sourceIdentity = {
        ...(context.messageProvider === undefined
          ? {}
          : { channel: context.messageProvider }),
        ...(context.runId === undefined ? {} : { runId: context.runId }),
      };
      const source =
        Object.keys(sourceIdentity).length === 0
          ? {}
          : { source: sourceIdentity };
      const correctionId = bodyWeightCorrectionId(event.cleanedBody);
      const result =
        correctionId === undefined
          ? await stellaRuntime.recordBodyWeight({
              text: event.cleanedBody,
              receivedAt,
              ...source,
            })
          : await stellaRuntime.correctBodyWeight({
              replacesObservationId: correctionId,
              text: event.cleanedBody,
              receivedAt,
              ...source,
            });
      return {
        handled: true,
        reply: {
          text:
            result.status === "clarification"
              ? result.question
              : correctionId === undefined
                ? formatBodyWeightRecording(result)
                : formatBodyWeightCorrection(result),
        },
      };
    },
    { priority: 100, timeoutMs: 1_000 },
  );

  api.on(
    "before_agent_run",
    async (event) => {
      if (normalizeStatusInput(event.prompt) === STATUS_INPUT) {
        return {
          outcome: "block" as const,
          reason: "stella-status-is-plugin-owned",
          message: createStatusResponse(preflight()).text,
          category: "plugin-command",
        };
      }
      if (isBodyWeightInput(event.prompt)) {
        return {
          outcome: "block" as const,
          reason: "stella-body-weight-is-plugin-owned",
          message: "Body-weight recording is handled by Stella Fitness.",
          category: "plugin-command",
        };
      }
      return { outcome: "pass" as const };
    },
    { priority: 100, timeoutMs: 1_000 },
  );
  return stellaRuntime;
}

function normalizeStatusInput(input: string): string {
  return input.trim().toLowerCase().replaceAll(/\s+/g, " ");
}

function isBodyWeightInput(input: string): boolean {
  return (
    BODY_WEIGHT_RECORDING_INPUT.test(input) ||
    bodyWeightCorrectionId(input) !== undefined
  );
}

function bodyWeightCorrectionId(input: string): string | undefined {
  return /^\s*(?:(?:\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2}))?|今天|昨天|前天|today|yesterday)\s*)?(?:纠正体重|correct\s+body\s*weight)\s+([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\s+(?:为|to)\s+[+-]?\d+(?:\.\d+)?\s*(?:(?:kg|kgs?|lb|lbs?)\b|公斤|千克|磅)?\s*[。.!]?\s*$/iu.exec(
    input,
  )?.[1];
}

function formatBodyWeightRecording(
  result: Awaited<ReturnType<StellaFitnessRuntime["recordBodyWeight"]>> & {
    status: "recorded";
  },
): string {
  const { observation, view } = result;
  return [
    `Body weight recorded: ${observation.value.amount} ${observation.value.unit}`,
    `occurred-at: ${observation.occurredAt}`,
    `observation: ${observation.id}`,
    "timeline:",
    ...view.points.map(
      (point) =>
        `- ${point.occurredAt} ${point.amount} ${point.unit}`,
    ),
  ].join("\n");
}

function formatBodyWeightCorrection(
  result: Awaited<ReturnType<StellaFitnessRuntime["correctBodyWeight"]>> & {
    status: "recorded";
  },
): string {
  const { observation, view } = result;
  if (observation.provenance.kind !== "body-weight-correction") {
    throw new Error("Body-weight correction is missing correction provenance");
  }
  return [
    `Body weight corrected: ${observation.value.amount} ${observation.value.unit}`,
    `correction: ${observation.id} replaces: ${observation.provenance.replacesObservationId}`,
    "timeline:",
    ...view.points.map(
      (point) => `- ${point.occurredAt} ${point.amount} ${point.unit}`,
    ),
  ].join("\n");
}

function registerStatusCli(
  api: Parameters<NonNullable<OpenClawPluginDefinition["register"]>>[0],
  statusText: () => string,
): void {
  api.registerCli(
    ({ program }) => {
      program
        .command("stella-fitness")
        .description("Stella Fitness Plugin commands")
        .command("status")
        .description("Print deterministic Plugin status")
        .action(() => {
          process.stdout.write(`${statusText()}\n`);
        });
    },
    {
      descriptors: [
        {
          name: "stella-fitness",
          description: "Stella Fitness Plugin commands",
          hasSubcommands: true,
        },
      ],
    },
  );
}

function createPreflightRunner(
  api: Parameters<NonNullable<OpenClawPluginDefinition["register"]>>[0],
): () => ConfigurationPreflightResult {
  return () => {
    const openclawConfig = currentOpenClawConfig(api);
    const pluginConfig = currentPluginConfig(openclawConfig);
    const extractionConfig = resolveExtractionConfig(pluginConfig);
    return runConfigurationPreflight({
      personalDataDirectory: pluginConfig?.personalDataDirectory,
      runtimeDirectory: join(
        api.runtime.state.resolveStateDir(process.env),
        PLUGIN_ID,
      ),
      conversationAccess: hasConversationAccess(openclawConfig),
      structuredMedia:
        typeof api.runtime.mediaUnderstanding.extractStructuredWithModel ===
        "function",
      extraction: resolveExtractionPermission(
        openclawConfig,
        extractionConfig,
      ),
    });
  };
}

function createCurrentExtractionRuntime(
  api: Parameters<NonNullable<OpenClawPluginDefinition["register"]>>[0],
): ExtractionRuntime {
  return {
    extract(request) {
      const openclawConfig = currentOpenClawConfig(api);
      const extractionConfig = resolveExtractionConfig(
        currentPluginConfig(openclawConfig),
      );
      if (extractionConfig === undefined) {
        throw new Error(
          "Stella Fitness extraction configuration changed after preflight",
        );
      }
      return createOpenClawExtractionRuntime({
        extractStructuredWithModel:
          api.runtime.mediaUnderstanding.extractStructuredWithModel,
        openclawConfig: openclawConfig as OpenClawConfig,
        model: extractionConfig,
      }).extract(request);
    },
  };
}

function currentOpenClawConfig(
  api: Parameters<NonNullable<OpenClawPluginDefinition["register"]>>[0],
) {
  return api.runtime.config.current();
}

function currentPluginConfig(
  openclawConfig: ReturnType<typeof currentOpenClawConfig>,
): Record<string, unknown> | undefined {
  const entry = pluginEntry(openclawConfig);
  return asRecord(entry?.config);
}

function hasConversationAccess(
  openclawConfig: ReturnType<typeof currentOpenClawConfig>,
): boolean {
  const hooks = asRecord(pluginEntry(openclawConfig)?.hooks);
  return hooks?.allowConversationAccess === true;
}

function pluginEntry(
  openclawConfig: ReturnType<typeof currentOpenClawConfig>,
): Record<string, unknown> | undefined {
  const plugins = asRecord(openclawConfig.plugins);
  const entries = asRecord(plugins?.entries);
  return asRecord(entries?.[PLUGIN_ID]);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function resolveExtractionPermission(
  openclawConfig: ReturnType<typeof currentOpenClawConfig>,
  extractionConfig: { provider: string; model: string } | undefined,
): ExtractionPermission {
  if (extractionConfig === undefined) {
    return "unconfigured";
  }
  try {
    assertOperatorModelPermission(
      openclawConfig as OpenClawConfig,
      extractionConfig,
    );
    return "allowed";
  } catch {
    return "denied";
  }
}

function resolveExtractionConfig(
  pluginConfig: Record<string, unknown> | undefined,
): { provider: string; model: string } | undefined {
  const extraction = pluginConfig?.extraction;
  if (
    typeof extraction !== "object" ||
    extraction === null ||
    Array.isArray(extraction)
  ) {
    return undefined;
  }
  const record = extraction as Record<string, unknown>;
  if (
    typeof record.provider !== "string" ||
    record.provider.trim().length === 0 ||
    typeof record.model !== "string" ||
    record.model.trim().length === 0
  ) {
    return undefined;
  }
  return { provider: record.provider, model: record.model };
}

type SetupCommandInput =
  | { readonly kind: "help" }
  | { readonly kind: "select"; readonly programSpecPath: string }
  | { readonly kind: "confirm"; readonly cycleStart: string };

function parseSetupCommand(args: string | undefined): SetupCommandInput {
  const input = args?.trim() ?? "";
  if (input === "" || input === "help") {
    return { kind: "help" };
  }
  if (input.startsWith("select ")) {
    const programSpecPath = input.slice("select ".length).trim();
    if (programSpecPath.length === 0) {
      return { kind: "help" };
    }
    return { kind: "select", programSpecPath };
  }
  const confirm = /^confirm\s+(\S+)$/.exec(input);
  if (confirm?.[1] !== undefined) {
    return { kind: "confirm", cycleStart: confirm[1] };
  }
  return { kind: "help" };
}

function setupHelp(): string {
  return [
    "Usage:",
    "/stella-setup select <ProgramSpec YAML or JSON path>",
    "/stella-setup confirm <YYYY-MM-DD>",
  ].join("\n");
}

function resolvePersonalDataDirectory(
  pluginConfig: Record<string, unknown> | undefined,
): string | undefined {
  return typeof pluginConfig?.personalDataDirectory === "string"
    ? pluginConfig.personalDataDirectory
    : undefined;
}
