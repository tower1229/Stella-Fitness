import {
  definePluginEntry,
  type OpenClawPluginDefinition,
} from "openclaw/plugin-sdk/plugin-entry";

import { assertOpenClawContract } from "./contracts/openclaw.js";
import { STATUS_TEXT, createStatusResponse } from "./status.js";

const STATUS_INPUT = "stella status";

const plugin: OpenClawPluginDefinition = definePluginEntry({
  id: "stella-fitness",
  name: "Stella Fitness",
  description:
    "Deterministic training-plan execution and recording without diagnosis or supervision",
  register(api) {
    registerStatusCli(api);
    if (api.registrationMode === "cli-metadata") {
      return;
    }

    assertOpenClawContract(api);

    api.registerCommand({
      name: "stella-status",
      description: "Show the deterministic Stella Fitness Plugin status",
      acceptsArgs: false,
      requireAuth: true,
      async handler() {
        return createStatusResponse();
      },
    });

    api.on(
      "before_agent_reply",
      async (event) => {
        if (normalizeStatusInput(event.cleanedBody) !== STATUS_INPUT) {
          return;
        }
        return { handled: true, reply: createStatusResponse() };
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
          message: STATUS_TEXT,
          category: "plugin-command",
        };
      },
      { priority: 100, timeoutMs: 1_000 },
    );
  },
});

export default plugin;

function normalizeStatusInput(input: string): string {
  return input.trim().toLowerCase().replaceAll(/\s+/g, " ");
}

function registerStatusCli(
  api: Parameters<NonNullable<OpenClawPluginDefinition["register"]>>[0],
): void {
  api.registerCli(
    ({ program }) => {
      program
        .command("stella-fitness")
        .description("Stella Fitness Plugin commands")
        .command("status")
        .description("Print deterministic Plugin status")
        .action(() => {
          process.stdout.write(`${STATUS_TEXT}\n`);
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
