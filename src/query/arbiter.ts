import type { ProgramFactsQuery } from "../program/facts.js";
import type {
  Initial12RMExerciseId,
  ProgramJourneyStatus,
  RequiredPrerequisiteId,
} from "../program/journey.js";
import { INITIAL_12RM_EXERCISES } from "../program/journey.js";
import type { FitnessQueryClassifier, FitnessQueryIntent } from "./intent.js";
import { parseDeterministicFitnessQuery } from "./intent.js";

export const STATUS_INPUT = "stella status";

export type AvailableProgramFactsQuery = Exclude<
  ProgramFactsQuery,
  { readonly kind: "unsupported" }
>;

export const INITIAL_12RM_ALIASES = {
  "goblet-squat": /(?:高脚杯深蹲|goblet[\s-]*squat)/iu,
  "dumbbell-bench-press": /(?:哑铃卧推|dumbbell[\s-]*bench[\s-]*press)/iu,
  "dumbbell-deadlift": /(?:哑铃硬拉|dumbbell[\s-]*deadlift)/iu,
} satisfies Record<Initial12RMExerciseId, RegExp>;

export function normalizeStatusInput(input: string): string {
  return input.trim().toLowerCase().replaceAll(/\s+/g, " ");
}

export function isNaturalContextResync(input: string): boolean {
  return /^\s*(?:请)?(?:重新|再)?(?:同步|刷新)(?:一下)?(?:\s*Stella\s*Fitness)?(?:的)?(?:健身)?(?:上下文|context)(?:投影)?[。.!]?\s*$/iu.test(
    input,
  ) || /^\s*(?:resync|refresh|sync)\s+(?:the\s+)?(?:fitness\s+)?context[.!]?\s*$/iu.test(
    input,
  );
}

export function isOutOfScopeProgramQuestion(text: string): boolean {
  return /(?:诊断|饮食|营养|健康|风险|受伤|伤(?:腰|膝|肩|背)|疼痛|建议|调整|评价|表现(?:怎么样|如何|好不好)|练得怎么样|好不好|是否有效|疲劳|diagnos|nutrition|health|risk|injur|pain|recommend|advise|adjust|evaluat|performance)/iu.test(
    text,
  );
}

export function isWeightFactsQuery(text: string): boolean {
  return /(?:体重(?:事实|变化|checkpoint|检查点)|weight\s+(?:facts|change|checkpoint))/iu.test(text);
}

export function isQuestion(text: string): boolean {
  return /(?:[?？]|吗(?:[。.!！]?\s*)$|呢(?:[。.!！]?\s*)$|多少|怎么|如何|能不能|可不可以|是否|会不会|是不是|what|when|where|which|who|why|how|can\s+i|should\s+i)/iu.test(
    text,
  );
}

export function isUnambiguousWeeklyTrainingQuery(text: string): boolean {
  return /^(?:我)?(?:本周|这周)(?:应该|该|要|需要|可以)?(?:练|训练)(?:什么|哪些|啥)(?:内容|项目|动作)?[呢啊吗。.!！?？]*$/u.test(
    text.trim(),
  );
}

export function isHelpOrUsageQuery(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0) return false;
  const stripped = trimmed.replace(/[\p{P}\p{S}\s]/gu, "");
  if (stripped.length === 0) {
    return true;
  }
  return /^(?:stella|(?:stella\s+)?(?:help|帮助|使用说明|使用指南|功能|介绍)|(?:你是谁|你能做(?:什么|啥)|你会做(?:什么|啥)|怎么用|如何使用|有什么功能))[。.!！?？]*$/iu.test(
    trimmed,
  );
}

export function isInitial12RMText(input: string): boolean {
  return /12\s*RM/iu.test(input) &&
    /高脚杯深蹲|goblet[ -]squat|哑铃卧推|dumbbell[ -]bench[ -]press|哑铃硬拉|dumbbell[ -]deadlift/iu.test(input);
}

export function formatContextualHelp(status?: ProgramJourneyStatus): string {
  const base =
    "你可以直接问“今天练什么”“下次练什么”“本周训练计划”或“体重变化”，也可以直接发送训练打卡记录或体重。我只能记录训练事实并按原计划查询安排，不能评价表现、诊断问题或调整训练和饮食。";

  if (status !== undefined && status.state !== "ACTIVE" && status.nextStep?.prompt) {
    return `${base}\n\n当前进度提示：${status.nextStep.prompt}`;
  }
  return base;
}

export function factsUsage(): string {
  return "你可以直接问“今天练什么”“下次练什么”“本周训练计划”或“体重变化”。";
}

