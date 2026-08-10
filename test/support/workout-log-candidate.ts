export function workoutLogCandidate() {
  return {
    layout: field("zhuoshu-three-stage-workbook"),
    stage: field(1),
    week: field(1),
    weekday: field("monday"),
    sessionType: field("full-body"),
    exercises: [
      {
        rawLabel: field("高脚杯深蹲"),
        exerciseId: field("goblet-squat"),
        load: field(
          { kind: "kg", value: 20, unit: "kg", raw: "20" },
        ),
        sets: [field(10), field(null)],
        actionQuality: field("高"),
        problemNote: field(null),
      },
    ],
    uncertainFields: [] as Array<{
      path: string;
      kind: "unknown" | "low-confidence" | "conflict";
      candidates?: string[];
    }>,
  };
}

function field<T>(value: T, confidence: "high" | "low" = "high") {
  return { value, confidence };
}
