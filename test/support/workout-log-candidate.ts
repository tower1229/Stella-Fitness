export function workoutLogCandidate() {
  return {
    layout: field("zhuoshu-three-stage-workbook", 0.99),
    stage: field(1, 0.99),
    week: field(1, 0.99),
    weekday: field("monday", 0.99),
    sessionType: field("full-body", 0.99),
    exercises: [
      {
        rawLabel: field("高脚杯深蹲", 0.99),
        exerciseId: field("goblet-squat", 0.99),
        load: field(
          { kind: "kg", value: 20, unit: "kg", raw: "20" },
          0.99,
        ),
        sets: [field(10, 0.99), field(null, 0.99)],
        actionQuality: field("高", 0.99),
        problemNote: field(null, 0.99),
      },
    ],
    uncertainFields: [] as Array<{
      path: string;
      kind: "unknown" | "low-confidence" | "conflict";
      candidates?: string[];
    }>,
  };
}

function field<T>(value: T, confidence: number) {
  return { value, confidence };
}