export function parseNaturalProgramFactsQuery(
  text: string,
  date: string | undefined,
): AvailableProgramFactsQuery | { readonly kind: "timezone-required" } | undefined {
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
    return date === undefined
      ? { kind: "timezone-required" }
      : { kind: "week", date };
  }
  if (/(?:下次(?:应该)?练什么|下次(?:训练|课程|计划)|next\s+(?:workout|session))/iu.test(text)) {
    return date === undefined
      ? { kind: "timezone-required" }
      : { kind: "next", date };
  }
  if (
    /(?:今天(?:应该)?练什么|today(?:'s)?\s+(?:workout|session)|当前(?:阶段|第几周|周次|训练日|动作|组次|次数|持续时间|休息|处方)|训练日(?:是什么|是哪天|安排|\?|？)|(?:动作|组次|次数|持续时间|休息|处方)(?:是什么|有哪些|分别是什么|\?|？)|prescription|rest)/iu.test(text)
  ) {
    return date === undefined
      ? { kind: "timezone-required" }
      : { kind: "today", date };
  }
  return undefined;
}

export type NaturalActivationIntent =
  | { readonly kind: "activate"; readonly cycleStart: string }
  | { readonly kind: "clarification"; readonly message: string }
  | { readonly kind: "defer" };

export function parseNaturalActivationIntent(
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

export function mondayFor(referenceDate: string, offsetDays: 0 | 7): string {
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

export function parseNaturalPrerequisiteAcknowledgement(
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

export type ArbitratedIntent =
  | { readonly kind: "status-command" }
  | { readonly kind: "context-resync" }
  | { readonly kind: "help-or-usage"; readonly isPunctuationOnly: boolean }
  | { readonly kind: "activation"; readonly intent: NaturalActivationIntent }
  | { readonly kind: "prerequisite-ack"; readonly prerequisiteId: RequiredPrerequisiteId }
  | { readonly kind: "deterministic-fitness-query"; readonly intent: FitnessQueryIntent }
  | { readonly kind: "timezone-required" }
  | { readonly kind: "exact-facts-query"; readonly query: AvailableProgramFactsQuery }
  | { readonly kind: "out-of-scope-advice"; readonly question: string }
  | { readonly kind: "weight-facts-query" }
  | { readonly kind: "initial-12rm"; readonly text: string }
  | { readonly kind: "semantic-week-query"; readonly date: string }
  | {
      readonly kind: "body-weight-candidate";
      readonly text: string;
      readonly correctionId?: string;
    }
  | { readonly kind: "unsupported-question"; readonly question: string }
  | { readonly kind: "unhandled-natural-text" };

export async function arbitrateTextInput(options: {
  readonly text: string;
  readonly receivedAt: string;
  readonly localDate: string | undefined;
  readonly isInitial12RMText?: (text: string) => boolean;
  readonly isBodyWeightInput: (text: string) => boolean;
  readonly bodyWeightCorrectionId: (text: string) => string | undefined;
  readonly classifier?: FitnessQueryClassifier;
}): Promise<ArbitratedIntent> {
  const {
    text,
    receivedAt,
    localDate,
    isInitial12RMText: checkInitial12RM = isInitial12RMText,
    isBodyWeightInput,
    bodyWeightCorrectionId,
    classifier,
  } = options;

  // Tier 0: 控制指令、帮助与纯标点符号
  if (normalizeStatusInput(text) === STATUS_INPUT) {
    return { kind: "status-command" };
  }
  if (isNaturalContextResync(text)) {
    return { kind: "context-resync" };
  }
  if (isHelpOrUsageQuery(text)) {
    return {
      kind: "help-or-usage",
      isPunctuationOnly: text.replace(/[\p{P}\p{S}\s]/gu, "").length === 0,
    };
  }

  // Tier 1: 计划激活与前置条件确认
  const activationIntent = parseNaturalActivationIntent(text, receivedAt.slice(0, 10));
  if (activationIntent !== undefined) {
    return { kind: "activation", intent: activationIntent };
  }

  const prerequisiteId = parseNaturalPrerequisiteAcknowledgement(text);
  if (prerequisiteId !== undefined) {
    return { kind: "prerequisite-ack", prerequisiteId };
  }

  // Tier 2: 确定性事实查询与越界拦截
  const deterministicQuery = parseDeterministicFitnessQuery(text);
  if (deterministicQuery !== undefined) {
    return { kind: "deterministic-fitness-query", intent: deterministicQuery };
  }

  const factQuery = parseNaturalProgramFactsQuery(text, localDate);
  if (isOutOfScopeProgramQuestion(text)) {
    return { kind: "out-of-scope-advice", question: text };
  }
  if (isWeightFactsQuery(text)) {
    return { kind: "weight-facts-query" };
  }
  if (factQuery !== undefined) {
    if (factQuery.kind === "timezone-required") {
      return { kind: "timezone-required" };
    }
    return { kind: "exact-facts-query", query: factQuery };
  }

  // Tier 3: 初始 12RM 录入
  if (checkInitial12RM(text)) {
    return { kind: "initial-12rm", text };
  }

  // Tier 4: 体重录入 / 语义周查询 / 兜底问句拦截
  if (!isBodyWeightInput(text)) {
    const semanticQuery = await classifier?.classify({ text });
    if (
      (
        semanticQuery?.status === "classified"
          ? semanticQuery.intent.kind === "week"
          : isUnambiguousWeeklyTrainingQuery(text)
      ) &&
      parseDeterministicFitnessQuery(text) === undefined
    ) {
      if (localDate === undefined) {
        return { kind: "timezone-required" };
      }
      return { kind: "semantic-week-query", date: localDate };
    }
    if (isQuestion(text)) {
      return { kind: "unsupported-question", question: text };
    }
    return { kind: "unhandled-natural-text" };
  }

  const correctionId = bodyWeightCorrectionId(text);
  return {
    kind: "body-weight-candidate",
    text,
    ...(correctionId === undefined ? {} : { correctionId }),
  };
}
