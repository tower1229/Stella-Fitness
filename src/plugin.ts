import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";

import {
  definePluginEntry,
  type OpenClawConfig,
  type PluginCommandContext,
  type PluginCommandResult,
  type PluginHookInboundClaimEvent,
  type OpenClawPluginDefinition,
} from "openclaw/plugin-sdk/plugin-entry";
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
import {
  INITIAL_12RM_EXERCISES,
  type Initial12RMExerciseId,
  type RequiredPrerequisiteId,
} from "./program/journey.js";
import { createStatusResponse } from "./status.js";

const STATUS_INPUT = "stella status";
const PLUGIN_ID = "stella-fitness";
const BODY_WEIGHT_RECORDING_INPUT =
  /^\s*(?:(?:\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2}))?|今天|昨天|前天|today|yesterday)\s*)?(?:我\s*)?(?:记录\s*)?(?:体重|body\s*weight|weight)\s*(?:是|为|:|：)?\s*[+-]?\d+(?:\.\d+)?\s*(?:(?:kg|kgs?|lb|lbs?)\b|公斤|千克|磅)?(?:\s*(?:或|还是|or)\s*[+-]?\d+(?:\.\d+)?\s*(?:(?:kg|kgs?|lb|lbs?)\b|公斤|千克|磅)?)?\s*[。.!]?\s*$/iu;
