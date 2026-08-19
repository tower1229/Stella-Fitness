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
import { resolveAgentIdFromSessionKey } from "openclaw/plugin-sdk/agent-runtime";
import { assertOperatorModelPermission } from "./contracts/openclaw.js";
import { createWorkoutLogConfirmationCoordinator } from "./confirmation/coordinator.js";
import { createOpenClawConfirmationIntentClassifier } from "./confirmation/openclaw.js";
import { createRuntimeDirectoryConfirmationSessionStore } from "./confirmation/runtime-store.js";
import {
  MultiSessionWorkoutLogPageError,
  parseWorkoutLogFieldPath,
  type WorkoutLogCandidate,
} from "./extraction/candidate.js";
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
const PRINTABLE_LOG_DOWNLOAD_ROUTE =
  "/plugins/stella-fitness/printable-log/";
const PRINTABLE_LOG_DOWNLOAD_TTL_MS = 10 * 60 * 1_000;
const PRINTABLE_LOG_FILE_NAME = "zhuoshu-workout-log.xlsx";
const printableLogDownloadTokens = new Map<string, number>();
const BODY_WEIGHT_RECORDING_INPUT =
  /^\s*(?:(?:\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2}))?|今天|昨天|前天|today|yesterday)\s*)?(?:我\s*)?(?:记录\s*)?(?:体重|body\s*weight|weight)\s*(?:是|为|:|：)?\s*[+-]?\d+(?:\.\d+)?\s*(?:(?:kg|kgs?|lb|lbs?)\b|公斤|千克|磅)?(?:\s*(?:或|还是|or)\s*[+-]?\d+(?:\.\d+)?\s*(?:(?:kg|kgs?|lb|lbs?)\b|公斤|千克|磅)?)?\s*[。.!]?\s*$/iu;
