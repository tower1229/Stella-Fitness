import { createHash, randomUUID } from "node:crypto";
import { link, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { ProgramSpec } from "../domain/program.js";
import { validateProgramSpec } from "./validator.js";

const PROGRAM_DIRECTORY = "program";
const SELECTION_FILE = "selection.json";
const STATE_FILE = "state.json";

export type PendingProgramSelection = {
  readonly schemaVersion: "stella-fitness/program-selection/v0.1";
  readonly id: string;
  readonly program: {
    readonly id: string;
    readonly version: string;
    readonly schemaVersion: string;
    readonly specSha256: string;
  };
  readonly provenance: {
    readonly kind: "program-spec-selection";
    readonly selectedAt: string;
  };
};

export type ProgramState = {
  readonly schemaVersion: "stella-fitness/program-state/v0.1";
  readonly id: string;
  readonly program: PendingProgramSelection["program"];
  readonly cycle: { readonly startDate: string };
  readonly symbolicLoadBindings: Readonly<Record<string, unknown>>;
  readonly provenance: {
    readonly kind: "program-selection-confirmation";
    readonly selectionId: string;
    readonly selectedAt: string;
    readonly cycleStartConfirmedAt: string;
  };
};

export async function selectProgramForSetup(options: {
  personalDataDirectory: string;
  programSpec: unknown;
}): Promise<PendingProgramSelection> {
  const program = validateProgramSpec(options.programSpec);
  const programDirectory = join(options.personalDataDirectory, PROGRAM_DIRECTORY);
  const selectionPath = join(programDirectory, SELECTION_FILE);
  const statePath = join(programDirectory, STATE_FILE);
  const selectedProgram = programIdentity(program);
  const state = await readStateIfPresent(statePath);
  if (state !== undefined) {
    assertSameProgramIdentity(state.program, selectedProgram);
    return {
      schemaVersion: "stella-fitness/program-selection/v0.1",
      id: state.id,
      program: state.program,
      provenance: {
        kind: "program-spec-selection",
        selectedAt: state.provenance.selectedAt,
      },
    };
  }
  const existing = await readSelectionIfPresent(selectionPath);
  if (existing !== undefined) {
    assertSameProgram(existing, selectedProgram);
    return existing;
  }

  const selection: PendingProgramSelection = {
    schemaVersion: "stella-fitness/program-selection/v0.1",
    id: randomUUID(),
    program: selectedProgram,
    provenance: {
      kind: "program-spec-selection",
      selectedAt: new Date().toISOString(),
    },
  };
  await mkdir(programDirectory, { recursive: true, mode: 0o700 });
  return await createCanonicalFile(selectionPath, selection, {
    parse: parseSelection,
    assertCompatible(existingSelection) {
      assertSameProgram(existingSelection, selection.program);
    },
  });
}

export async function confirmProgramSetup(options: {
  personalDataDirectory: string;
  cycleStart: string;
}): Promise<ProgramState> {
  assertCycleStart(options.cycleStart);
  const programDirectory = join(options.personalDataDirectory, PROGRAM_DIRECTORY);
  const selectionPath = join(programDirectory, SELECTION_FILE);
  const statePath = join(programDirectory, STATE_FILE);
  const existingState = await readStateIfPresent(statePath);
  if (existingState !== undefined) {
    assertSameCycleStart(existingState, options.cycleStart);
    await removeIfPresent(selectionPath);
    return existingState;
  }

  const selection = await readRequiredSelection(selectionPath);
  const state: ProgramState = {
    schemaVersion: "stella-fitness/program-state/v0.1",
    id: selection.id,
    program: selection.program,
    cycle: { startDate: options.cycleStart },
    symbolicLoadBindings: {},
    provenance: {
      kind: "program-selection-confirmation",
      selectionId: selection.id,
      selectedAt: selection.provenance.selectedAt,
      cycleStartConfirmedAt: new Date().toISOString(),
    },
  };
  const persisted = await createCanonicalFile(statePath, state, {
    parse: parseState,
    assertCompatible(existingState) {
      assertSameCycleStart(existingState, state.cycle.startDate);
    },
  });
  await removeIfPresent(selectionPath);
  return persisted;
}

function programIdentity(
  program: ProgramSpec,
): PendingProgramSelection["program"] {
  return {
    id: program.id,
    version: program.version,
    schemaVersion: program.schemaVersion,
    specSha256: createHash("sha256")
      .update(JSON.stringify(program))
      .digest("hex"),
  };
}

async function createCanonicalFile<T>(
  canonicalPath: string,
  value: T,
  policy: {
    readonly parse: (source: string) => T;
    readonly assertCompatible: (existing: T) => void;
  },
): Promise<T> {
  const temporaryPath = `${canonicalPath}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    try {
      await link(temporaryPath, canonicalPath);
      return value;
    } catch (error) {
      if (!isAlreadyExists(error)) {
        throw error;
      }
      const existing = policy.parse(await readFile(canonicalPath, "utf8"));
      policy.assertCompatible(existing);
      return existing;
    }
  } finally {
    await removeIfPresent(temporaryPath);
  }
}

async function readSelectionIfPresent(
  path: string,
): Promise<PendingProgramSelection | undefined> {
  try {
    return parseSelection(await readFile(path, "utf8"));
  } catch (error) {
    if (isMissing(error)) {
      return undefined;
    }
    throw error;
  }
}

async function readRequiredSelection(
  path: string,
): Promise<PendingProgramSelection> {
  return parseSelection(await readFile(path, "utf8"));
}

async function readStateIfPresent(path: string): Promise<ProgramState | undefined> {
  try {
    return parseState(await readFile(path, "utf8"));
  } catch (error) {
    if (isMissing(error)) {
      return undefined;
    }
    throw error;
  }
}

function parseSelection(source: string): PendingProgramSelection {
  const value: unknown = JSON.parse(source);
  if (
    !isRecord(value) ||
    value.schemaVersion !== "stella-fitness/program-selection/v0.1" ||
    typeof value.id !== "string" ||
    !isRecord(value.program) ||
    typeof value.program.id !== "string" ||
    typeof value.program.version !== "string" ||
    typeof value.program.schemaVersion !== "string" ||
    typeof value.program.specSha256 !== "string" ||
    !isRecord(value.provenance) ||
    value.provenance.kind !== "program-spec-selection" ||
    typeof value.provenance.selectedAt !== "string"
  ) {
    throw new Error("Pending Program selection is schema-invalid");
  }
  return value as PendingProgramSelection;
}

function parseState(source: string): ProgramState {
  const value: unknown = JSON.parse(source);
  if (
    !isRecord(value) ||
    value.schemaVersion !== "stella-fitness/program-state/v0.1" ||
    typeof value.id !== "string" ||
    !isProgramIdentity(value.program) ||
    !isRecord(value.cycle) ||
    typeof value.cycle.startDate !== "string" ||
    !isRecord(value.symbolicLoadBindings) ||
    !isRecord(value.provenance) ||
    value.provenance.kind !== "program-selection-confirmation" ||
    typeof value.provenance.selectionId !== "string" ||
    typeof value.provenance.selectedAt !== "string" ||
    typeof value.provenance.cycleStartConfirmedAt !== "string"
  ) {
    throw new Error("Program State is schema-invalid");
  }
  return value as ProgramState;
}

function isProgramIdentity(
  value: unknown,
): value is PendingProgramSelection["program"] {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.version === "string" &&
    typeof value.schemaVersion === "string" &&
    typeof value.specSha256 === "string"
  );
}

function assertSameProgram(
  selection: PendingProgramSelection,
  program: PendingProgramSelection["program"],
): void {
  assertSameProgramIdentity(selection.program, program);
}

function assertSameProgramIdentity(
  existing: PendingProgramSelection["program"],
  requested: PendingProgramSelection["program"],
): void {
  if (JSON.stringify(existing) !== JSON.stringify(requested)) {
    throw new Error("Program setup already selected a different ProgramSpec");
  }
}

function assertSameCycleStart(state: ProgramState, cycleStart: string): void {
  if (state.cycle.startDate !== cycleStart) {
    throw new Error("Program State already has a different cycle start date");
  }
}

function assertCycleStart(value: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("Cycle start must use YYYY-MM-DD");
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error("Cycle start must be a valid date");
  }
  if (date.getUTCDay() !== 1) {
    throw new Error("Cycle start must be a Monday");
  }
}

async function removeIfPresent(path: string): Promise<void> {
  await unlink(path).catch((error: unknown) => {
    if (!isMissing(error)) {
      throw error;
    }
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAlreadyExists(error: unknown): boolean {
  return isNodeError(error) && error.code === "EEXIST";
}

function isMissing(error: unknown): boolean {
  return isNodeError(error) && error.code === "ENOENT";
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
