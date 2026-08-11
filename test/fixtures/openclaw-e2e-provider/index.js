import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";

const candidate = {
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
  ],
  uncertainFields: [
    {
      path: "exercises[0].load.value",
      kind: "low-confidence",
    },
  ],
};

export default definePluginEntry({
  id: "stella-fitness-e2e-provider",
  name: "Stella Fitness E2E Provider",
  description: "Deterministic local provider for channel E2E verification",
  register(api) {
    api.registerMediaUnderstandingProvider({
      id: "stella-e2e",
      capabilities: ["image"],
      async extractStructured(request) {
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