const INITIAL_12RM_ALIASES = {
  "goblet-squat": /(?:高脚杯深蹲|goblet[\s-]*squat)/iu,
  "dumbbell-bench-press": /(?:哑铃卧推|dumbbell[\s-]*bench[\s-]*press)/iu,
  "dumbbell-deadlift": /(?:哑铃硬拉|dumbbell[\s-]*deadlift)/iu,
} satisfies Record<Initial12RMExerciseId, RegExp>;
const DAY_NAMES: Readonly<Record<string, string>> = {
  monday: "周一",
  tuesday: "周二",
  wednesday: "周三",
  thursday: "周四",
  friday: "周五",
  saturday: "周六",
  sunday: "周日",
};
const SESSION_TYPE_NAMES: Readonly<Record<string, string>> = {
  "full-body": "全身训练",
  torso: "躯干训练",
  limbs: "四肢训练",
  strength_test: "力量测试",
  recovery: "恢复训练",
  test: "力量测试",
};
const OTHER_EXERCISE_NAMES: Readonly<Record<string, string>> = {
  "pull-up": "引体向上",
  plank: "平板支撑",
  "dumbbell-overhead-press": "哑铃肩推",
  "dumbbell-lateral-raise": "哑铃侧平举",
};

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
    userTimezone: () => currentOpenClawConfig(api).agents?.defaults?.userTimezone,
    preflight,
  });
  const pendingMediaBySession = new Map<string, PluginHookInboundClaimEvent[]>();
  const workoutLogConfirmation = createWorkoutLogConfirmationCoordinator({
    store: createRuntimeDirectoryConfirmationSessionStore({
      runtimeDirectory: () =>
        join(api.runtime.state.resolveStateDir(process.env), PLUGIN_ID),
    }),
    pending: (confirmationId) =>
      stellaRuntime.pendingWorkoutLogConfirmation(confirmationId),
    confirm: (input) => stellaRuntime.confirmWorkoutLog(input),
    cancel: (confirmationId) =>
      stellaRuntime.cancelWorkoutLogConfirmation(confirmationId),
    classifier: createOpenClawConfirmationIntentClassifier({
      complete: (input) => api.runtime.llm.complete(input),
      agentId: () => resolveDedicatedAgentId(
        currentPluginConfig(currentOpenClawConfig(api)),
      ),
    }),
  });
  const confirmationAttemptsByRun = new Set<string>();
  const resolveWorkoutLogConfirmationText = async (input: {
    readonly sessionKey: string;
    readonly text: string;
  }): Promise<string | undefined> => {
    const turn = await workoutLogConfirmation.submit(input);
    if (turn.status === "recorded") return formatWorkoutLogRecording(turn);
    if (turn.status === "confirmation") {
      return formatRemainingWorkoutLogConfirmation(turn);
    }
    if (turn.status === "ambiguous") {
      return "我没能确定你要确认或修改哪些字段，因此没有保存。请明确说“全部确认”，或直接说明字段和值。";
    }
    if (turn.status === "cancelled") {
      return "已取消这次训练日志确认，没有保存或更新进度。";
    }
    return undefined;
  };
  const tryWorkoutLogConfirmationText = async (input: {
    readonly sessionKey?: string;
    readonly runId?: string;
    readonly text: string;
  }): Promise<string | undefined> => {
    if (input.sessionKey === undefined) return undefined;
    if (input.runId !== undefined && confirmationAttemptsByRun.has(input.runId)) {
      return undefined;
    }
    if (input.runId !== undefined) {
      if (confirmationAttemptsByRun.size >= 1_024) {
        const oldest = confirmationAttemptsByRun.values().next().value;
        if (oldest !== undefined) confirmationAttemptsByRun.delete(oldest);
      }
      confirmationAttemptsByRun.add(input.runId);
    }
    try {
      return await resolveWorkoutLogConfirmationText({
        sessionKey: input.sessionKey,
        text: input.text,
      });
    } catch (error) {
      api.logger?.error(
        `stella-fitness workout-log confirmation routing failed: ${String(error)}`,
      );
      return "训练日志确认状态无法读取，因此没有保存或更新进度。请重新发送训练日志照片。";
    }
  };
  registerPrintableLogDownloadRoute(api, stellaRuntime);
  api.registerService({
    id: "stella-fitness-media-lifecycle",
    start() {},
    async stop() {
      pendingMediaBySession.clear();
      confirmationAttemptsByRun.clear();
      printableLogDownloadTokens.clear();
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
      const agentReply = requireDedicatedAgent(context, api);
      if (agentReply !== undefined) return agentReply;
      const statusText = formatJourneyStatus(await stellaRuntime.programJourneyStatus());
      return { text: statusText };
    },
  });

  api.registerCommand({
    name: "stella-prerequisite",
    description: "Acknowledge one non-medical Built-in Program prerequisite",
    acceptsArgs: true,
    requireAuth: true,
    async handler(context) {
      const bindingReply = requireDedicatedAgent(context, api);
      if (bindingReply !== undefined) return bindingReply;
      const prerequisiteId = context.args?.trim();
      if (prerequisiteId === undefined || prerequisiteId.length === 0) {
        return {
          text: "请直接告诉我你已经准备好的项目，例如“我已准备好可拆卸哑铃”。",
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
      const bindingReply = requireDedicatedAgent(context, api);
      if (bindingReply !== undefined) return bindingReply;
      const text = context.args?.trim();
      if (text === undefined || text.length === 0) {
        return { text: "请告诉我体重和单位，例如“体重 67 kg”。" };
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
        return { text: `已删除这条初始体重记录。\n${formatJourneyStatus(await stellaRuntime.programJourneyStatus())}` };
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
      const bindingReply = requireDedicatedAgent(context, api);
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
        return { text: `已删除${exerciseName(observation.exerciseId)}的初始 12RM。\n${formatJourneyStatus(await stellaRuntime.programJourneyStatus())}` };
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
        return { text: `已将${exerciseName(observation.exerciseId)}的初始 12RM 更正为 ${observation.result.value} kg。\n${formatJourneyStatus(await stellaRuntime.programJourneyStatus())}` };
      }
      const input = parseInitial12RMCommand(context.args);
      if (input === undefined) {
        return {
          text: "请直接告诉我动作和 12RM，例如“高脚杯深蹲 12RM 29 kg”。",
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
          `已记录${exerciseName(observation.exerciseId)}初始 12RM：${observation.result.value} kg。`,
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
      const bindingReply = requireDedicatedAgent(context, api);
      if (bindingReply !== undefined) return bindingReply;
      const cycleStart = context.args?.trim() ?? "";
      return { text: await activateProgramReply(stellaRuntime, cycleStart) };
    },
  });

  api.registerCommand({
    name: "stella-facts",
    description: "Read deterministic today, next or week Planned Session facts",
    acceptsArgs: true,
    requireAuth: true,
    async handler(context) {
      const bindingReply = requireDedicatedAgent(context, api);
      if (bindingReply !== undefined) return bindingReply;
      const input = parseFactsCommand(context.args);
      if (input === undefined) {
        return { text: factsUsage() };
      }
      return {
        text: input.kind === "weight"
          ? formatWeightFacts(await stellaRuntime.weightFacts())
          : await formatAvailableProgramFacts(stellaRuntime, input),
      };
    },
  });

  api.registerCommand({
    name: "stella-print",
    description: "Send the complete built-in workout-log workbook",
    acceptsArgs: false,
    requireAuth: true,
    async handler(context) {
      const bindingReply = requireDedicatedAgent(context, api);
      if (bindingReply !== undefined) return bindingReply;
      const result = await stellaRuntime.printableLog();
      if (context.channel === "webchat") {
        const downloadUrl = createPrintableLogDownloadUrl();
        return {
          text: `完整 12 周训练日志工作簿\n[下载 ${PRINTABLE_LOG_FILE_NAME}](${downloadUrl})`,
        };
      }
      return {
        text: "完整 12 周训练日志工作簿",
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
      const bindingReply = requireDedicatedAgent(context, api);
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
        if (!isUnavailableJourneyConfirmation(error)) {
          api.logger?.error(`stella-confirm journey routing failed: ${String(error)}`);
          throw error;
        }
        try {
          const result = await stellaRuntime.confirmWorkoutLog(confirmation);
          return { text: formatWorkoutLogRecording(result) };
        } catch (workoutError) {
          api.logger?.error(`stella-confirm workout failed: ${String(workoutError)}`);
          throw workoutError;
        }
      }
    },
  });

  api.on(
    "message_received",
    (event, context) => {
      const sessionKey = context.sessionKey;
      if (
        sessionKey === undefined ||
        !isDedicatedAgentContext(context, api)
      ) return;
      const metadata = event.metadata;
      if (
        metadata === undefined ||
        (nonBlankString(metadata.mediaPath) === undefined &&
          firstNonBlankString(metadata.mediaPaths) === undefined)
      ) return;
      const pending = pendingMediaBySession.get(sessionKey) ?? [];
      pending.push({
        content: event.content,
        channel: context.channelId,
        isGroup: false,
        ...(event.messageId === undefined ? {} : { messageId: event.messageId }),
        ...(event.runId === undefined ? {} : { runId: event.runId }),
        ...(event.timestamp === undefined ? {} : { timestamp: event.timestamp }),
        metadata,
      });
      pendingMediaBySession.set(sessionKey, pending);
    },
    { priority: 100 },
  );

  api.on(
    "inbound_claim",
    async (event, context) => {
      if (!isDedicatedInboundContext(event, context, api)) return;
      const confirmationInput = workoutLogConfirmationInput(event);
      if (confirmationInput !== undefined) {
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
          if (context.sessionKey !== undefined) {
            await workoutLogConfirmation.complete({
              sessionKey: context.sessionKey,
              confirmationId: confirmation.confirmationId,
            }).catch((cleanupError) => {
              api.logger?.error(
                `stella-fitness exact confirmation cleanup failed: ${String(cleanupError)}`,
              );
            });
          }
          return {
            handled: true,
            reply: { text: formatWorkoutLogRecording(result) },
          };
        }
      }
      const boundCommand = parseBoundStellaCommand(event);
      if (boundCommand !== undefined) {
        return await handleBoundStellaCommand(
          stellaRuntime,
          event,
          boundCommand,
        );
      }
      if (context.sessionKey !== undefined) {
        let replyText: string | undefined;
        try {
          replyText = await tryWorkoutLogConfirmationText({
            sessionKey: context.sessionKey,
            ...(context.runId === undefined ? {} : { runId: context.runId }),
            text: [event.content, event.body, event.bodyForAgent]
              .find((value): value is string => typeof value === "string") ?? "",
          });
        } catch (error) {
          api.logger?.error(
            `stella-fitness workout-log confirmation routing failed: ${String(error)}`,
          );
          return {
            handled: true,
            reply: {
              text: "训练日志确认状态无法读取，因此没有保存或更新进度。请重新发送训练日志照片。",
            },
          };
        }
        if (replyText !== undefined) {
          return { handled: true, reply: { text: replyText } };
        }
      }
      {
        const text = [event.content, event.body, event.bodyForAgent]
          .find((value): value is string => typeof value === "string") ?? "";
        const { receivedAt, source } = inboundSource(event);
        const reply = await handleDedicatedTextInputSafely({ text, receivedAt, source });
        if (reply !== undefined) {
          return { handled: true, reply };
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
        intent: workoutLogIntent(event),
        runId:
          event.runId ??
          event.messageId ??
          `workout-log-${randomUUID()}`,
        upload,
        timeoutMs: 60_000,
        signal: new AbortController().signal,
      };
      const correctionId = workoutLogCorrectionId(event);
      if (correctionId !== undefined) request.intent = "explicit";
      let result;
      try {
        result = correctionId === undefined
          ? await stellaRuntime.ingestWorkoutLog(request)
          : await stellaRuntime.correctWorkoutLog({
              ...request,
              replacesObservationId: correctionId,
            });
      } catch (error) {
        if (error instanceof MultiSessionWorkoutLogPageError) {
          return {
            handled: true,
            reply: {
              text: "这张照片包含多次训练。请裁剪到只保留一次训练记录后重新发送。",
            },
          };
        }
        throw error;
      }
      if (result.status === "ignored") return;
      if (result.status === "confirmation" && context.sessionKey !== undefined) {
        await workoutLogConfirmation.bind({
          sessionKey: context.sessionKey,
          confirmationId: result.confirmationId,
          issuedAt: result.artifact.provenance.receivedAt,
          ...(event.messageId === undefined ? {} : { messageId: event.messageId }),
        });
      }
      return {
        handled: true,
        reply: { text: formatWorkoutLogResult(result) },
      };
    },
    { priority: 100, timeoutMs: 65_000 },
  );

  api.on(
    "reply_dispatch",
    async (event, context) => {
      if (!isDedicatedAgentContext(event, api)) return;
      const sessionKey = event.sessionKey;
      if (sessionKey === undefined) return;
      const pending = pendingMediaBySession.get(sessionKey);
      if (pending === undefined || pending.length === 0) return;
      const matchingIndex = event.runId === undefined
        ? 0
        : pending.findIndex((item) => item.runId === event.runId);
      const pendingMedia = pending.splice(matchingIndex < 0 ? 0 : matchingIndex, 1)[0];
      if (pending.length === 0) pendingMediaBySession.delete(sessionKey);
      if (pendingMedia === undefined) return;
      const upload = await workoutLogUpload(pendingMedia);
      if (upload === undefined) return;
      let replyText: string;
      try {
        const result = await stellaRuntime.ingestWorkoutLog({
          intent: workoutLogIntent(pendingMedia),
          runId: event.runId ?? `workout-log-${randomUUID()}`,
          upload,
          timeoutMs: 60_000,
          signal: new AbortController().signal,
        });
        if (result.status === "ignored") return;
        if (result.status === "confirmation") {
          await workoutLogConfirmation.bind({
            sessionKey,
            confirmationId: result.confirmationId,
            issuedAt: result.artifact.provenance.receivedAt,
            ...(pendingMedia.messageId === undefined
              ? {}
              : { messageId: pendingMedia.messageId }),
          });
        }
        replyText = formatWorkoutLogResult(result);
      } catch (error) {
        if (error instanceof MultiSessionWorkoutLogPageError) {
          replyText = "这张照片包含多次训练。请裁剪到只保留一次训练记录后重新发送。";
        } else {
          throw error;
        }
      }
      const queuedFinal = context.dispatcher.sendFinalReply({ text: replyText });
      context.dispatcher.markComplete();
      context.recordProcessed("completed", { reason: "stella-fitness-media" });
      context.markIdle("stella-fitness-media");
      return {
        handled: true,
        queuedFinal,
        counts: context.dispatcher.getQueuedCounts(),
      };
    },
    { priority: 100, timeoutMs: 65_000 },
  );

  const handleDedicatedTextInput = async (input: {
    readonly text: string;
    readonly receivedAt: string;
    readonly source: {
      readonly channel?: string;
      readonly messageId?: string;
      readonly runId?: string;
    };
  }): Promise<{ readonly text: string } | undefined> => {
      const { text, receivedAt, source } = input;
      if (normalizeStatusInput(text) === STATUS_INPUT) {
        return createStatusResponse(preflight());
      }
      const activationIntent = parseNaturalActivationIntent(text, receivedAt.slice(0, 10));
      if (activationIntent !== undefined) {
        const status = await stellaRuntime.programJourneyStatus({
          date: receivedAt.slice(0, 10),
        });
        if (status.state !== "READY_TO_ACTIVATE") {
          return { text: formatJourneyStatus(status, receivedAt.slice(0, 10)) };
        }
        if (activationIntent.kind === "clarification") {
          return { text: activationIntent.message };
        }
        if (activationIntent.kind === "defer") {
          return { text: "好的，暂不开始。准备好后告诉我“本周开始”或“下周开始”即可。" };
        }
        return {
          text: await activateProgramReply(stellaRuntime, activationIntent.cycleStart),
        };
      }
      const prerequisiteId = parseNaturalPrerequisiteAcknowledgement(
        text,
      );
      if (prerequisiteId !== undefined) {
        const status = await stellaRuntime.acknowledgePrerequisite({
          prerequisiteId,
          acknowledgedAt: receivedAt,
          source: {
            kind: "user-text",
            text,
            ...source,
          },
        });
        return { text: formatJourneyStatus(status, receivedAt.slice(0, 10)) };
      }
      const factQuery = parseNaturalProgramFactsQuery(
        text,
        receivedAt.slice(0, 10),
      );
      if (isOutOfScopeProgramQuestion(text)) {
        const result = await stellaRuntime.programFacts({
          kind: "unsupported",
          question: text,
        });
        return { text: formatProgramFacts(result) };
      }
      if (isWeightFactsQuery(text)) {
        return { text: formatWeightFacts(await stellaRuntime.weightFacts()) };
      }
      if (factQuery !== undefined) {
        return {
          text: await formatAvailableProgramFacts(stellaRuntime, factQuery),
        };
      }
      if (isInitial12RMText(text)) {
        const journeyStatus = await stellaRuntime.programJourneyStatus({
          date: receivedAt.slice(0, 10),
        });
        if (
          journeyStatus.state !== "INITIAL_12RM_REQUIRED" &&
          journeyStatus.state !== "READY_TO_ACTIVATE"
        ) {
          return { text: formatJourneyStatus(journeyStatus, receivedAt.slice(0, 10)) };
        }
        const result = await stellaRuntime.submitProgramJourneyText({
          text,
          receivedAt,
          source,
        });
        return {
          text: await formatProgramJourneyTextResult(
            stellaRuntime,
            result,
            receivedAt.slice(0, 10),
          ),
        };
      }
      if (!isBodyWeightInput(text)) {
        if (isQuestion(text)) {
          const result = await stellaRuntime.programFacts({
            kind: "unsupported",
            question: text,
          });
          return { text: formatProgramFacts(result) };
        }
        return;
      }
      const correctionId = bodyWeightCorrectionId(text);
      if (correctionId === undefined) {
        const journeyStatus = await stellaRuntime.programJourneyStatus({
          date: receivedAt.slice(0, 10),
        });
        if (
          journeyStatus.state === "BASELINE_WEIGHT_REQUIRED" ||
          journeyStatus.state === "PHASE_CHECKPOINT_REQUIRED"
        ) {
          const result = await stellaRuntime.submitProgramJourneyText({
            text,
            receivedAt,
            source,
          });
          return {
            text: await formatProgramJourneyTextResult(
              stellaRuntime,
              result,
              receivedAt.slice(0, 10),
            ),
          };
        }
        const result = await recordJourneyAwareBodyWeight(stellaRuntime, {
          text,
          receivedAt,
          source,
        });
        return {
          text: result.status === "clarification"
            ? result.question
            : formatJourneyBodyWeight(result),
        };
      }
      const result = await stellaRuntime.correctBodyWeight({
        replacesObservationId: correctionId,
        text,
        receivedAt,
        source,
      });
      return {
        text: result.status === "clarification"
          ? result.question
          : formatBodyWeightCorrection(result),
      };
  };

  const handleDedicatedTextInputSafely = async (
    input: Parameters<typeof handleDedicatedTextInput>[0],
  ): Promise<{ readonly text: string } | undefined> => {
    try {
      return await handleDedicatedTextInput(input);
    } catch (error) {
      api.logger?.error(`stella-fitness dedicated text routing failed: ${String(error)}`);
      return { text: "这次没有处理成功，也没有保存任何新记录。请稍后重试。" };
    }
  };

  api.on(
    "before_agent_reply",
    async (event, context) => {
      if (!isDedicatedAgentContext(context, api)) return;
      const receivedAt = new Date().toISOString();
      const confirmationReply = await tryWorkoutLogConfirmationText({
        ...(context.sessionKey === undefined ? {} : { sessionKey: context.sessionKey }),
        ...(context.runId === undefined ? {} : { runId: context.runId }),
        text: event.cleanedBody,
      });
      if (confirmationReply !== undefined) {
        return { handled: true, reply: { text: confirmationReply } };
      }
      const reply = await handleDedicatedTextInputSafely({
        text: event.cleanedBody,
        receivedAt,
        source: {
          ...(context.messageProvider === undefined
            ? {}
            : { channel: context.messageProvider }),
          ...(context.runId === undefined ? {} : { runId: context.runId }),
        },
      });
      return reply === undefined ? undefined : { handled: true, reply };
    },
    { priority: 100, timeoutMs: 6_000 },
  );

  api.on(
    "before_agent_run",
    async (event, context) => {
      if (!isDedicatedAgentContext(context, api)) {
        return { outcome: "pass" as const };
      }
      if (hasHostMediaMarker(event.prompt)) {
        return { outcome: "pass" as const };
      }
      const confirmationReply = await tryWorkoutLogConfirmationText({
        ...(context.sessionKey === undefined ? {} : { sessionKey: context.sessionKey }),
        ...(context.runId === undefined ? {} : { runId: context.runId }),
        text: event.prompt,
      });
      if (confirmationReply !== undefined) {
        return {
          outcome: "block" as const,
          reason: "stella-workout-log-confirmation-is-plugin-owned",
          message: confirmationReply,
          category: "plugin-command",
        };
      }
      const reply = await handleDedicatedTextInputSafely({
        text: event.prompt,
        receivedAt: new Date().toISOString(),
        source: {
          ...(context.messageProvider === undefined
            ? {}
            : { channel: context.messageProvider }),
          ...(context.runId === undefined ? {} : { runId: context.runId }),
        },
      });
      const reason = normalizeStatusInput(event.prompt) === STATUS_INPUT
        ? "stella-status-is-plugin-owned"
        : isBodyWeightInput(event.prompt)
        ? "stella-body-weight-is-plugin-owned"
        : "stella-dedicated-input-is-plugin-owned";
      return reply === undefined
        ? { outcome: "pass" as const }
        : {
            outcome: "block" as const,
            reason,
            message: reply.text,
            category: "plugin-command",
          };
    },
    { priority: 100, timeoutMs: 6_000 },
  );
  return stellaRuntime;
}

function registerPrintableLogDownloadRoute(
  api: Parameters<NonNullable<OpenClawPluginDefinition["register"]>>[0],
  stellaRuntime: StellaFitnessRuntime,
): void {
  api.registerHttpRoute({
    path: PRINTABLE_LOG_DOWNLOAD_ROUTE,
    auth: "plugin",
    match: "prefix",
    async handler(request, response) {
      const method = request.method ?? "GET";
      if (method !== "GET" && method !== "HEAD") {
        response.statusCode = 405;
        response.setHeader("Allow", "GET, HEAD");
        response.end();
        return true;
      }

      const now = Date.now();
      for (const [token, expiresAt] of printableLogDownloadTokens) {
        if (expiresAt <= now) printableLogDownloadTokens.delete(token);
      }
      const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
      const match = new RegExp(
        `^${PRINTABLE_LOG_DOWNLOAD_ROUTE}([0-9a-f-]+)/${PRINTABLE_LOG_FILE_NAME}$`,
        "u",
      ).exec(pathname);
      const expiresAt = match?.[1] === undefined
        ? undefined
        : printableLogDownloadTokens.get(match[1]);
      if (expiresAt === undefined || expiresAt <= now) {
        response.statusCode = 404;
        response.setHeader("Cache-Control", "no-store");
        response.end();
        return true;
      }

      const result = await stellaRuntime.printableLog();
      const bytes = await readFile(result.path);
      response.statusCode = 200;
      response.setHeader("Content-Type", result.mediaType);
      response.setHeader("Content-Length", String(bytes.byteLength));
      response.setHeader(
        "Content-Disposition",
        `attachment; filename="${result.fileName}"`,
      );
      response.setHeader("Cache-Control", "private, no-store");
      response.setHeader("X-Content-Type-Options", "nosniff");
      response.end(method === "HEAD" ? undefined : bytes);
      return true;
    },
  });
}

function createPrintableLogDownloadUrl(): string {
  const token = randomUUID();
  printableLogDownloadTokens.set(
    token,
    Date.now() + PRINTABLE_LOG_DOWNLOAD_TTL_MS,
  );
  return `${PRINTABLE_LOG_DOWNLOAD_ROUTE}${token}/${PRINTABLE_LOG_FILE_NAME}`;
}

function isWorkoutLogImageInput(event: PluginHookInboundClaimEvent): boolean {
  const text = [event.content, event.body, event.bodyForAgent]
    .filter((value): value is string => typeof value === "string")
    .join(" ");
  return event.metadata !== undefined ||
    /(?:训练(?:日志|记录)|记录训练|workout\s*log)/iu.test(text);
}

function workoutLogIntent(
  event: PluginHookInboundClaimEvent,
): "auto" | "explicit" {
  const text = [event.content, event.body, event.bodyForAgent]
    .filter((value): value is string => typeof value === "string")
    .join(" ");
  return /(?:训练(?:日志|记录)|记录训练|workout\s*log)/iu.test(text)
    ? "explicit"
    : "auto";
}

function hasHostMediaMarker(text: string): boolean {
  return /(?:\[media attached(?:\s+\d+\/\d+)?:|<media:[^>]+>|(?:^|\n)\s*MEDIA:)/iu.test(
    text,
  );
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
        reply: { text: `已删除这条初始体重记录。\n${formatJourneyStatus(await runtime.programJourneyStatus())}` },
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
        reply: { text: `已删除${exerciseName(observation.exerciseId)}的初始 12RM。\n${formatJourneyStatus(await runtime.programJourneyStatus())}` },
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
        reply: { text: `已将${exerciseName(observation.exerciseId)}的初始 12RM 更正为 ${observation.result.value} kg。\n${formatJourneyStatus(await runtime.programJourneyStatus())}` },
      };
    }
    const input = parseInitial12RMCommand(command.args);
    if (input === undefined) {
      return {
        handled: true,
        reply: {
          text: "请直接告诉我动作和 12RM，例如“高脚杯深蹲 12RM 29 kg”。",
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
          `已记录${exerciseName(observation.exerciseId)}初始 12RM：${observation.result.value} kg。`,
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
          : input.kind === "weight"
            ? formatWeightFacts(await runtime.weightFacts())
            : await formatAvailableProgramFacts(runtime, input),
      },
    };
  }
  const result = await runtime.printableLog();
  return {
    handled: true,
    reply: {
      text: "完整 12 周训练日志工作簿",
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
      "确认信息格式不正确，请直接补充说明或重新发送清晰的训练日志。",
    );
  }
  const values: unknown = JSON.parse(match[2]!);
  const record = asRecord(values);
  if (record === undefined) {
    throw new Error("确认内容无法识别，请直接补充说明或重新发送清晰的训练日志。");
  }
  const canonicalValues: Record<string, unknown> = {};
  for (const [path, value] of Object.entries(record)) {
    const canonicalPath = canonicalConfirmationPath(path);
    if (Object.hasOwn(canonicalValues, canonicalPath)) {
      throw new Error(`确认内容中有重复字段：${canonicalPath}`);
    }
    canonicalValues[canonicalPath] = value;
  }
  return { confirmationId: match[1]!, values: canonicalValues };
}

function canonicalConfirmationPath(path: string): string {
  return path.replace(/^(exercises|testResults)\.(\d+)(?=\.)/u, "$1[$2]");
}

function formatWorkoutLogResult(
  result: Awaited<ReturnType<StellaFitnessRuntime["ingestWorkoutLog"]>>,
): string {
  if (result.status === "recorded") {
    return formatWorkoutLogRecording(result);
  }
  if (result.status === "user-action-required") {
    if (result.reason === "no-due-session") {
      return "本周截至当前没有尚未记录的计划训练；不会选择未来训练日或其他周。";
    }
    if (result.reason === "training-record-invalid") {
      return "现有训练记录无法安全读取，因此尚未保存这张照片。请先处理记录错误后重试。";
    }
    if (result.reason === "program-target-invalid") {
      return "当前计划无法确定唯一训练目标，因此尚未保存这张照片。";
    }
    const target = result.target;
    const targetText = target === undefined
      ? "本次计划训练区块"
      : `第 ${target.stage} 阶段第 ${target.week} 周，${dayName(target.weekday)}，${sessionTypeName(target.sessionType)}`;
    if (result.reason === "target-mismatch") {
      return `照片内容与确定性目标（${targetText}）不匹配，因此未保存、未计入进度。`;
    }
    return `未能清晰读取确定性目标（${targetText}）。请只补拍该训练区块，确保标题和填写内容完整可见。`;
  }
  if (result.status === "ignored") return "";
  const targetText = result.target === undefined
    ? "照片中的训练区块"
    : `第 ${result.target.stage} 阶段第 ${result.target.week} 周，${dayName(result.target.weekday)}，${sessionTypeName(result.target.sessionType)}`;
  return [
    `已定位到${targetText}，但以下字段需要你确认；确认前尚未保存，也不会计入进度：`,
    ...result.fields.map((field) =>
      `- ${formatWorkoutLogConfirmationField(result.candidate, field)}`
    ),
    "你可以直接回复“全部确认”，或用自然语言指出要修改、补充的字段。",
  ].join("\n");
}

function formatRemainingWorkoutLogConfirmation(result: {
  readonly candidate: WorkoutLogCandidate;
  readonly fields: WorkoutLogCandidate["uncertainFields"];
  readonly acceptedCount: number;
}): string {
  return [
    `已确认其余 ${result.acceptedCount} 个识别值，但还缺少：${result.fields.map((field) =>
      workoutLogFieldLabel(
        result.candidate,
        parseWorkoutLogFieldPath(field.path),
      )
    ).join("、")}。`,
    ...result.fields.map((field) =>
      `- ${formatWorkoutLogConfirmationField(result.candidate, field)}`
    ),
    "请直接回复缺少的实际值；如果原表确实未填写，请明确回复“未填写”。",
  ].join("\n");
}

function formatWorkoutLogConfirmationField(
  candidate: WorkoutLogCandidate,
  field: WorkoutLogCandidate["uncertainFields"][number],
): string {
  const location = parseWorkoutLogFieldPath(field.path);
  const label = workoutLogFieldLabel(candidate, location);
  if (field.candidates !== undefined && field.candidates.length > 0) {
    return field.candidates.length === 1
      ? `${label}：识别为${formatWorkoutLogCandidateOption(candidate, location, field.candidates[0]!)}，请确认。`
      : `${label}：可能是${field.candidates.map((value) => formatWorkoutLogCandidateOption(candidate, location, value)).join("或")}，请确认。`;
  }
  const value = workoutLogCandidateFieldValue(candidate, field.path);
  return value === null || value === undefined
    ? `${label}：无法识别，请填写实际值。`
    : `${label}：识别为“${formatWorkoutLogFieldValue(value)}”，请确认。`;
}

function formatWorkoutLogCandidateOption(
  candidate: WorkoutLogCandidate,
  location: ReturnType<typeof parseWorkoutLogFieldPath>,
  value: string,
): string {
  if (
    location?.kind === "set" &&
    "exercises" in candidate &&
    candidate.exercises[location.exerciseIndex]?.exerciseId.value === "plank"
  ) {
    return `${value} 秒`;
  }
  return `“${value}”`;
}

function workoutLogFieldLabel(
  candidate: WorkoutLogCandidate,
  location: ReturnType<typeof parseWorkoutLogFieldPath>,
): string {
  if (location === undefined) return "未知字段";
  if (location.kind === "top-level") {
    return {
      layout: "训练日志版式",
      stage: "阶段",
      week: "周次",
      weekday: "训练日",
      sessionType: "训练类型",
    }[location.key];
  }
  if (location.kind === "test-result") {
    if (!("testResults" in candidate)) return `测试 ${location.testResultIndex + 1}`;
    const result = candidate.testResults[location.testResultIndex];
    const exercise = result === undefined
      ? `测试 ${location.testResultIndex + 1}`
      : exerciseDisplayName(result.exerciseId.value);
    return `${exercise}的${location.key === "result" ? "测试结果" : "动作"}`;
  }
  if (!("exercises" in candidate)) return `动作 ${location.exerciseIndex + 1}`;
  const exercise = candidate.exercises[location.exerciseIndex];
  const name = exercise === undefined
    ? `动作 ${location.exerciseIndex + 1}`
    : exerciseDisplayName(exercise.exerciseId.value);
  if (location.kind === "set") {
    const measure = exercise?.exerciseId.value === "plank" ? "时长" : "次数";
    return `${name}第 ${location.setIndex + 1} 组${measure}`;
  }
  return `${name}的${{
    rawLabel: "动作名称",
    exerciseId: "动作",
    load: "重量",
    actionQuality: "动作质量",
    problemNote: "问题备注",
  }[location.key]}`;
}

function workoutLogCandidateFieldValue(
  candidate: WorkoutLogCandidate,
  path: string,
): unknown {
  const location = parseWorkoutLogFieldPath(path);
  if (location === undefined) return null;
  if (location.kind === "top-level") {
    return candidate[location.key].value;
  }
  if (location.kind === "test-result") {
    if (!("testResults" in candidate)) return null;
    return candidate.testResults[location.testResultIndex]?.[location.key].value ?? null;
  }
  if (!("exercises" in candidate)) return null;
  const exercise = candidate.exercises[location.exerciseIndex];
  if (exercise === undefined) return null;
  return location.kind === "set"
    ? exercise.sets[location.setIndex]?.value ?? null
    : exercise[location.key].value;
}

function formatWorkoutLogFieldValue(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (value !== null && typeof value === "object" && "raw" in value) {
    return String(value.raw);
  }
  return JSON.stringify(value);
}

function formatWorkoutLogRecording(
  result: { readonly observation: Awaited<
    ReturnType<StellaFitnessRuntime["confirmWorkoutLog"]>
  >["observation"]; readonly progress?: Awaited<
    ReturnType<StellaFitnessRuntime["confirmWorkoutLog"]>
  >["progress"] },
): string {
  const { observation } = result;
  const progress = result.progress === undefined
    ? ""
    : `本周已记录 ${result.progress.recordedSessions}/${result.progress.plannedSessions} 次；${
        result.progress.nextSession === undefined
          ? "当前周期暂无下一次计划训练。"
          : `下一次计划：${result.progress.nextSession.date}（${dayName(result.progress.nextSession.weekday)}）${sessionTypeName(result.progress.nextSession.sessionType)}。`
      }`;
  if (observation.provenance.kind === "workout-log-correction") {
    return `已更正训练记录：第 ${observation.stage.value} 阶段第 ${observation.week.value} 周，${dayName(observation.weekday.value)}，${sessionTypeName(observation.sessionType.value)}。${progress}`;
  }
  return `已记录训练：第 ${observation.stage.value} 阶段第 ${observation.week.value} 周，${dayName(observation.weekday.value)}，${sessionTypeName(observation.sessionType.value)}。${progress}`;
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

type NaturalActivationIntent =
  | { readonly kind: "activate"; readonly cycleStart: string }
  | { readonly kind: "clarification"; readonly message: string }
  | { readonly kind: "defer" };

function parseNaturalActivationIntent(
  text: string,
  referenceDate: string,
): NaturalActivationIntent | undefined {
  if (/^\s*(?:暂不开始|先不开始|以后再说|稍后再说)[。.!]?\s*$/u.test(text)) {
    return { kind: "defer" };
  }
  if (/^\s*(?:开始|确认开始|现在开始)[。.!]?\s*$/u.test(text)) {
    return {
      kind: "clarification",
      message: "请回复“本周开始”或“下周开始”，我不会替你猜开始日期。",
    };
  }
  if (/^\s*(?:从)?本周(?:一)?开始[。.!]?\s*$/u.test(text)) {
    return { kind: "activate", cycleStart: mondayFor(referenceDate, 0) };
  }
  if (/^\s*(?:从)?下周(?:一)?开始[。.!]?\s*$/u.test(text)) {
    return { kind: "activate", cycleStart: mondayFor(referenceDate, 7) };
  }
  const explicitDate = /^\s*(?:从)?(\d{4}-\d{2}-\d{2})(?:（?周一）?)?(?:正式)?开始[。.!]?\s*$/u.exec(text)?.[1];
  if (explicitDate === undefined) return undefined;
  if (!isMonday(explicitDate)) {
    return {
      kind: "clarification",
      message: `${explicitDate} 不是周一。请选择一个周一作为正式开始日期。`,
    };
  }
  return { kind: "activate", cycleStart: explicitDate };
}

function mondayFor(referenceDate: string, offsetDays: 0 | 7): string {
  const date = new Date(`${referenceDate}T00:00:00.000Z`);
  const day = date.getUTCDay();
  date.setUTCDate(date.getUTCDate() - (day === 0 ? 6 : day - 1) + offsetDays);
  return date.toISOString().slice(0, 10);
}

function isMonday(date: string): boolean {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === date &&
    parsed.getUTCDay() === 1;
}

function isUnavailableJourneyConfirmation(error: unknown): boolean {
  return error instanceof Error &&
    error.message === "Program Journey confirmation is unavailable";
}

async function formatProgramJourneyTextResult(
  runtime: StellaFitnessRuntime,
  result: Awaited<ReturnType<StellaFitnessRuntime["submitProgramJourneyText"]>>,
  referenceDate?: string,
): Promise<string> {
  if (result.kind === "course-start-12rm-batch") {
    if (result.status === "clarification") {
      return result.fields.map(({ question }) => question).join("\n");
    }
    return [
      `已记录初始 12RM：${result.observations.map((observation) =>
        `${exerciseName(observation.exerciseId)} ${observation.result.value} kg`
      ).join("、")}。`,
      formatJourneyStatus(await runtime.programJourneyStatus(), referenceDate),
    ].join("\n");
  }
  if (result.status === "confirmation") {
    return `这条信息还不够明确，没有保存。${result.fields.map(({ question }) => question).join(" ")} 请用一句完整、明确的话重新发送。`;
  }
  const fact = result.kind === "baseline-body-weight"
    ? `已记录初始体重：${result.observation.value.amount} ${result.observation.value.unit}。`
    : result.kind === "checkpoint-body-weight"
      ? `已记录第 ${result.checkpointWeek} 周体重：${result.observation.value.amount} ${result.observation.value.unit}。`
      : `已记录${exerciseName(result.observation.exerciseId)}初始 12RM：${result.observation.result.value} kg。`;
  return [
    fact,
    formatJourneyStatus(await runtime.programJourneyStatus(), referenceDate),
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
  return `已记录体重：${observation.value.amount} ${observation.value.unit}（${observation.occurredAt.slice(0, 10)}）。目前共有 ${view.points.length} 条体重记录。`;
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
  return `已将体重记录更正为 ${observation.value.amount} ${observation.value.unit}。目前共有 ${view.points.length} 条有效体重记录。`;
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
      userTimezone: openclawConfig.agents?.defaults?.userTimezone,
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
  referenceDate = new Date().toISOString().slice(0, 10),
): string {
  if (status.errors.length > 0) {
    return "读取训练记录时遇到问题，请稍后重试。你的已有记录没有被修改。";
  }
  if (status.state === "PREREQUISITES_REQUIRED") {
    return `开始前还需要确认：${prerequisiteName(status.missingPrerequisiteIds[0]!)}。确认准备好后直接告诉我。`;
  }
  if (status.state === "BASELINE_WEIGHT_REQUIRED") {
    return "准备事项已确认。请告诉我你的初始体重，例如“体重 67 kg”。";
  }
  if (status.state === "INITIAL_12RM_REQUIRED") {
    return `请记录${status.missingInitial12RMExerciseIds.map(exerciseName).join("、")}的初始 12RM，例如“高脚杯深蹲 12RM 29 kg”。`;
  }
  if (status.state === "READY_TO_ACTIVATE") {
    return `初始化已完成。你想从本周一（${mondayFor(referenceDate, 0)}）还是下周一（${mondayFor(referenceDate, 7)}）开始？`;
  }
  if (status.state === "PHASE_CHECKPOINT_REQUIRED") {
    return `继续查看下一阶段前，请记录第 ${status.requiredCheckpointWeek} 周的体重，例如“体重 69 kg”。`;
  }
  return "训练计划已经开始。你可以问我今天、下次或本周的训练安排。";
}

function prerequisiteName(id: RequiredPrerequisiteId): string {
  return {
    "adjustable-dumbbells": "已准备好可拆卸哑铃",
    "pull-up-bar": "已准备好引体向上杆",
    "printed-workout-log": "已打印训练日志",
    "recording-protocol": "已了解训练记录方式",
  }[id];
}

function exerciseName(id: Initial12RMExerciseId): string {
  return {
    "goblet-squat": "高脚杯深蹲",
    "dumbbell-bench-press": "哑铃卧推",
    "dumbbell-deadlift": "哑铃硬拉",
  }[id];
}

type AvailableProgramFactsQuery = Exclude<
  Parameters<StellaFitnessRuntime["programFacts"]>[0],
  { readonly kind: "unsupported" }
>;

async function formatAvailableProgramFacts(
  runtime: StellaFitnessRuntime,
  query: AvailableProgramFactsQuery,
): Promise<string> {
  const status = await runtime.programJourneyStatus(
    "date" in query ? { date: query.date } : {},
  );
  return status.state === "ACTIVE"
    ? formatProgramFacts(await runtime.programFacts(query))
    : formatJourneyStatus(status, "date" in query ? query.date : undefined);
}

function requireDedicatedAgent(
  context: Pick<PluginCommandContext, "sessionKey">,
  api: Parameters<NonNullable<OpenClawPluginDefinition["register"]>>[0],
): PluginCommandResult | undefined {
  if (isDedicatedAgentContext(context, api)) {
    return undefined;
  }
  return {
    text: "请在 Stella Fitness 专属对话中使用这项功能。",
  };
}

function isDedicatedAgentContext(
  context: { readonly agentId?: string; readonly sessionKey?: string } | undefined,
  api: Parameters<NonNullable<OpenClawPluginDefinition["register"]>>[0],
): boolean {
  const dedicatedAgentId = resolveDedicatedAgentId(
    currentPluginConfig(currentOpenClawConfig(api)),
  );
  if (dedicatedAgentId === undefined) return false;
  return context?.agentId === dedicatedAgentId ||
    resolveAgentIdFromSessionKey(context?.sessionKey) === dedicatedAgentId;
}

function isDedicatedInboundContext(
  event: Pick<PluginHookInboundClaimEvent, "accountId" | "channel">,
  context: { readonly agentId?: string; readonly sessionKey?: string } | undefined,
  api: Parameters<NonNullable<OpenClawPluginDefinition["register"]>>[0],
): boolean {
  if (isDedicatedAgentContext(context, api)) return true;
  const openclawConfig = currentOpenClawConfig(api);
  const dedicatedAgentId = resolveDedicatedAgentId(
    currentPluginConfig(openclawConfig),
  );
  if (dedicatedAgentId === undefined || !Array.isArray(openclawConfig.bindings)) {
    return false;
  }
  const accountId = event.accountId ?? "default";
  return openclawConfig.bindings.some((value) => {
    const binding = asRecord(value);
    const match = asRecord(binding?.match);
    if (binding?.agentId !== dedicatedAgentId || match?.channel !== event.channel) {
      return false;
    }
    if (Object.keys(match).some((key) => key !== "channel" && key !== "accountId")) {
      return false;
    }
    return match.accountId === undefined || match.accountId === accountId;
  });
}

function resolveDedicatedAgentId(
  pluginConfig: Record<string, unknown> | undefined,
): string | undefined {
  const value = pluginConfig?.dedicatedAgentId;
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
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
  | AvailableProgramFactsQuery
  | { readonly kind: "weight" }
  | undefined {
  if (/^\s*weight\s*$/iu.test(args ?? "")) return { kind: "weight" };
  const symbolMatch = /^\s*symbol\s+(\S+)\s+([AN])\s*$/iu.exec(args ?? "");
  if (symbolMatch?.[1] !== undefined && symbolMatch[2] !== undefined) {
    return {
      kind: "symbol",
      exerciseId: symbolMatch[1],
      symbol: symbolMatch[2].toUpperCase() as "A" | "N",
    };
  }
  const match = /^\s*(today|next|week)(?:\s+(\d{4}-\d{2}-\d{2}))?\s*$/iu.exec(
    args ?? "",
  );
  if (match?.[1] === undefined) return undefined;
  return {
    kind: match[1].toLowerCase() as "today" | "next" | "week",
    date: match[2] ?? new Date().toISOString().slice(0, 10),
  };
}

function parseNaturalProgramFactsQuery(
  text: string,
  date: string,
): AvailableProgramFactsQuery | undefined {
  const symbol = /(?:当前|current)?\s*([AN])\s*(?:是多少|是|重量|load|weight|\?|？)/iu.exec(text)?.[1]
    ?.toUpperCase() as "A" | "N" | undefined;
  const exerciseId = INITIAL_12RM_EXERCISES.find((id) =>
    INITIAL_12RM_ALIASES[id].test(text)
  );
  if (exerciseId !== undefined && symbol !== undefined) {
    return { kind: "symbol", exerciseId, symbol };
  }
  if (
    /(?:本周|这周|本星期|这星期)(?:的)?(?:训练|课程|计划|安排|练什么)|(?:给出|查看|看看|显示|告诉我|列出)(?:一下)?(?:本周|这周|本星期|这星期)(?:的)?(?:训练|课程|计划|安排)|this\s+week(?:'s)?\s+(?:workout|session|plan|schedule)/iu.test(text)
  ) {
    return { kind: "week", date };
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

function isWeightFactsQuery(text: string): boolean {
  return /(?:体重(?:事实|变化|checkpoint|检查点)|weight\s+(?:facts|change|checkpoint))/iu.test(text);
}

function isQuestion(text: string): boolean {
  return /(?:[?？]|吗(?:[。.!！]?\s*)$|呢(?:[。.!！]?\s*)$|多少|怎么|如何|能不能|可不可以|是否|会不会|是不是|what|when|where|which|who|why|how|can\s+i|should\s+i)/iu.test(
    text,
  );
}

function factsUsage(): string {
  return "你可以直接问“今天练什么”“下次练什么”“本周训练计划”或“体重变化”。";
}

function formatWeightFacts(
  view: Awaited<ReturnType<StellaFitnessRuntime["weightFacts"]>>,
): string {
  if (view.errors.length > 0) {
    return "读取体重记录时遇到问题，请稍后重试。你的已有记录没有被修改。";
  }
  const lines = ["体重记录："];
  lines.push(view.baseline === undefined
    ? "- 初始体重：尚未记录"
    : `- 初始体重：${view.baseline.amountKg} kg`);
  lines.push(view.current === undefined
    ? "- 当前体重：尚未记录"
    : `- 当前体重：${view.current.amountKg} kg（${view.current.occurredAt.slice(0, 10)}）`);
  for (const week of ["4", "8", "12"] as const) {
    const checkpoint = view.checkpoints[week];
    if (checkpoint === undefined) {
      lines.push(`- 第 ${week} 周：尚未记录`);
      continue;
    }
    lines.push([
      `- 第 ${week} 周：${checkpoint.amountKg} kg`,
      `较初始体重${formatWeightChange(checkpoint.fromBaseline)}`,
      `较上次记录${formatWeightChange(checkpoint.fromPrevious)}`,
    ].join("；"));
  }
  return lines.join("\n");
}

function formatWeightChange(change: {
  readonly changeKg?: number;
  readonly changePercent?: number;
  readonly direction: string;
}): string {
  if (change.changeKg === undefined || change.changePercent === undefined) {
    return "暂无足够数据";
  }
  const prefix = change.changeKg > 0 ? "增加" : change.changeKg < 0 ? "减少" : "变化";
  return `${prefix} ${Math.abs(change.changeKg)} kg（${Math.abs(change.changePercent)}%）`;
}

function formatProgramFacts(
  result: Awaited<ReturnType<StellaFitnessRuntime["programFacts"]>>,
): string {
  if (result.kind === "unsupported") {
    return "我只能记录训练事实并按原计划查询安排，不能评价表现、诊断问题或调整训练和饮食。";
  }
  if (result.kind === "no-session") {
    return result.relation === "today" ? "今天没有安排训练。" : "接下来没有安排训练。";
  }
  if (result.kind === "planned-week-facts") {
    return [
      `本周训练安排（${result.startDate} 至 ${result.endDate}）：`,
      ...result.days.flatMap(({ date, day, session }) =>
        session === null
          ? [`${date}（${dayName(day)}）：休息。`]
          : formatPlannedSession(session, `${date}（${dayName(day)}）`)
      ),
    ].join("\n");
  }
  if (result.kind === "symbol-fact") {
    return `${exerciseDisplayName(result.exerciseId)}当前 ${result.symbol} 重量是 ${result.value} ${result.unit}。`;
  }
  if (result.kind === "symbol-binding-pending") {
    return `${exerciseDisplayName(result.exerciseId)}的 ${result.symbol} 重量还没有确定，需要先完成对应的力量测试记录。`;
  }
  return formatPlannedSession(
    result.session,
    result.relation === "today"
      ? `今天（${result.session.date}）的训练：`
      : `下次训练（${result.session.date}）：`,
  ).join("\n");
}

function formatPlannedSession(
  session: Extract<
    Awaited<ReturnType<StellaFitnessRuntime["programFacts"]>>,
    { readonly kind: "planned-session-facts" }
  >["session"],
  heading: string,
): string[] {
  return [
    heading,
    `第 ${session.cycle.week} 周，${session.recovery ? "恢复训练" : sessionTypeName(session.type)}。`,
    ...session.exercises.map((exercise) =>
      `- ${exercise.displayName ?? exerciseDisplayName(exercise.exerciseId)}：${formatPrescription(exercise.prescription)}；休息${formatRest(exercise)}${
        exercise.resolvedLoad === undefined
          ? exercise.unresolvedLoad === undefined
            ? ""
            : `；${exercise.unresolvedLoad.symbol} 重量待力量测试后确定`
          : `；${exercise.resolvedLoad.symbol} 重量 ${exercise.resolvedLoad.value} ${exercise.resolvedLoad.unit}`
      }`,
    ),
    ...session.tests.map((test) =>
      `- ${exerciseDisplayName(test.exerciseId)}：${test.test} 测试，结果用于后续重量。`
    ),
  ];
}

function formatPrescription(prescription: {
  readonly type: string;
  readonly sets?: number;
  readonly reps?: number;
  readonly minReps?: number;
  readonly maxReps?: number;
  readonly seconds?: number;
}): string {
  if (prescription.type === "sets_reps") {
    return `${prescription.sets} 组 × ${prescription.reps} 次`;
  }
  if (prescription.type === "rep_range") {
    return `${prescription.sets} 组 × ${prescription.minReps}–${prescription.maxReps} 次`;
  }
  if (prescription.type === "total_reps") return `累计 ${prescription.reps} 次`;
  if (prescription.type === "duration") {
    return `${prescription.sets} 组 × ${prescription.seconds} 秒`;
  }
  if (prescription.type === "to_failure") {
    return `${prescription.sets} 组，每组做到力竭`;
  }
  return "按原计划完成";
}

function formatRest(exercise: {
  readonly rest?: "self_selected";
  readonly restSeconds?: readonly number[];
}): string {
  if (exercise.rest === "self_selected") return "时间自行决定";
  if (exercise.restSeconds !== undefined) {
    const [minimum, maximum] = exercise.restSeconds;
    return minimum === maximum ? `${minimum} 秒` : `${minimum}–${maximum} 秒`;
  }
  return "时间原计划未注明";
}

function dayName(day: string): string {
  return DAY_NAMES[day] ?? day;
}

function sessionTypeName(type: string): string {
  return SESSION_TYPE_NAMES[type] ?? type;
}

function exerciseDisplayName(exerciseId: string): string {
  if (INITIAL_12RM_EXERCISES.includes(exerciseId as Initial12RMExerciseId)) {
    return exerciseName(exerciseId as Initial12RMExerciseId);
  }
  return OTHER_EXERCISE_NAMES[exerciseId] ?? exerciseId;
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
    `训练计划已确认，将从 ${state.cycle.startDate}（周一）开始。`,
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
    return result.role === "baseline"
      ? `已记录初始体重：${result.observation.value.amount} ${result.observation.value.unit}。`
      : `已记录阶段体重：${result.observation.value.amount} ${result.observation.value.unit}。`;
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
