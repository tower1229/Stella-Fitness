import type { WorkoutLogTarget } from "./runtime.js";

const FACT_EXTRACTION_RULES =
  "Classify ordinary pages as zhuoshu-three-stage-workbook and strength-test pages as zhuoshu-strength-test-block. Return only canonical hyphenated session and exercise IDs allowed by the JSON schema; never invent synonyms or underscore IDs. Every uncertainty path must use the exact schema path ending in .value. Use strength_test for Week 4 Friday and end_of_cycle_retest only for the post-cycle 12RM retest. Identify stage, week, weekday, session type, ordinary exercises or strength-test results, load semantics, set-cell values, action quality, notes, field confidence, and uncertainty. Treat intentionally blank actual cells as null. Never copy ProgramSpec targets into blank actual cells. Never treat the pull-up max result as a replacement for programmed total reps. Do not diagnose, advise, or infer health, safety, nutrition, or training quality.";

export const WORKOUT_LOG_EXTRACTION_INSTRUCTIONS =
  `Extract only candidate facts from the fixed Zhuoshu three-stage workout workbook. An ordinary or strength-test candidate must describe exactly one session block. If the image contains more than one visible session block, do not choose or combine them: return layout multi-session-page with reason multiple-session-blocks so the caller can request a crop. ${FACT_EXTRACTION_RULES}`;

export function workoutLogExtractionInstructions(
  target: WorkoutLogTarget | undefined,
): string {
  if (target === undefined) return WORKOUT_LOG_EXTRACTION_INSTRUCTIONS;
  return [
    "First decide whether the image is the fixed Zhuoshu three-stage workout workbook. If it is not, return layout not-workout-log with reason not-fixed-workbook.",
    `Target exactly: stage ${target.stage}, week ${target.week}, ${target.weekday}, ${target.sessionType}, date ${target.date}.`,
    `The target exercise IDs are: ${target.exerciseIds.join(", ")}.`,
    "Find the target header and read only its rows until the next session header. Ignore every other visible session block and never combine their cells.",
    "Return target-not-visible only when the target header and complete exercise-label set cannot be established: the block is missing, entirely blank, globally illegible, or its exercise labels do not match the target.",
    "Once the target header and complete exercise-label set match, never reject the whole block because individual actual cells are crossed out, blank, or unclear. Return a candidate and list only those unclear actual fields in uncertainFields; preserve every clear field.",
    FACT_EXTRACTION_RULES,
  ].join(" ");
}