const INITIAL_12RM_ALIASES = {
  "goblet-squat": /(?:高脚杯深蹲|goblet[\s-]*squat)/iu,
  "dumbbell-bench-press": /(?:哑铃卧推|dumbbell[\s-]*bench[\s-]*press)/iu,
  "dumbbell-deadlift": /(?:哑铃硬拉|dumbbell[\s-]*deadlift)/iu,
} satisfies Record<Initial12RMExerciseId, RegExp>;

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
    name: "stella-start",
    description: "Start or resume the default Stella Fitness Program Journey",
    acceptsArgs: false,
    requireAuth: true,
    async handler(context) {
      const binding = await context.requestConversationBinding({
        summary: "Stella Fitness workout recording",
        detachHint: "Detach the Stella Fitness conversation binding to stop recording here.",
        data: { workflow: "program-journey" },
      });
      if (binding.status === "pending") {
        return binding.reply;
      }
      if (binding.status !== "bound") {
        return {
          text: `conversation-binding: unavailable (${binding.message})`,
        };
      }
      const statusText = formatJourneyStatus(await stellaRuntime.programJourneyStatus());
      return {
        text: [
          statusText,
          "conversation-binding: active",
        ].join("\n"),
      };
    },
  });

  api.registerCommand({
    name: "stella-prerequisite",
    description: "Acknowledge one non-medical Built-in Program prerequisite",
    acceptsArgs: true,
    requireAuth: true,
    async handler(context) {
      const bindingReply = await requireProgramJourneyBinding(context);
      if (bindingReply !== undefined) return bindingReply;
      const prerequisiteId = context.args?.trim();
      if (prerequisiteId === undefined || prerequisiteId.length === 0) {
        return {
          text: "Usage: /stella-prerequisite <adjustable-dumbbells|pull-up-bar|printed-workout-log|recording-protocol>",
        };
      }
      const status = await stellaRuntime.acknowledgePrerequisite({
        prerequisiteId,
        acknowledgedAt: new Date().toISOString(),
        source: {
          kind: "user-text",
          text: context.commandBody,
          channel: context.channel,
          ...(context.sessionKey === undefined ? {} : { runId: context.sessionKey }),
        },
      });
      return { text: formatJourneyStatus(status) };
    },
  });

  api.registerCommand({
    name: "stella-weight",
    description: "Record a body-weight fact for the current Program Journey step",
    acceptsArgs: true,
    requireAuth: true,
    async handler(context) {
      const bindingReply = await requireProgramJourneyBinding(context);
      if (bindingReply !== undefined) return bindingReply;
      const text = context.args?.trim();
      if (text === undefined || text.length === 0) {
        return { text: "Usage: /stella-weight <weight with kg or lb>" };
      }
      const deletionId = parseDeletionCommand(text);
      if (deletionId !== undefined) {
        const observation = await stellaRuntime.deleteJourneyBodyWeight({
          observationId: deletionId,
          deletedAt: new Date().toISOString(),
          source: {
            kind: "user-text",
            text: context.commandBody,
            channel: context.channel,
            ...(context.sessionKey === undefined ? {} : { runId: context.sessionKey }),
          },
        });
        return { text: `baseline body weight deleted: ${observation.provenance.kind}\n${formatJourneyStatus(await stellaRuntime.programJourneyStatus())}` };
      }
      const correction = parseCorrectionCommand(text);
      const result = correction === undefined
        ? await recordJourneyAwareBodyWeight(stellaRuntime, {
        text,
        receivedAt: new Date().toISOString(),
        source: {
          channel: context.channel,
        },
      })
        : await stellaRuntime.correctJourneyBodyWeight({
            replacesObservationId: correction.observationId,
            text: correction.valueText,
            receivedAt: new Date().toISOString(),
            source: { channel: context.channel },
          });
      return { text: formatJourneyBodyWeight(result) };
    },
  });

  api.registerCommand({
    name: "stella-12rm",
    description: "Confirm one course-start 12RM result in kg",
    acceptsArgs: true,
    requireAuth: true,
    async handler(context) {
      const bindingReply = await requireProgramJourneyBinding(context);
      if (bindingReply !== undefined) return bindingReply;
      const correction = parse12RMCorrectionCommand(context.args);
      const deletionId = parseDeletionCommand(context.args ?? "");
      const now = new Date().toISOString();
      if (deletionId !== undefined) {
        const observation = await stellaRuntime.deleteInitial12RM({
          observationId: deletionId,
          confirmationId: stableConfirmationId(context),
          deletedAt: now,
          source: {
            kind: "user-text",
            text: context.commandBody,
            channel: context.channel,
            ...(context.sessionKey === undefined ? {} : { runId: context.sessionKey }),
          },
        });
        return { text: `Initial 12RM deleted: ${observation.exerciseId}\n${formatJourneyStatus(await stellaRuntime.programJourneyStatus())}` };
      }
      if (correction !== undefined) {
        const observation = await stellaRuntime.correctInitial12RM({
          ...correction,
          confirmationId: stableConfirmationId(context),
          occurredAt: now,
          recordedAt: now,
          source: {
            kind: "user-text",
            text: context.commandBody,
            channel: context.channel,
            ...(context.sessionKey === undefined ? {} : { runId: context.sessionKey }),
          },
        });
        return { text: `Initial 12RM corrected: ${observation.exerciseId} ${observation.result.value} kg\n${formatJourneyStatus(await stellaRuntime.programJourneyStatus())}` };
      }
      const input = parseInitial12RMCommand(context.args);
      if (input === undefined) {
        return {
          text: "Usage: /stella-12rm <goblet-squat|dumbbell-bench-press|dumbbell-deadlift> <kg> confirm",
        };
      }
      const observation = await stellaRuntime.recordInitial12RM({
        ...input,
        confirmationId: stableConfirmationId(context),
        occurredAt: now,
        recordedAt: now,
        source: {
          kind: "user-text",
          text: context.commandBody,
          channel: context.channel,
          ...(context.sessionKey === undefined ? {} : { runId: context.sessionKey }),
        },
      });
      const status = await stellaRuntime.programJourneyStatus();
      return {
        text: [
          `Initial 12RM recorded: ${observation.exerciseId} ${observation.result.value} kg`,
          `observation: ${observation.id}`,
          formatJourneyStatus(status),
        ].join("\n"),
      };
    },
  });

  api.registerCommand({
    name: "stella-activate",
    description: "Activate the Built-in Program on a confirmed Monday",
    acceptsArgs: true,
    requireAuth: true,
    async handler(context) {
      const bindingReply = await requireProgramJourneyBinding(context);
      if (bindingReply !== undefined) return bindingReply;
      const cycleStart = context.args?.trim() ?? "";
      return { text: await activateProgramReply(stellaRuntime, cycleStart) };
    },
  });

  api.registerCommand({
    name: "stella-facts",
    description: "Read deterministic current or next Planned Session facts",
    acceptsArgs: true,
    requireAuth: true,
    async handler(context) {
      const bindingReply = await requireProgramJourneyBinding(context);
      if (bindingReply !== undefined) return bindingReply;
      const input = parseFactsCommand(context.args);
      if (input === undefined) {
        return { text: factsUsage() };
      }
      return { text: formatProgramFacts(await stellaRuntime.programFacts(input)) };
    },
  });

  api.registerCommand({
    name: "stella-print",
    description: "Generate an A4 printable training log PDF",
    acceptsArgs: true,
    requireAuth: true,
    async handler(context) {
      const bindingReply = await requireProgramJourneyBinding(context);
      if (bindingReply !== undefined) return bindingReply;
      const input = parsePrintableCommand(context.args);
      if (input === undefined) {
        return { text: "Usage: /stella-print <today|week|phase> [YYYY-MM-DD]" };
      }
      const result = await stellaRuntime.printableLog(input);
      return {
        text: `Printable Log: ${result.range}, ${result.pages} page(s)`,
        mediaUrl: result.path,
        trustedLocalMedia: true,
      };
    },
  });

  api.registerCommand({
    name: "stella-confirm",
    description: "Confirm only the uncertain fields from a workout-log photo",
    acceptsArgs: true,
    requireAuth: true,
    async handler(context) {
      const bindingReply = await requireProgramJourneyBinding(context);
      if (bindingReply !== undefined) return bindingReply;
      const confirmation = parseWorkoutConfirmationCommand(context.args);
      try {
        const result = await stellaRuntime.confirmProgramJourneyCandidate({
          ...confirmation,
          confirmedAt: new Date().toISOString(),
          source: {
            kind: "user-text",
            text: context.commandBody,
            channel: context.channel,
            ...(context.sessionKey === undefined ? {} : { runId: context.sessionKey }),
          },
        });
        return { text: await formatProgramJourneyTextResult(stellaRuntime, result) };
      } catch (error) {
        if (!isUnavailableJourneyConfirmation(error)) throw error;
        const result = await stellaRuntime.confirmWorkoutLog(confirmation);
        return { text: formatWorkoutLogRecording(result) };
      }
    },
  });

  api.on(
    "inbound_claim",
    async (event, context) => {
      const confirmationInput = workoutLogConfirmationInput(event);
      if (confirmationInput !== undefined) {
        if (context?.pluginBinding?.pluginId !== PLUGIN_ID) return;
        const confirmation = parseWorkoutConfirmationCommand(confirmationInput);
        const { receivedAt, source } = inboundSource(event);
        try {
          const result = await stellaRuntime.confirmProgramJourneyCandidate({
            ...confirmation,
            confirmedAt: receivedAt,
            source: { kind: "user-text", text: event.content, ...source },
          });
          return {
            handled: true,
            reply: { text: await formatProgramJourneyTextResult(stellaRuntime, result) },
          };
        } catch (error) {
          if (!isUnavailableJourneyConfirmation(error)) throw error;
          const result = await stellaRuntime.confirmWorkoutLog(confirmation);
          return {
            handled: true,
            reply: { text: formatWorkoutLogRecording(result) },
          };
        }
      }
      const boundCommand = parseBoundStellaCommand(event);
      if (boundCommand !== undefined) {
        if (context?.pluginBinding?.pluginId !== PLUGIN_ID) return;
        return await handleBoundStellaCommand(
          stellaRuntime,
          event,
          boundCommand,
        );
      }
      if (context?.pluginBinding?.pluginId === PLUGIN_ID) {
        const boundText = [event.content, event.body, event.bodyForAgent]
          .find((value): value is string => typeof value === "string") ?? "";
        const prerequisiteId = parseNaturalPrerequisiteAcknowledgement(boundText);
        if (prerequisiteId !== undefined) {
          const { receivedAt: acknowledgedAt, source } = inboundSource(event);
          const status = await stellaRuntime.acknowledgePrerequisite({
            prerequisiteId,
            acknowledgedAt,
            source: {
              kind: "user-text",
              text: boundText,
              ...source,
            },
          });
          return { handled: true, reply: { text: formatJourneyStatus(status) } };
        }
        const date = event.timestamp === undefined
          ? new Date().toISOString().slice(0, 10)
          : new Date(event.timestamp).toISOString().slice(0, 10);
        const factQuery = parseNaturalProgramFactsQuery(boundText, date);
        if (isOutOfScopeProgramQuestion(boundText)) {
          const result = await stellaRuntime.programFacts({
            kind: "unsupported",
            question: boundText,
          });
          return { handled: true, reply: { text: formatProgramFacts(result) } };
        }
        if (factQuery !== undefined) {
          const result = await stellaRuntime.programFacts(factQuery);
          return { handled: true, reply: { text: formatProgramFacts(result) } };
        }
        if (isBodyWeightInput(boundText)) {
          const receivedAt = event.timestamp === undefined
            ? new Date().toISOString()
            : new Date(event.timestamp).toISOString();
          const correctionId = bodyWeightCorrectionId(boundText);
          if (correctionId !== undefined) {
            const result = await stellaRuntime.correctBodyWeight({
              replacesObservationId: correctionId,
              text: boundText,
              receivedAt,
              source: {
                channel: event.channel,
                ...(event.messageId === undefined ? {} : { messageId: event.messageId }),
                ...(event.runId === undefined ? {} : { runId: event.runId }),
              },
            });
            return {
              handled: true,
              reply: {
                text: result.status === "clarification"
                  ? result.question
                  : formatBodyWeightCorrection(result),
              },
            };
          }
          const journeyStatus = await stellaRuntime.programJourneyStatus({
            date: receivedAt.slice(0, 10),
          });
          if (journeyStatus.state === "BASELINE_WEIGHT_REQUIRED") {
            const result = await stellaRuntime.submitProgramJourneyText({
              text: boundText,
              receivedAt,
              source: {
                channel: event.channel,
                ...(event.messageId === undefined ? {} : { messageId: event.messageId }),
                ...(event.runId === undefined ? {} : { runId: event.runId }),
              },
            });
            return {
              handled: true,
              reply: { text: await formatProgramJourneyTextResult(stellaRuntime, result) },
            };
          }
          const result = await recordJourneyAwareBodyWeight(stellaRuntime, {
            text: boundText,
            receivedAt,
            source: {
              channel: event.channel,
              ...(event.messageId === undefined ? {} : { messageId: event.messageId }),
              ...(event.runId === undefined ? {} : { runId: event.runId }),
            },
          });
          return {
            handled: true,
            reply: {
              text: result.status === "clarification"
                ? result.question
                : formatJourneyBodyWeight(result),
            },
          };
        }
        if (isInitial12RMText(boundText)) {
          const { receivedAt, source } = inboundSource(event);
          const result = await stellaRuntime.submitProgramJourneyText({
            text: boundText,
            receivedAt,
            source,
          });
          return {
            handled: true,
            reply: { text: await formatProgramJourneyTextResult(stellaRuntime, result) },
          };
        }
        if (isQuestion(boundText)) {
          const result = await stellaRuntime.programFacts({
            kind: "unsupported",
            question: boundText,
          });
          return { handled: true, reply: { text: formatProgramFacts(result) } };
        }
      }
      if (!isWorkoutLogImageInput(event)) {
        return;
      }
      const upload = await workoutLogUpload(event);
      if (upload === undefined) {
        return;
      }
      const request = {
        runId:
          event.runId ??
          event.messageId ??
          `workout-log-${randomUUID()}`,
        upload,
        timeoutMs: 60_000,
        signal: new AbortController().signal,
      };
      const correctionId = workoutLogCorrectionId(event);
      const result = correctionId === undefined
        ? await stellaRuntime.ingestWorkoutLog(request)
        : await stellaRuntime.correctWorkoutLog({
            ...request,
            replacesObservationId: correctionId,
          });
      return {
        handled: true,
        reply: { text: formatWorkoutLogResult(result) },
      };
    },
    { priority: 100, timeoutMs: 65_000 },
  );

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
      if (correctionId === undefined) {
        const result = await stellaRuntime.recordBodyWeight({
          text: event.cleanedBody,
          receivedAt,
          ...source,
        });
        return {
          handled: true,
          reply: {
            text: result.status === "clarification"
              ? result.question
              : formatBodyWeightRecording(result),
          },
        };
      }
      const result = await stellaRuntime.correctBodyWeight({
        replacesObservationId: correctionId,
        text: event.cleanedBody,
        receivedAt,
        ...source,
      });
      return {
        handled: true,
        reply: {
          text: result.status === "clarification"
            ? result.question
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

function isWorkoutLogImageInput(event: PluginHookInboundClaimEvent): boolean {
  const text = [event.content, event.body, event.bodyForAgent]
    .filter((value): value is string => typeof value === "string")
    .join(" ");
  return /(?:训练(?:日志|记录)|记录训练|workout\s*log)/iu.test(text);
}

function workoutLogConfirmationInput(
  event: PluginHookInboundClaimEvent,
): string | undefined {
  const text = [event.content, event.body, event.bodyForAgent]
    .find((value): value is string => typeof value === "string" &&
      /^\s*\/stella-confirm(?:@\w+)?(?:\s|$)/iu.test(value));
  return text?.replace(/^\s*\/stella-confirm(?:@\w+)?\s*/iu, "");
}

type BoundStellaCommand = {
  readonly name:
    | "start"
    | "status"
    | "prerequisite"
    | "weight"
    | "12rm"
    | "activate"
    | "facts"
    | "print";
  readonly args: string;
};

function parseBoundStellaCommand(
  event: PluginHookInboundClaimEvent,
): BoundStellaCommand | undefined {
  const text = [event.content, event.body, event.bodyForAgent]
    .find((value): value is string => typeof value === "string") ?? "";
  const match = /^\s*\/stella-(start|status|prerequisite|weight|12rm|activate|facts|print)(?:@\w+)?(?:\s+(.*))?\s*$/isu.exec(
    text,
  );
  return match?.[1] === undefined
    ? undefined
    : {
        name: match[1].toLowerCase() as BoundStellaCommand["name"],
        args: match[2]?.trim() ?? "",
      };
}

function parseNaturalPrerequisiteAcknowledgement(
  text: string,
): RequiredPrerequisiteId | undefined {
  const patterns = [
    ["adjustable-dumbbells", /^\s*我(?:已|已经)?(?:准备好|备好|有)(?:了)?可拆卸哑铃[。.!]?\s*$/u],
    ["pull-up-bar", /^\s*我(?:已|已经)?(?:准备好|备好|有)(?:了)?引体向上杆[。.!]?\s*$/u],
    ["printed-workout-log", /^\s*我(?:已|已经)(?:打印|准备好)(?:了)?(?:打印)?训练日志[。.!]?\s*$/u],
    ["recording-protocol", /^\s*我(?:已|已经)(?:了解|确认)(?:了)?训练记录协议[。.!]?\s*$/u],
  ] as const;
  return patterns.find(([, pattern]) => pattern.test(text))?.[0];
}

function inboundSource(event: PluginHookInboundClaimEvent): {
  readonly receivedAt: string;
  readonly source: {
    readonly channel: string;
    readonly messageId?: string;
    readonly runId?: string;
  };
} {
  return {
    receivedAt: event.timestamp === undefined
      ? new Date().toISOString()
      : new Date(event.timestamp).toISOString(),
    source: {
      channel: event.channel,
      ...(event.messageId === undefined ? {} : { messageId: event.messageId }),
      ...(event.runId === undefined ? {} : { runId: event.runId }),
    },
  };
}

async function handleBoundStellaCommand(
  runtime: StellaFitnessRuntime,
  event: PluginHookInboundClaimEvent,
  command: BoundStellaCommand,
) {
  const { receivedAt, source } = inboundSource(event);
  if (command.name === "start" || command.name === "status") {
    return {
      handled: true,
      reply: { text: formatJourneyStatus(await runtime.programJourneyStatus()) },
    };
  }
  if (command.name === "prerequisite") {
    const status = await runtime.acknowledgePrerequisite({
      prerequisiteId: command.args,
      acknowledgedAt: receivedAt,
      source: {
        kind: "user-text",
        text: event.content,
        ...source,
      },
    });
    return { handled: true, reply: { text: formatJourneyStatus(status) } };
  }
  if (command.name === "weight") {
    const deletionId = parseDeletionCommand(command.args);
    if (deletionId !== undefined) {
      const observation = await runtime.deleteJourneyBodyWeight({
        observationId: deletionId,
        deletedAt: receivedAt,
        source: { kind: "user-text", text: event.content, ...source },
      });
      return {
        handled: true,
        reply: { text: `baseline body weight deleted: ${observation.id}\n${formatJourneyStatus(await runtime.programJourneyStatus())}` },
      };
    }
    const correction = parseCorrectionCommand(command.args);
    if (correction !== undefined) {
      const result = await runtime.correctJourneyBodyWeight({
        replacesObservationId: correction.observationId,
        text: correction.valueText,
        receivedAt,
        source,
      });
      return { handled: true, reply: { text: formatJourneyBodyWeight(result) } };
    }
    const result = await recordJourneyAwareBodyWeight(runtime, {
      text: command.args,
      receivedAt,
      source,
    });
    return {
      handled: true,
      reply: {
        text: result.status === "clarification"
          ? result.question
          : formatJourneyBodyWeight(result),
      },
    };
  }
  if (command.name === "12rm") {
    const deletionId = parseDeletionCommand(command.args);
    if (deletionId !== undefined) {
      const observation = await runtime.deleteInitial12RM({
        observationId: deletionId,
        confirmationId: stableConfirmationId({
          channel: event.channel,
          ...(event.senderId === undefined ? {} : { senderId: event.senderId }),
          ...(event.sessionKey === undefined ? {} : { sessionKey: event.sessionKey }),
          commandBody: event.content,
        }),
        deletedAt: receivedAt,
        source: { kind: "user-text", text: event.content, ...source },
      });
      return {
        handled: true,
        reply: { text: `Initial 12RM deleted: ${observation.exerciseId}\n${formatJourneyStatus(await runtime.programJourneyStatus())}` },
      };
    }
    const correction = parse12RMCorrectionCommand(command.args);
    if (correction !== undefined) {
      const observation = await runtime.correctInitial12RM({
        ...correction,
        confirmationId: stableConfirmationId({
          channel: event.channel,
          ...(event.senderId === undefined ? {} : { senderId: event.senderId }),
          ...(event.sessionKey === undefined ? {} : { sessionKey: event.sessionKey }),
          commandBody: event.content,
        }),
        occurredAt: receivedAt,
        recordedAt: receivedAt,
        source: { kind: "user-text", text: event.content, ...source },
      });
      return {
        handled: true,
        reply: { text: `Initial 12RM corrected: ${observation.exerciseId} ${observation.result.value} kg\n${formatJourneyStatus(await runtime.programJourneyStatus())}` },
      };
    }
    const input = parseInitial12RMCommand(command.args);
    if (input === undefined) {
      return {
        handled: true,
        reply: {
          text: "Usage: /stella-12rm <goblet-squat|dumbbell-bench-press|dumbbell-deadlift> <kg> confirm",
        },
      };
    }
    const observation = await runtime.recordInitial12RM({
      ...input,
      confirmationId: stableConfirmationId({
        channel: event.channel,
        ...(event.senderId === undefined ? {} : { senderId: event.senderId }),
        ...(event.sessionKey === undefined ? {} : { sessionKey: event.sessionKey }),
        commandBody: event.content,
      }),
      occurredAt: receivedAt,
      recordedAt: receivedAt,
      source: { kind: "user-text", text: event.content, ...source },
    });
    return {
      handled: true,
      reply: {
        text: [
          `Initial 12RM recorded: ${observation.exerciseId} ${observation.result.value} kg`,
          `observation: ${observation.id}`,
          formatJourneyStatus(await runtime.programJourneyStatus()),
        ].join("\n"),
      },
    };
  }
  if (command.name === "activate") {
    return {
      handled: true,
      reply: { text: await activateProgramReply(runtime, command.args) },
    };
  }
  if (command.name === "facts") {
    const input = parseFactsCommand(command.args);
    return {
      handled: true,
      reply: {
        text: input === undefined
          ? factsUsage()
          : formatProgramFacts(await runtime.programFacts(input)),
      },
    };
  }
  const input = parsePrintableCommand(command.args);
  if (input === undefined) {
    return {
      handled: true,
      reply: { text: "Usage: /stella-print <today|week|phase> [YYYY-MM-DD]" },
    };
  }
  const result = await runtime.printableLog(input);
  return {
    handled: true,
    reply: {
      text: `Printable Log: ${result.range}, ${result.pages} page(s)`,
      mediaUrl: result.path,
      trustedLocalMedia: true,
    },
  };
}

async function workoutLogUpload(
  event: PluginHookInboundClaimEvent,
): Promise<{
  readonly bytes: Buffer;
  readonly fileName: string;
  readonly mime: "image/jpeg" | "image/png" | "image/webp";
  readonly receivedAt: string;
  readonly provenance: {
    readonly channel: string;
    readonly messageId?: string;
  };
} | undefined> {
  const metadata = event.metadata;
  if (metadata === undefined) {
    return undefined;
  }
  const mediaPath = firstNonBlankString(metadata.mediaPaths) ??
    nonBlankString(metadata.mediaPath);
  const mime = supportedImageMime(
    firstNonBlankString(metadata.mediaTypes) ?? metadata.mediaType,
  );
  if (mediaPath === undefined || mime === undefined) {
    return undefined;
  }
  const receivedAt =
    event.timestamp === undefined
      ? new Date().toISOString()
      : new Date(event.timestamp).toISOString();
  return {
    bytes: await readFile(mediaPath),
    fileName: basename(mediaPath),
    mime,
    receivedAt,
    provenance: {
      channel: event.channel,
      ...(event.messageId === undefined ? {} : { messageId: event.messageId }),
    },
  };
}

function supportedImageMime(
  value: unknown,
): "image/jpeg" | "image/png" | "image/webp" | undefined {
  return value === "image/jpeg" || value === "image/png" || value === "image/webp"
    ? value
    : undefined;
}

function firstNonBlankString(value: unknown): string | undefined {
  return Array.isArray(value)
    ? value.find((candidate): candidate is string =>
        nonBlankString(candidate) !== undefined,
      )
    : undefined;
}

function nonBlankString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value
    : undefined;
}

function parseWorkoutConfirmationCommand(args: string | undefined): {
  readonly confirmationId: string;
  readonly values: Readonly<Record<string, unknown>>;
} {
  const match = /^\s*([0-9a-f-]{36})\s+(\{.*\})\s*$/isu.exec(args ?? "");
  if (match === null) {
    throw new Error(
      'Usage: /stella-confirm <confirmation-id> {"field.path": value}',
    );
  }
  const values: unknown = JSON.parse(match[2]!);
  const record = asRecord(values);
  if (record === undefined) {
    throw new Error("Workout-log confirmation values must be a JSON object");
  }
  return { confirmationId: match[1]!, values: record };
}

function formatWorkoutLogResult(
  result: Awaited<ReturnType<StellaFitnessRuntime["ingestWorkoutLog"]>>,
): string {
  if (result.status === "recorded") {
    return formatWorkoutLogRecording(result);
  }
  return [
    `Workout log needs confirmation: ${result.confirmationId}`,
    ...result.fields.map(({ path, kind, candidates }) =>
      `- ${path} (${kind})${
        candidates === undefined ? "" : `: ${candidates.join(" / ")}`
      }`,
    ),
    `Run /stella-confirm ${result.confirmationId} with one JSON value for each listed path.`,
  ].join("\n");
}

function formatWorkoutLogRecording(
  result: { readonly observation: Awaited<
    ReturnType<StellaFitnessRuntime["confirmWorkoutLog"]>
  >["observation"] },
): string {
  const { observation } = result;
  if (observation.provenance.kind === "workout-log-correction") {
    return [
      `Workout corrected: stage ${observation.stage.value}, week ${observation.week.value}, ${observation.weekday.value}, ${observation.sessionType.value}`,
      `correction: ${observation.id} replaces: ${observation.provenance.replacesObservationId}`,
    ].join("\n");
  }
  return [
    `Workout recorded: stage ${observation.stage.value}, week ${observation.week.value}, ${observation.weekday.value}, ${observation.sessionType.value}`,
    `observation: ${observation.id}`,
  ].join("\n");
}

function workoutLogCorrectionId(
  event: PluginHookInboundClaimEvent,
): string | undefined {
  const text = [event.content, event.body, event.bodyForAgent]
    .filter((value): value is string => typeof value === "string")
    .join(" ");
  return /(?:纠正训练(?:日志|记录)|correct\s+workout\s+log)\s+([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})/iu.exec(
    text,
  )?.[1];
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

function isInitial12RMText(input: string): boolean {
  return /12\s*RM/iu.test(input) &&
    /高脚杯深蹲|goblet[ -]squat|哑铃卧推|dumbbell[ -]bench[ -]press|哑铃硬拉|dumbbell[ -]deadlift/iu.test(input);
}

function isUnavailableJourneyConfirmation(error: unknown): boolean {
  return error instanceof Error &&
    error.message === "Program Journey confirmation is unavailable";
}

async function formatProgramJourneyTextResult(
  runtime: StellaFitnessRuntime,
  result: Awaited<ReturnType<StellaFitnessRuntime["submitProgramJourneyText"]>>,
): Promise<string> {
  if (result.status === "confirmation") {
    return [
      `Program Journey needs confirmation: ${result.confirmationId}`,
      ...result.fields.map(({ path, question }) => `- ${path}: ${question}`),
      `Run /stella-confirm ${result.confirmationId} with one JSON value for each listed path.`,
    ].join("\n");
  }
  const fact = result.kind === "baseline-body-weight"
    ? `baseline body weight recorded: ${result.observation.value.amount} ${result.observation.value.unit}`
    : `Initial 12RM recorded: ${result.observation.exerciseId} ${result.observation.result.value} kg`;
  return [
    fact,
    `observation: ${result.observation.id}`,
    formatJourneyStatus(await runtime.programJourneyStatus()),
  ].join("\n");
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

function formatJourneyStatus(
  status: Awaited<ReturnType<StellaFitnessRuntime["programJourneyStatus"]>>,
): string {
  return [
    `Built-in Program: ${status.program.id}@${status.program.version}`,
    `journey: ${status.state}`,
    ...(status.missingPrerequisiteIds.length === 0
      ? []
      : [`missing-prerequisites: ${status.missingPrerequisiteIds.join(", ")}`]),
    ...(status.missingInitial12RMExerciseIds.length === 0
      ? []
      : [`missing-initial-12rm: ${status.missingInitial12RMExerciseIds.join(", ")}`]),
    ...status.errors.map(({ file, message }) => `error: ${file} - ${message}`),
    `next: ${status.nextStep.code} - ${status.nextStep.prompt}`,
  ].join("\n");
}

async function requireProgramJourneyBinding(
  context: PluginCommandContext,
): Promise<PluginCommandResult | undefined> {
  const binding = await context.requestConversationBinding({
    summary: "Stella Fitness workout recording",
    detachHint: "Detach the Stella Fitness conversation binding to stop recording here.",
    data: { workflow: "program-journey" },
  });
  if (binding.status === "bound") return undefined;
  if (binding.status === "pending") return binding.reply;
  return {
    text: `conversation-binding: unavailable (${binding.message})`,
  };
}

function parseInitial12RMCommand(args: string | undefined): {
  readonly exerciseId: Initial12RMExerciseId;
  readonly valueKg: number;
} | undefined {
  const exerciseIds = INITIAL_12RM_EXERCISES.join("|");
  const match = new RegExp(
    `^\\s*(${exerciseIds})\\s+(\\d+(?:\\.\\d+)?)\\s*(?:kg|公斤)?\\s+confirm\\s*$`,
    "iu",
  ).exec(
    args ?? "",
  );
  if (match?.[1] === undefined || match[2] === undefined) return undefined;
  const valueKg = Number(match[2]);
  if (!Number.isFinite(valueKg) || valueKg <= 0) return undefined;
  return {
    exerciseId: match[1].toLowerCase() as Initial12RMExerciseId,
    valueKg,
  };
}

function parseDeletionCommand(args: string): string | undefined {
  return /^\s*delete\s+([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\s+confirm\s*$/iu.exec(
    args,
  )?.[1];
}

function parseCorrectionCommand(args: string): {
  readonly observationId: string;
  readonly valueText: string;
} | undefined {
  const match = /^\s*correct\s+([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\s+(.+)\s*$/isu.exec(
    args,
  );
  return match?.[1] === undefined || match[2] === undefined
    ? undefined
    : { observationId: match[1], valueText: match[2] };
}

function parse12RMCorrectionCommand(args: string | undefined): {
  readonly replacesObservationId: string;
  readonly valueKg: number;
} | undefined {
  const match = /^\s*correct\s+([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\s+(\d+(?:\.\d+)?)\s*(?:kg|公斤)?\s+confirm\s*$/iu.exec(
    args ?? "",
  );
  const valueKg = Number(match?.[2]);
  return match?.[1] === undefined || !Number.isFinite(valueKg) || valueKg <= 0
    ? undefined
    : { replacesObservationId: match[1], valueKg };
}

function stableConfirmationId(context: {
  readonly channel: string;
  readonly senderId?: string;
  readonly sessionKey?: string;
  readonly commandBody: string;
}): string {
  const hex = createHash("sha256")
    .update(
      [
        context.channel,
        context.senderId ?? "",
        context.sessionKey ?? "",
        context.commandBody,
      ].join("\u0000"),
    )
    .digest("hex")
    .slice(0, 32)
    .split("");
  hex[12] = "4";
  hex[16] = "8";
  return `${hex.slice(0, 8).join("")}-${hex.slice(8, 12).join("")}-${hex.slice(12, 16).join("")}-${hex.slice(16, 20).join("")}-${hex.slice(20).join("")}`;
}

function parseFactsCommand(args: string | undefined):
  | Parameters<StellaFitnessRuntime["programFacts"]>[0]
  | undefined {
  const symbolMatch = /^\s*symbol\s+(\S+)\s+([AN])\s*$/iu.exec(args ?? "");
  if (symbolMatch?.[1] !== undefined && symbolMatch[2] !== undefined) {
    return {
      kind: "symbol",
      exerciseId: symbolMatch[1],
      symbol: symbolMatch[2].toUpperCase() as "A" | "N",
    };
  }
  const match = /^\s*(today|next)(?:\s+(\d{4}-\d{2}-\d{2}))?\s*$/iu.exec(
    args ?? "",
  );
  if (match?.[1] === undefined) return undefined;
  return {
    kind: match[1].toLowerCase() as "today" | "next",
    date: match[2] ?? new Date().toISOString().slice(0, 10),
  };
}

function parseNaturalProgramFactsQuery(
  text: string,
  date: string,
): Parameters<StellaFitnessRuntime["programFacts"]>[0] | undefined {
  const symbol = /(?:当前|current)?\s*([AN])\s*(?:是多少|是|重量|load|weight|\?|？)/iu.exec(text)?.[1]
    ?.toUpperCase() as "A" | "N" | undefined;
  const exerciseId = INITIAL_12RM_EXERCISES.find((id) =>
    INITIAL_12RM_ALIASES[id].test(text)
  );
  if (exerciseId !== undefined && symbol !== undefined) {
    return { kind: "symbol", exerciseId, symbol };
  }
  if (/(?:下次(?:应该)?练什么|下次(?:训练|课程|计划)|next\s+(?:workout|session))/iu.test(text)) {
    return { kind: "next", date };
  }
  if (
    /(?:今天(?:应该)?练什么|today(?:'s)?\s+(?:workout|session)|当前(?:阶段|第几周|周次|训练日|动作|组次|次数|持续时间|休息|处方)|训练日(?:是什么|是哪天|安排|\?|？)|(?:动作|组次|次数|持续时间|休息|处方)(?:是什么|有哪些|分别是什么|\?|？)|prescription|rest)/iu.test(text)
  ) {
    return { kind: "today", date };
  }
  return undefined;
}

function isOutOfScopeProgramQuestion(text: string): boolean {
  return /(?:诊断|饮食|营养|健康|风险|受伤|伤(?:腰|膝|肩|背)|疼痛|建议|调整|评价|表现(?:怎么样|如何|好不好)|练得怎么样|好不好|是否有效|疲劳|diagnos|nutrition|health|risk|injur|pain|recommend|advise|adjust|evaluat|performance)/iu.test(
    text,
  );
}

function isQuestion(text: string): boolean {
  return /(?:[?？]|吗(?:[。.!！]?\s*)$|呢(?:[。.!！]?\s*)$|多少|怎么|如何|能不能|可不可以|是否|会不会|是不是|what|when|where|which|who|why|how|can\s+i|should\s+i)/iu.test(
    text,
  );
}

function factsUsage(): string {
  return "Usage: /stella-facts <today|next> [YYYY-MM-DD] | symbol <exercise-id> <A|N>";
}

function parsePrintableCommand(args: string | undefined):
  | { readonly range: "today" | "week" | "phase"; readonly date: string }
  | undefined {
  const match = /^\s*(today|week|phase)(?:\s+(\d{4}-\d{2}-\d{2}))?\s*$/iu.exec(
    args ?? "",
  );
  if (match?.[1] === undefined) return undefined;
  return {
    range: match[1].toLowerCase() as "today" | "week" | "phase",
    date: match[2] ?? new Date().toISOString().slice(0, 10),
  };
}

function formatProgramFacts(
  result: Awaited<ReturnType<StellaFitnessRuntime["programFacts"]>>,
): string {
  if (result.kind === "unsupported") return result.scope;
  if (result.kind === "no-session") return `No ${result.relation} Planned Session.`;
  if (result.kind === "symbol-fact") {
    return `${result.exerciseId} ${result.symbol}: ${result.value} ${result.unit}`;
  }
  if (result.kind === "symbol-binding-pending") {
    return `${result.exerciseId} ${result.symbol}: binding pending. next: ${result.nextStep}`;
  }
  return [
    `${result.relation} Planned Session: ${result.session.date}`,
    `stage: ${result.session.cycle.phase}, week: ${result.session.cycle.week}, day: ${result.session.day}, type: ${result.session.type}, recovery: ${result.session.recovery}`,
    ...result.session.exercises.map((exercise) =>
      `- ${exercise.displayName ?? exercise.exerciseId}: prescription: ${JSON.stringify(exercise.prescription)}, rest: ${formatRest(exercise)}${
        exercise.resolvedLoad === undefined
          ? exercise.unresolvedLoad === undefined
            ? ""
            : `, ${exercise.unresolvedLoad.symbol}=binding pending, next: ${exercise.unresolvedLoad.nextStep}`
          : `, ${exercise.resolvedLoad.symbol}=${exercise.resolvedLoad.value} ${exercise.resolvedLoad.unit}`
      }`,
    ),
    ...result.session.tests.map((test) =>
      `- ${test.exerciseId}: test: ${test.test}, result-binding: ${test.resultBinding}`
    ),
  ].join("\n");
}

function formatRest(exercise: {
  readonly rest?: "self_selected";
  readonly restSeconds?: readonly number[];
}): string {
  if (exercise.rest === "self_selected") return "self-selected";
  if (exercise.restSeconds !== undefined) {
    return `${exercise.restSeconds.join("-")} seconds`;
  }
  return "not specified by source program";
}

async function activateProgramReply(
  runtime: StellaFitnessRuntime,
  cycleStart: string,
): Promise<string> {
  const state = await runtime.activateProgram(cycleStart);
  const firstSession = await runtime.programFacts({
    kind: "today",
    date: state.cycle.startDate,
  });
  return [
    `Program State activated: ${state.id}`,
    `program: ${state.program.id}@${state.program.version}`,
    `cycle-start: ${state.cycle.startDate}`,
    formatProgramFacts(firstSession),
  ].join("\n");
}

async function recordJourneyAwareBodyWeight(
  runtime: StellaFitnessRuntime,
  input: Parameters<StellaFitnessRuntime["recordBodyWeight"]>[0],
) {
  const status = await runtime.programJourneyStatus({
    date: input.receivedAt.slice(0, 10),
  });
  if (status.state === "BASELINE_WEIGHT_REQUIRED") {
    return await runtime.recordJourneyBodyWeight({ ...input, role: "baseline" });
  }
  if (
    status.state === "PHASE_CHECKPOINT_REQUIRED" &&
    status.requiredCheckpointWeek !== undefined
  ) {
    return await runtime.recordJourneyBodyWeight({
      ...input,
      role: "checkpoint",
      checkpointWeek: status.requiredCheckpointWeek,
    });
  }
  return await runtime.recordBodyWeight(input);
}

function formatJourneyBodyWeight(
  result: Awaited<ReturnType<typeof recordJourneyAwareBodyWeight>>,
): string {
  if (result.status === "clarification") return result.question;
  if ("role" in result) {
    return `${result.role} body weight recorded: ${result.observation.value.amount} ${result.observation.value.unit}\nobservation: ${result.observation.id}`;
  }
  return formatBodyWeightRecording(result);
}

function resolvePersonalDataDirectory(
  pluginConfig: Record<string, unknown> | undefined,
): string | undefined {
  return typeof pluginConfig?.personalDataDirectory === "string"
    ? pluginConfig.personalDataDirectory
    : undefined;
}
