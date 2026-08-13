import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";

const ordinaryCandidate = {
  layout: field("zhuoshu-three-stage-workbook"),
  stage: field(1),
  week: field(1),
  weekday: field("monday"),
  sessionType: field("full-body"),
  exercises: [
    {
      rawLabel: field("高脚杯深蹲"),
      exerciseId: field("goblet-squat"),
      load: field(null, "low"),
      sets: [field(10), field(null)],
      actionQuality: field("高"),
      problemNote: field(null),
    },
    ordinaryExercise("哑铃卧推", "dumbbell-bench-press"),
    ordinaryExercise("哑铃硬拉", "dumbbell-deadlift"),
    {
      ...ordinaryExercise("平板支撑", "plank"),
      load: field({ kind: "none", raw: "-" }),
    },
  ],
  uncertainFields: [
    {
      path: "exercises[0].load.value",
      kind: "low-confidence",
    },
  ],
};

const strengthCandidate = {
  layout: field("zhuoshu-strength-test-block"),
  stage: field(1),
  week: field(4),
  weekday: field("friday"),
  sessionType: field("strength_test"),
  testResults: [
    strengthResult("goblet-squat", "12RM", { kind: "kg", value: 34, unit: "kg", raw: "34" }),
    strengthResult("dumbbell-bench-press", "12RM", { kind: "kg", value: 26, unit: "kg", raw: "26" }),
    strengthResult("dumbbell-deadlift", "12RM", { kind: "kg", value: 42, unit: "kg", raw: "42" }),
    strengthResult("pull-up", "max_reps_first_set", { kind: "repetitions", value: 9, raw: "9" }),
  ],
  uncertainFields: [],
};

export default definePluginEntry({
  id: "stella-fitness-e2e-provider",
  name: "Stella Fitness E2E Provider",
  description: "Deterministic local provider for channel E2E verification",
  register(api) {
    let extractionCount = 0;
    api.registerMediaUnderstandingProvider({
      id: "stella-e2e",
      capabilities: ["image"],
      async extractStructured(request) {
        const candidate = extractionCount++ === 0
          ? strengthCandidate
          : ordinaryCandidate;
        return {
          parsed: structuredClone(candidate),
          text: JSON.stringify(candidate),
          provider: "stella-e2e",
          model: request.model,
          contentType: "json",
        };
      },
    });
  },
});

function field(value, confidence = "high") {
  return { value, confidence };
}

function strengthResult(exerciseId, test, result) {
  return { exerciseId: field(exerciseId), test, result: field(result) };
}

function ordinaryExercise(rawLabel, exerciseId) {
  return {
    rawLabel: field(rawLabel),
    exerciseId: field(exerciseId),
    load: field({ kind: "kg", value: 20, unit: "kg", raw: "20" }),
    sets: [field(10), field(null)],
    actionQuality: field("高"),
    problemNote: field(null),
  };
}
