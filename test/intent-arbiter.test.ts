import { describe, expect, it } from "vitest";
import {
  arbitrateTextInput,
  formatContextualHelp,
  isHelpOrUsageQuery,
  isOutOfScopeProgramQuestion,
  isQuestion,
  normalizeStatusInput,
  STATUS_INPUT,
} from "../src/query/arbiter.js";
import type { ProgramJourneyStatus } from "../src/program/journey.js";

describe("Intent Arbiter", () => {
  const dummyHelpers = {
    isBodyWeightInput: (text: string) => /kg|公斤|体重/i.test(text),
    bodyWeightCorrectionId: (_text: string) => undefined,
  };

  it("arbitrates status command and context resync", async () => {
    expect(normalizeStatusInput("  stella   status  ")).toBe(STATUS_INPUT);

    const statusResult = await arbitrateTextInput({
      text: "stella status",
      receivedAt: "2026-08-31T12:00:00.000Z",
      localDate: "2026-08-31",
      ...dummyHelpers,
    });
    expect(statusResult).toEqual({ kind: "status-command" });

    const resyncResult = await arbitrateTextInput({
      text: "请重新同步Stella Fitness的健身上下文投影",
      receivedAt: "2026-08-31T12:00:00.000Z",
      localDate: "2026-08-31",
      ...dummyHelpers,
    });
    expect(resyncResult).toEqual({ kind: "context-resync" });
  });

  it("arbitrates help, usage and punctuation noise", async () => {
    for (const text of ["? /?", "?", "？", "/?", "...", "!@#$"]) {
      expect(isHelpOrUsageQuery(text)).toBe(true);
      const result = await arbitrateTextInput({
        text,
        receivedAt: "2026-08-31T12:00:00.000Z",
        localDate: "2026-08-31",
        ...dummyHelpers,
      });
      expect(result).toEqual({ kind: "help-or-usage", isPunctuationOnly: true });
    }

    for (const text of ["help", "帮助", "你能做什么", "你是谁？", "怎么用", "stella help"]) {
      expect(isHelpOrUsageQuery(text)).toBe(true);
      const result = await arbitrateTextInput({
        text,
        receivedAt: "2026-08-31T12:00:00.000Z",
        localDate: "2026-08-31",
        ...dummyHelpers,
      });
      expect(result).toEqual({ kind: "help-or-usage", isPunctuationOnly: false });
    }
  });

  it("formats contextual help with next step prompt when not active", () => {
    const mockStatusNotActive: ProgramJourneyStatus = {
      schemaVersion: "stella-fitness/program-journey-status/v0.1",
      state: "BASELINE_WEIGHT_REQUIRED",
      program: { id: "test-program", version: "v1" },
      nextStep: { code: "RECORD_BASELINE_WEIGHT", prompt: "请先记录你的初始体重" },
      missingPrerequisiteIds: [],
      missingInitial12RMExerciseIds: [],
      errors: [],
    };

    const helpWithPrompt = formatContextualHelp(mockStatusNotActive);
    expect(helpWithPrompt).toContain("你可以直接问“今天练什么”");
    expect(helpWithPrompt).toContain("当前进度提示：请先记录你的初始体重");

    const mockStatusActive: ProgramJourneyStatus = {
      schemaVersion: "stella-fitness/program-journey-status/v0.1",
      state: "ACTIVE",
      program: { id: "test-program", version: "v1" },
      nextStep: { code: "ACTIVE", prompt: "计划执行中" },
      missingPrerequisiteIds: [],
      missingInitial12RMExerciseIds: [],
      errors: [],
    };

    const helpActive = formatContextualHelp(mockStatusActive);
    expect(helpActive).toContain("你可以直接问“今天练什么”");
    expect(helpActive).not.toContain("当前进度提示");
  });

  it("arbitrates activation and prerequisite intents", async () => {
    const actResult = await arbitrateTextInput({
      text: "本周开始",
      receivedAt: "2026-08-31T12:00:00.000Z",
      localDate: "2026-08-31",
      ...dummyHelpers,
    });
    expect(actResult.kind).toBe("activation");

    const prereqResult = await arbitrateTextInput({
      text: "我已准备好引体向上杆",
      receivedAt: "2026-08-31T12:00:00.000Z",
      localDate: "2026-08-31",
      ...dummyHelpers,
    });
    expect(prereqResult).toEqual({
      kind: "prerequisite-ack",
      prerequisiteId: "pull-up-bar",
    });
  });

  it("arbitrates out-of-scope advice questions with strict ADR-024 gate", async () => {
    for (const text of [
      "腰疼需要调整吗？",
      "我的表现怎么样？",
      "这个动作会伤腰吗？",
      "我应该怎么调整饮食？",
    ]) {
      expect(isOutOfScopeProgramQuestion(text)).toBe(true);
      const result = await arbitrateTextInput({
        text,
        receivedAt: "2026-08-31T12:00:00.000Z",
        localDate: "2026-08-31",
        ...dummyHelpers,
      });
      expect(result).toEqual({ kind: "out-of-scope-advice", question: text });
    }
  });

  it("arbitrates program facts and weight facts queries", async () => {
    const todayResult = await arbitrateTextInput({
      text: "今天练什么？",
      receivedAt: "2026-08-31T12:00:00.000Z",
      localDate: "2026-08-31",
      ...dummyHelpers,
    });
    expect(todayResult).toEqual({
      kind: "exact-facts-query",
      query: { kind: "today", date: "2026-08-31" },
    });

    const weightResult = await arbitrateTextInput({
      text: "体重事实",
      receivedAt: "2026-08-31T12:00:00.000Z",
      localDate: "2026-08-31",
      ...dummyHelpers,
    });
    expect(weightResult).toEqual({ kind: "weight-facts-query" });
  });

  it("arbitrates 12RM and body-weight candidates", async () => {
    const initial12RMResult = await arbitrateTextInput({
      text: "高脚杯深蹲 12RM 60kg",
      receivedAt: "2026-08-31T12:00:00.000Z",
      localDate: "2026-08-31",
      ...dummyHelpers,
    });
    expect(initial12RMResult).toEqual({
      kind: "initial-12rm",
      text: "高脚杯深蹲 12RM 60kg",
    });

    const weightInputResult = await arbitrateTextInput({
      text: "70.5kg",
      receivedAt: "2026-08-31T12:00:00.000Z",
      localDate: "2026-08-31",
      ...dummyHelpers,
    });
    expect(weightInputResult).toEqual({
      kind: "body-weight-candidate",
      text: "70.5kg",
      correctionId: undefined,
    });
  });

  it("intercepts unsupported questions and releases ordinary conversation", async () => {
    expect(isQuestion("好了吗？")).toBe(true);

    const questionResult = await arbitrateTextInput({
      text: "好了吗？",
      receivedAt: "2026-08-31T12:00:00.000Z",
      localDate: "2026-08-31",
      isBodyWeightInput: () => false,
      bodyWeightCorrectionId: () => undefined,
    });
    expect(questionResult).toEqual({
      kind: "unsupported-question",
      question: "好了吗？",
    });

    const conversationResult = await arbitrateTextInput({
      text: "你好，今天天气不错。",
      receivedAt: "2026-08-31T12:00:00.000Z",
      localDate: "2026-08-31",
      isBodyWeightInput: () => false,
      bodyWeightCorrectionId: () => undefined,
    });
    expect(conversationResult).toEqual({
      kind: "unhandled-natural-text",
    });
  });
});
