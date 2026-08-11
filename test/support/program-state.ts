import {
  confirmProgramSetup,
  selectProgramForSetup,
  type ProgramState,
} from "../../src/program/state.js";

export async function activateProgramFixture(options: {
  readonly personalDataDirectory: string;
  readonly programSpec: unknown;
  readonly cycleStart?: string;
}): Promise<ProgramState> {
  await selectProgramForSetup(options);
  return await confirmProgramSetup({
    personalDataDirectory: options.personalDataDirectory,
    cycleStart: options.cycleStart ?? "2026-08-10",
  });
}
