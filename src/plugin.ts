import {
  definePluginEntry,
  type OpenClawPluginDefinition,
} from "openclaw/plugin-sdk/plugin-entry";

import {
  assertOpenClawContract,
  assertOperatorModelPermission,
} from "./contracts/openclaw.js";
import { createOpenClawExtractionRuntime } from "./extraction/openclaw.js";
import type { ExtractionRuntime } from "./extraction/runtime.js";
import {
  createStellaFitnessRuntime,
  type StellaFitnessRuntime,
} from "./plugin-runtime.js";
import { createStatusResponse } from "./status.js";

const STATUS_INPUT = "stella status";

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
  const extractionConfig = resolveExtractionConfig(api.pluginConfig);
  const status = createStatusResponse(
    extractionConfig === undefined ? "unconfigured" : "configured",
  );
  registerStatusCli(api, status.text);
  if (api.registrationMode === "cli-metadata") {
    return undefined;
  }

  assertOpenClawContract(api);
  if (extractionConfig !== undefined) {
    assertOperatorModelPermission(api.config, extractionConfig);
  }
  const stellaRuntime = createStellaFitnessRuntime({
    extractionRuntime:
      extractionConfig === undefined
        ? createUnconfiguredExtractionRuntime()
        : createOpenClawExtractionRuntime({
            extractStructuredWithModel:
              api.runtime.mediaUnderstanding.extractStructuredWithModel,
            openclawConfig: api.config,
            model: extractionConfig,
          }),
  });

  api.registerCommand({
    name: "stella-status",
    description: "Show the deterministic Stella Fitness Plugin status",
    acceptsArgs: false,
    requireAuth: true,
    async handler() {
      return status;
    },
  });

  api.on(
    "before_agent_reply",
    async (event) => {
      if (normalizeStatusInput(event.cleanedBody) !== STATUS_INPUT) {
        return;
      }
      return { handled: true, reply: status };
    },
    { priority: 100, timeoutMs: 1_000 },
  );

  api.on(
    "before_agent_run",
    async (event) => {
      if (normalizeStatusInput(event.prompt) !== STATUS_INPUT) {
        return { outcome: "pass" as const };
      }
      return {
        outcome: "block" as const,
        reason: "stella-status-is-plugin-owned",
        message: status.text,
        category: "plugin-command",
      };
    },
    { priority: 100, timeoutMs: 1_000 },
  );
  return stellaRuntime;
}

function normalizeStatusInput(input: string): string {
  return input.trim().toLowerCase().replaceAll(/\s+/g, " ");
}

function registerStatusCli(
  api: Parameters<NonNullable<OpenClawPluginDefinition["register"]>>[0],
  statusText: string,
): void {
  api.registerCli(
    ({ program }) => {
      program
        .command("stella-fitness")
        .description("Stella Fitness Plugin commands")
        .command("status")
        .description("Print deterministic Plugin status")
        .action(() => {
          process.stdout.write(`${statusText}\n`);
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

function createUnconfiguredExtractionRuntime(): ExtractionRuntime {
  return {
    async extract() {
      throw new Error(
        "Stella Fitness extraction is unconfigured; set provider and model before processing media",
      );
    },
  };
}
