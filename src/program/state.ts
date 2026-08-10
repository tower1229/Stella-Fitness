import { createHash, randomUUID } from "node:crypto";
import { link, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { ProgramSpec } from "../domain/program.js";
import { validateProgramSpec } from "./validator.js";

const PROGRAM_DIRECTORY = "program";
const SETUP_FILE = "setup.json";
const STATE_FILE = "state.json";

export type ProgramSetup = {
  readonly schemaVersion: "stella-fitness/program-setup/v0.1";
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
  readonly program: ProgramSetup["program"];
  readonly cycle: { readonly startDate: string };
  readonly symbolicLoadBindings: Readonly<Record<string, unknown>>;
  readonly provenance: {
    readonly kind: "confirmed-program-setup";
    readonly setupId: string;
    readonly selectedAt: string;
    readonly cycleStartConfirmedAt: string;
  };
};

export async function selectProgramForSetup(options: {
  personalDataDirectory: string;
  programSpec: unknown;
}): Promise<ProgramSetup> {
  const program = validateProgramSpec(options.programSpec);
  const setupDirectory = join(options.personalDataDirectory, PROGRAM_DIRECTORY);
  const setupPath = join(setupDirectory, SETUP_FILE);
  const statePath = join(setupDirectory, STATE_FILE);
  const selectedProgram = programIdentity(program);
  const state = await readStateIfPresent(statePath);
  if (state !== undefined) {
    assertSameProgramIdentity(state.program, selectedProgram);
    return {
      schemaVersion: "stella-fitness/program-setup/v0.1",
      id: state.id,
      program: state.program,
      provenance: {
        kind: "program-spec-selection",
        selectedAt: state.provenance.selectedAt,
      },
    };
  }
  const existing = await readSetupIfPresent(setupPath);
  if (existing !== undefined) {
    assertSameProgram(existing, selectedProgram);
    return existing;
  }

  const setup: ProgramSetup = {
    schemaVersion: "stella-fitness/program-setup/v0.1",
    id: randomUUID(),
    program: selectedProgram,
    provenance: {
      kind: "program-spec-selection",
      selectedAt: new Date().toISOString(),
    },
  };
  await mkdir(setupDirectory, { recursive: true, mode: 0o700 });
  return await createSetupFile(setupPath, setup);
}

export async function confirmProgramSetup(options: {
  personalDataDirectory: string;
  cycleStart: string;
}): Promise<ProgramState> {
  assertCycleStart(options.cycleStart);
  const setupDirectory = join(options.personalDataDirectory, PROGRAM_DIRECTORY);
  const setupPath = join(setupDirectory, SETUP_FILE);
  const statePath = join(setupDirectory, STATE_FILE);
  const existingState = await readStateIfPresent(statePath);
  if (existingState !== undefined) {
    assertSameCycleStart(existingState, options.cycleStart);
    await removeIfPresent(setupPath);
    return existingState;
  }

  const setup = await readRequiredSetup(setupPath);
  const state: ProgramState = {
    schemaVersion: "stella-fitness/program-state/v0.1",
    id: setup.id,
    program: setup.program,
    cycle: { startDate: options.cycleStart },
    symbolicLoadBindings: {},
    provenance: {
      kind: "confirmed-program-setup",
      setupId: setup.id,
      selectedAt: setup.provenance.selectedAt,
      cycleStartConfirmedAt: new Date().toISOString(),
    },
  };
  const persisted = await createStateFile(statePath, state);
  await removeIfPresent(setupPath);
  return persisted;
}

function programIdentity(program: ProgramSpec): ProgramSetup["program"] {
  return {
    id: program.id,
    version: program.version,
    schemaVersion: program.schemaVersion,
    specSha256: createHash("sha256")
      .update(JSON.stringify(program))
      .digest("hex"),
  };
}

async function createSetupFile(
  setupPath: string,
  setup: ProgramSetup,
): Promise<ProgramSetup> {
  const temporaryPath = `${setupPath}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(setup, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    try {
      await link(temporaryPath, setupPath);
      return setup;
    } catch (error) {
      if (!isAlreadyExists(error)) {
        throw error;
      }
      const existing = await readRequiredSetup(setupPath);
      assertSameProgram(existing, setup.program);
      return existing;
    }
  } finally {
    await unlink(temporaryPath).catch((error: unknown) => {
      if (!isMissing(error)) {
        throw error;
      }
    });
  }
}

async function createStateFile(
  statePath: string,
  state: ProgramState,
): Promise<ProgramState> {
  const temporaryPath = `${statePath}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    try {
      await link(temporaryPath, statePath);
      return state;
    } catch (error) {
      if (!isAlreadyExists(error)) {
        throw error;
      }
      const existing = await readRequiredState(statePath);
      assertSameCycleStart(existing, state.cycle.startDate);
      return existing;
    }
  } finally {
    await removeIfPresent(temporaryPath);
  }
}

async function readSetupIfPresent(path: string): Promise<ProgramSetup | undefined> {
  try {
    return parseSetup(await readFile(path, "utf8"));
  } catch (error) {
    if (isMissing(error)) {
      return undefined;
    }
    throw error;
  }
}

async function readRequiredSetup(path: string): Promise<ProgramSetup> {
  return parseSetup(await readFile(path, "utf8"));
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

async function readRequiredState(path: string): Promise<ProgramState> {
  return parseState(await readFile(path, "utf8"));
}

function parseSetup(source: string): ProgramSetup {
  const value: unknown = JSON.parse(source);
  if (
    !isRecord(value) ||
    value.schemaVersion !== "stella-fitness/program-setup/v0.1" ||
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
    throw new Error("Program setup is schema-invalid");
  }
  return value as ProgramSetup;
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
    value.provenance.kind !== "confirmed-program-setup" ||
    typeof value.provenance.setupId !== "string" ||
    typeof value.provenance.selectedAt !== "string" ||
    typeof value.provenance.cycleStartConfirmedAt !== "string"
  ) {
    throw new Error("Program State is schema-invalid");
  }
  return value as ProgramState;
}

function isProgramIdentity(value: unknown): value is ProgramSetup["program"] {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.version === "string" &&
    typeof value.schemaVersion === "string" &&
    typeof value.specSha256 === "string"
  );
}

function assertSameProgram(
  setup: ProgramSetup,
  program: ProgramSetup["program"],
): void {
  assertSameProgramIdentity(setup.program, program);
}

function assertSameProgramIdentity(
  existing: ProgramSetup["program"],
  requested: ProgramSetup["program"],
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
