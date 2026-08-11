import { readFile } from "node:fs/promises";

import { parse } from "yaml";

import type { ProgramSpec } from "../domain/program.js";
import { validateProgramSpec } from "./validator.js";

const PACKAGED_PROGRAM = new URL(
  "./fidelity/zhuoshu-v0.2.yaml",
  import.meta.url,
);
const SOURCE_PROGRAM = new URL(
  "../../knowledge/programs/zhuoshu-12-week/program-spec.v0.2.yaml",
  import.meta.url,
);

export async function loadBuiltInProgramInput(): Promise<unknown> {
  const source = await readFile(PACKAGED_PROGRAM, "utf8").catch(
    async (error: unknown) => {
      if (!isMissing(error)) {
        throw error;
      }
      return await readFile(SOURCE_PROGRAM, "utf8");
    },
  );
  return parse(source) as unknown;
}

export async function loadBuiltInProgram(): Promise<ProgramSpec> {
  return validateProgramSpec(await loadBuiltInProgramInput());
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
