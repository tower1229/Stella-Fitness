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

const automaticCandidate = structuredClone(ordinaryCandidate);
automaticCandidate.exercises[0].load = field({
  kind: "kg",
  value: 20,
  unit: "kg",
  raw: "20",
});
automaticCandidate.uncertainFields = [];

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
    api.registerProvider({
      id: "stella-e2e",
      label: "Stella Fitness E2E",
      auth: [],
      catalog: {
        order: "simple",
        async run() {
          return {
            provider: {
              baseUrl: "http://127.0.0.1:9/v1",
              apiKey: "fixture-only",
              api: "openai-completions",
              models: [{ id: "fixture-v1", name: "Fixture v1" }],
            },
          };
        },
      },
    });
    api.registerMemoryEmbeddingProvider({
      id: "stella-e2e",
      defaultModel: "fixture-embedding-v1",
      transport: "local",
      resolveIndexIdentity() {
        return {
          model: "fixture-embedding-v1",
          cacheKeyData: { fixture: "stella-fitness-e2e-v1" },
        };
      },
      async create() {
        return {
          provider: {
            id: "stella-e2e",
            model: "fixture-embedding-v1",
            embedQuery: async (text) => deterministicEmbedding(text),
            embedBatch: async (texts) => texts.map(deterministicEmbedding),
          },
          runtime: {
            id: "stella-e2e",
            cacheKeyData: { fixture: "stella-fitness-e2e-v1" },
          },
        };
      },
    });
    let extractionCount = 0;
    api.registerMediaUnderstandingProvider({
      id: "stella-e2e",
      capabilities: ["image"],
      async extractStructured(request) {
        const targeted = request.instructions?.includes("Target exactly:");
        const candidate = targeted
          ? automaticCandidate
          : extractionCount++ === 0
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

function deterministicEmbedding(input) {
  const text = typeof input === "string"
    ? input
    : [input.text, ...(input.parts ?? []).map((part) =>
      part.type === "text" ? part.text : ""
    )].join(" ");
  const vector = Array.from({ length: 64 }, () => 0);
  for (const character of text.normalize("NFKC").toLowerCase()) {
    const codePoint = character.codePointAt(0) ?? 0;
    vector[codePoint % vector.length] += 1;
  }
  const magnitude = Math.sqrt(
    vector.reduce((sum, value) => sum + value * value, 0),
  ) || 1;
  return vector.map((value) => value / magnitude);
}

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
