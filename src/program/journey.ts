import { randomUUID } from "node:crypto";
import {
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";

import type {
  BodyWeightObservation,
  ObservationSource,
} from "../domain/observation.js";
import type { ConfigurationPreflightResult } from "../preflight.js";
import {
  persistBodyWeightObservation,
  rebuildBodyWeightView,
  resolveBodyWeightReference,
} from "../storage/body-weight.js";
import { parseBodyWeightInput } from "../extraction/body-weight.js";
import { loadBuiltInProgramInput } from "./builtin.js";
import {
  confirmProgramSetup,
  readActiveProgramIfPresent,
  selectProgramForSetup,
  type ProgramState,
  type SymbolicLoadBinding,
} from "./state.js";

const REQUIRED_PREREQUISITES = [
  "adjustable-dumbbells",
  "pull-up-bar",
  "printed-workout-log",
] as const;
const INITIAL_12RM_EXERCISES = [
  "goblet-squat",
  "dumbbell-bench-press",
  "dumbbell-deadlift",
] as const;
const SETUP_FILE = join("program", "setup.json");
const SETUP_LOCK = join("program", "setup.lock");
const INITIAL_12RM_DIRECTORY = join("observations", "special-session");

export type RequiredPrerequisiteId = (typeof REQUIRED_PREREQUISITES)[number];
export type Initial12RMExerciseId = (typeof INITIAL_12RM_EXERCISES)[number];
export type ProgramJourneyState =
  | "PREREQUISITES_REQUIRED"
  | "BASELINE_WEIGHT_REQUIRED"
  | "INITIAL_12RM_REQUIRED"
  | "READY_TO_ACTIVATE"
  | "ACTIVE"
  | "PHASE_CHECKPOINT_REQUIRED";

export type CourseStart12RMObservation = {
  readonly schemaVersion: "stella-fitness/observation/course-start-12rm/v0.1";
  readonly id: string;
  readonly kind: "course-start-12rm";
  readonly exerciseId: Initial12RMExerciseId;
  readonly result: { readonly value: number; readonly unit: "kg"; readonly test: "12RM" };
  readonly occurredAt: string;
  readonly source: ObservationSource;
  readonly provenance: {
    readonly kind: "course-start-12rm-recording";
    readonly confirmationId: string;
    readonly recordedAt: string;
  };
};

type PrerequisiteAcknowledgement = {
  readonly prerequisiteId: RequiredPrerequisiteId;
  readonly acknowledgedAt: string;
  readonly source: ObservationSource;
};

type ProgramSetup = {
  readonly schemaVersion: "stella-fitness/program-setup/v0.1";
  readonly prerequisiteAcknowledgements: Readonly<
    Partial<Record<RequiredPrerequisiteId, PrerequisiteAcknowledgement>>
  >;
  readonly baselineObservationId?: string;
  readonly initial12RMObservationIds: Readonly<
    Partial<Record<Initial12RMExerciseId, string>>
  >;
  readonly checkpointObservationIds: Readonly<Partial<Record<"4" | "8" | "12", string>>>;
};

export type ProgramJourneyStatus = {
  readonly schemaVersion: "stella-fitness/program-journey-status/v0.1";
  readonly state: ProgramJourneyState;
  readonly program: { readonly id: string; readonly version: string };
  readonly nextStep: { readonly code: string; readonly prompt: string };
  readonly missingPrerequisiteIds: readonly RequiredPrerequisiteId[];
  readonly missingInitial12RMExerciseIds: readonly Initial12RMExerciseId[];
  readonly requiredCheckpointWeek?: 4 | 8 | 12;
};

export type WeightGoalDirection =
  | "toward-goal"
  | "away-from-goal"
  | "unchanged"
  | "insufficient-data";

export type WeightFactsView = {
  readonly schemaVersion: "stella-fitness/view/weight-facts/v0.1";
  readonly goal: "gain-weight";
  readonly baseline?: { readonly observationId: string; readonly amountKg: number };
  readonly checkpoints: Readonly<
    Partial<
      Record<
        "4" | "8" | "12",
        {
          readonly observationId: string;
          readonly amountKg: number;
          readonly fromBaseline: WeightChange;
          readonly fromPrevious: WeightChange;
        }
      >
    >
  >;
};

type WeightChange = {
  readonly changeKg?: number;
  readonly changePercent?: number;
  readonly direction: WeightGoalDirection;
};

export function createProgramJourney(options: {
  readonly personalDataDirectory: string;
  readonly preflight: () => ConfigurationPreflightResult;
}) {
  const personalDataDirectory = options.personalDataDirectory;
  return {
    async status(input: { readonly date?: string } = {}): Promise<ProgramJourneyStatus> {
      assertJourneyPreflight(options.preflight());
      const setup = await ensureSetup(personalDataDirectory);
      const active = await readActiveProgramIfPresent({ personalDataDirectory });
      const baseline = setup.baselineObservationId === undefined
        ? undefined
        : await resolveBodyWeightReference(personalDataDirectory, setup.baselineObservationId);
      const initial = await readInitial12RMObservations(personalDataDirectory);
      const activeInitialIds = new Set(initial.map(({ id }) => id));
      const missingPrerequisiteIds = REQUIRED_PREREQUISITES.filter(
        (id) => setup.prerequisiteAcknowledgements[id] === undefined,
      );
      const missingInitial12RMExerciseIds = INITIAL_12RM_EXERCISES.filter((id) => {
        const observationId = setup.initial12RMObservationIds[id];
        return observationId === undefined || !activeInitialIds.has(observationId);
      });
      const common = {
        schemaVersion: "stella-fitness/program-journey-status/v0.1" as const,
        program: { id: "zhuoshu-12-week", version: "0.2.0" },
        missingPrerequisiteIds,
        missingInitial12RMExerciseIds,
      };
      if (missingPrerequisiteIds.length > 0) {
        return {
          ...common,
          state: "PREREQUISITES_REQUIRED",
          nextStep: {
            code: "ACKNOWLEDGE_PREREQUISITE",
            prompt: `Confirm prerequisite: ${missingPrerequisiteIds[0]}`,
          },
        };
      }
      if (
        setup.baselineObservationId === undefined || baseline === undefined
      ) {
        return {
          ...common,
          state: "BASELINE_WEIGHT_REQUIRED",
          nextStep: {
            code: "RECORD_BASELINE_WEIGHT",
            prompt: "Record an unambiguous baseline body weight.",
          },
        };
      }
      if (missingInitial12RMExerciseIds.length > 0) {
        return {
          ...common,
          state: "INITIAL_12RM_REQUIRED",
          nextStep: {
            code: "RECORD_INITIAL_12RM",
            prompt: `Record 12RM for ${missingInitial12RMExerciseIds[0]}`,
          },
        };
      }
      if (active === undefined) {
        return {
          ...common,
          state: "READY_TO_ACTIVATE",
          nextStep: {
            code: "CONFIRM_CYCLE_START",
            prompt: "Confirm a Monday cycle start date.",
          },
        };
      }
      const dueCheckpointWeeks = dueCheckpoints(
        active.state.cycle.startDate,
        input.date,
      );
      for (const requiredCheckpointWeek of dueCheckpointWeeks) {
        const checkpointId = setup.checkpointObservationIds[String(requiredCheckpointWeek) as "4" | "8" | "12"];
        const checkpoint = checkpointId === undefined
          ? undefined
          : await resolveBodyWeightReference(personalDataDirectory, checkpointId);
        if (checkpointId === undefined || checkpoint === undefined) {
          return {
            ...common,
            state: "PHASE_CHECKPOINT_REQUIRED",
            requiredCheckpointWeek,
            nextStep: {
              code: "RECORD_PHASE_CHECKPOINT",
              prompt: `Record the Week ${requiredCheckpointWeek} body-weight checkpoint.`,
            },
          };
        }
      }
      return {
        ...common,
        state: "ACTIVE",
        nextStep: { code: "VIEW_TODAY", prompt: "View today's planned session." },
      };
    },

    async acknowledgePrerequisite(input: {
      readonly prerequisiteId: string;
      readonly acknowledgedAt: string;
      readonly source: ObservationSource;
    }): Promise<ProgramJourneyStatus> {
      const prerequisiteId = requiredPrerequisiteId(input.prerequisiteId);
      assertTimestamp(input.acknowledgedAt, "acknowledgedAt");
      await ensureSetup(personalDataDirectory);
      await updateSetup(personalDataDirectory, (setup) => {
        const existing = setup.prerequisiteAcknowledgements[prerequisiteId];
        const acknowledgement: PrerequisiteAcknowledgement = {
          prerequisiteId,
          acknowledgedAt: input.acknowledgedAt,
          source: input.source,
        };
        if (existing !== undefined && JSON.stringify(existing) !== JSON.stringify(acknowledgement)) {
          throw new Error(`Prerequisite ${prerequisiteId} was already acknowledged with different provenance`);
        }
        return {
          ...setup,
          prerequisiteAcknowledgements: {
            ...setup.prerequisiteAcknowledgements,
            [prerequisiteId]: acknowledgement,
          },
        };
      });
      return await this.status();
    },

    async recordBodyWeight(input: {
      readonly role: "baseline" | "checkpoint";
      readonly checkpointWeek?: 4 | 8 | 12;
      readonly text: string;
      readonly receivedAt: string;
      readonly source?: Omit<ObservationSource, "kind" | "text">;
    }): Promise<
      | { readonly status: "clarification"; readonly question: string }
      | { readonly status: "recorded"; readonly role: "baseline" | "checkpoint"; readonly observation: BodyWeightObservation }
    > {
      await ensureSetup(personalDataDirectory);
      if (
        input.role === "baseline" &&
        (await readActiveProgramIfPresent({ personalDataDirectory })) !== undefined
      ) {
        throw new Error("Baseline body weight cannot change after activation; record a correction or checkpoint");
      }
      const candidate = parseBodyWeightInput(input);
      if ("status" in candidate) {
        return candidate;
      }
      if (input.role === "checkpoint" && ![4, 8, 12].includes(input.checkpointWeek ?? 0)) {
        throw new Error("Checkpoint week must be 4, 8 or 12");
      }
      const observation = await persistBodyWeightObservation({
        personalDataDirectory,
        amount: candidate.amount,
        unit: candidate.unit,
        occurredAt: candidate.occurredAt,
        source: { kind: "user-text", text: input.text, ...input.source },
        recordedAt: new Date(input.receivedAt).toISOString(),
      });
      await updateSetup(personalDataDirectory, (setup) =>
        input.role === "baseline"
          ? { ...setup, baselineObservationId: observation.id }
          : {
              ...setup,
              checkpointObservationIds: {
                ...setup.checkpointObservationIds,
                [String(input.checkpointWeek)]: observation.id,
              },
            },
      );
      return { status: "recorded", role: input.role, observation };
    },

    async recordInitial12RM(input: {
      readonly exerciseId: Initial12RMExerciseId;
      readonly valueKg: number;
      readonly confirmationId: string;
      readonly occurredAt: string;
      readonly recordedAt: string;
      readonly source: ObservationSource;
    }): Promise<CourseStart12RMObservation> {
      await ensureSetup(personalDataDirectory);
      if ((await readActiveProgramIfPresent({ personalDataDirectory })) !== undefined) {
        throw new Error("Course-start 12RM cannot change after activation");
      }
      const observation = await persistInitial12RM(personalDataDirectory, input);
      await updateSetup(personalDataDirectory, (setup) => ({
        ...setup,
        initial12RMObservationIds: {
          ...setup.initial12RMObservationIds,
          [input.exerciseId]: observation.id,
        },
      }));
      return observation;
    },

    async activate(cycleStart: string): Promise<ProgramState> {
      const active = await readActiveProgramIfPresent({ personalDataDirectory });
      if (active !== undefined) {
        if (active.state.cycle.startDate !== cycleStart) {
          throw new Error("Program State already has a different cycle start date");
        }
        return active.state;
      }
      const status = await this.status();
      if (status.state !== "READY_TO_ACTIVATE") {
        throw new Error(`Program Journey cannot activate in ${status.state}`);
      }
      const setup = await readSetup(personalDataDirectory);
      const observations = await readInitial12RMObservations(personalDataDirectory);
      const byId = new Map(observations.map((observation) => [observation.id, observation]));
      const bindings: Record<string, Readonly<Record<"A", SymbolicLoadBinding>>> = {};
      for (const exerciseId of INITIAL_12RM_EXERCISES) {
        const observationId = setup.initial12RMObservationIds[exerciseId]!;
        const observation = byId.get(observationId);
        if (observation === undefined) {
          throw new Error(`Initial 12RM Observation is missing for ${exerciseId}`);
        }
        bindings[exerciseId] = {
          A: {
            value: observation.result.value,
            unit: "kg",
            test: "12RM",
            observationId: observation.id,
            recordedAt: observation.provenance.recordedAt,
          },
        };
      }
      return await confirmProgramSetup({
        personalDataDirectory,
        cycleStart,
        symbolicLoadBindings: bindings,
        baselineObservationId: setup.baselineObservationId!,
      });
    },

    async weightFacts(): Promise<WeightFactsView> {
      const setup = await ensureSetup(personalDataDirectory);
      const baseline = setup.baselineObservationId === undefined
        ? undefined
        : await resolveBodyWeightReference(personalDataDirectory, setup.baselineObservationId);
      const checkpoints: Partial<Record<
        "4" | "8" | "12",
        {
          readonly observationId: string;
          readonly amountKg: number;
          readonly fromBaseline: WeightChange;
          readonly fromPrevious: WeightChange;
        }
      >> = {};
      let previous = baseline;
      for (const week of ["4", "8", "12"] as const) {
        const referenceId = setup.checkpointObservationIds[week];
        const checkpoint = referenceId === undefined
          ? undefined
          : await resolveBodyWeightReference(personalDataDirectory, referenceId);
        if (checkpoint === undefined) continue;
        const amountKg = toKg(checkpoint);
        checkpoints[week] = {
          observationId: checkpoint.id,
          amountKg,
          fromBaseline: weightChange(
            baseline === undefined ? undefined : toKg(baseline),
            amountKg,
          ),
          fromPrevious: weightChange(
            previous === undefined ? undefined : toKg(previous),
            amountKg,
          ),
        };
        previous = checkpoint;
      }
      return {
        schemaVersion: "stella-fitness/view/weight-facts/v0.1",
        goal: "gain-weight",
        ...(baseline === undefined
          ? {}
          : {
              baseline: {
                observationId: baseline.id,
                amountKg: toKg(baseline),
              },
            }),
        checkpoints,
      };
    },
  };
}

async function ensureSetup(personalDataDirectory: string): Promise<ProgramSetup> {
  await selectProgramForSetup({
    personalDataDirectory,
    programSpec: await loadBuiltInProgramInput(),
  });
  const path = join(personalDataDirectory, SETUP_FILE);
  const existing = await readFile(path, "utf8").catch((error: unknown) => {
    if (isMissing(error)) return undefined;
    throw error;
  });
  if (existing !== undefined) return parseSetup(existing);
  const setup: ProgramSetup = {
    schemaVersion: "stella-fitness/program-setup/v0.1",
    prerequisiteAcknowledgements: {},
    initial12RMObservationIds: {},
    checkpointObservationIds: {},
  };
  await writeFile(path, `${JSON.stringify(setup, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  }).catch((error: unknown) => {
    if (!isAlreadyExists(error)) throw error;
  });
  return await readSetup(personalDataDirectory);
}

async function updateSetup(
  personalDataDirectory: string,
  update: (setup: ProgramSetup) => ProgramSetup,
): Promise<ProgramSetup> {
  return await withSetupLock(personalDataDirectory, async () => {
    const current = await readSetup(personalDataDirectory);
    const next = update(current);
    const path = join(personalDataDirectory, SETUP_FILE);
    const temporaryPath = `${path}.${randomUUID()}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(next, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    await rename(temporaryPath, path);
    return next;
  });
}

async function withSetupLock<T>(personalDataDirectory: string, run: () => Promise<T>): Promise<T> {
  const lockPath = join(personalDataDirectory, SETUP_LOCK);
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const handle = await open(lockPath, "wx", 0o600);
      try {
        return await run();
      } finally {
        await handle.close();
        await unlink(lockPath).catch(() => undefined);
      }
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
    }
  }
  throw new Error("Program Setup is busy");
}

async function persistInitial12RM(
  personalDataDirectory: string,
  input: {
    readonly exerciseId: Initial12RMExerciseId;
    readonly valueKg: number;
    readonly confirmationId: string;
    readonly occurredAt: string;
    readonly recordedAt: string;
    readonly source: ObservationSource;
  },
): Promise<CourseStart12RMObservation> {
  if (!INITIAL_12RM_EXERCISES.includes(input.exerciseId)) {
    throw new Error(`Unsupported course-start 12RM exercise: ${input.exerciseId}`);
  }
  if (!Number.isFinite(input.valueKg) || input.valueKg <= 0) {
    throw new Error("Initial 12RM value must be a positive kg value");
  }
  if (!isUuid(input.confirmationId)) {
    throw new Error("Initial 12RM confirmation ID must be a UUID");
  }
  assertTimestamp(input.occurredAt, "occurredAt");
  assertTimestamp(input.recordedAt, "recordedAt");
  const directory = join(personalDataDirectory, INITIAL_12RM_DIRECTORY);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const existing = (await readInitial12RMObservations(personalDataDirectory)).find(
    ({ provenance }) => provenance.confirmationId === input.confirmationId,
  );
  if (existing !== undefined) {
    if (
      existing.exerciseId !== input.exerciseId ||
      existing.result.value !== input.valueKg ||
      existing.source.text !== input.source.text
    ) {
      throw new Error("Initial 12RM confirmation ID was reused for different facts");
    }
    return existing;
  }
  const observation: CourseStart12RMObservation = {
    schemaVersion: "stella-fitness/observation/course-start-12rm/v0.1",
    id: randomUUID(),
    kind: "course-start-12rm",
    exerciseId: input.exerciseId,
    result: { value: input.valueKg, unit: "kg", test: "12RM" },
    occurredAt: input.occurredAt,
    source: input.source,
    provenance: {
      kind: "course-start-12rm-recording",
      confirmationId: input.confirmationId,
      recordedAt: input.recordedAt,
    },
  };
  await writeFile(join(directory, `${observation.id}.json`), `${JSON.stringify(observation, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  return observation;
}

async function readInitial12RMObservations(personalDataDirectory: string): Promise<readonly CourseStart12RMObservation[]> {
  const directory = join(personalDataDirectory, INITIAL_12RM_DIRECTORY);
  const files = await readdir(directory).catch((error: unknown) => {
    if (isMissing(error)) return [];
    throw error;
  });
  const observations: CourseStart12RMObservation[] = [];
  for (const file of files.filter((name) => name.endsWith(".json")).sort()) {
    try {
      const observation = parseInitial12RM(await readFile(join(directory, file), "utf8"));
      if (file === `${observation.id}.json`) observations.push(observation);
    } catch {
      continue;
    }
  }
  return observations;
}

function parseInitial12RM(source: string): CourseStart12RMObservation {
  const value: unknown = JSON.parse(source);
  if (
    !isRecord(value) ||
    value.schemaVersion !== "stella-fitness/observation/course-start-12rm/v0.1" ||
    !isUuid(value.id) ||
    value.kind !== "course-start-12rm" ||
    !isInitial12RMExerciseId(value.exerciseId) ||
    !isRecord(value.result) ||
    typeof value.result.value !== "number" ||
    !Number.isFinite(value.result.value) ||
    value.result.value <= 0 ||
    value.result.unit !== "kg" ||
    value.result.test !== "12RM" ||
    typeof value.occurredAt !== "string" ||
    !isRecord(value.source) ||
    value.source.kind !== "user-text" ||
    typeof value.source.text !== "string" ||
    !isRecord(value.provenance) ||
    value.provenance.kind !== "course-start-12rm-recording" ||
    typeof value.provenance.confirmationId !== "string" ||
    typeof value.provenance.recordedAt !== "string"
  ) {
    throw new Error("Course-start 12RM Observation is schema-invalid");
  }
  return value as CourseStart12RMObservation;
}

async function readSetup(personalDataDirectory: string): Promise<ProgramSetup> {
  return parseSetup(await readFile(join(personalDataDirectory, SETUP_FILE), "utf8"));
}

function parseSetup(source: string): ProgramSetup {
  const value: unknown = JSON.parse(source);
  if (
    !isRecord(value) ||
    value.schemaVersion !== "stella-fitness/program-setup/v0.1" ||
    !isRecord(value.prerequisiteAcknowledgements) ||
    !isRecord(value.initial12RMObservationIds) ||
    !isRecord(value.checkpointObservationIds)
  ) {
    throw new Error("Program Setup is schema-invalid");
  }
  return value as ProgramSetup;
}

function dueCheckpoints(
  cycleStart: string,
  date: string | undefined,
): readonly (4 | 8 | 12)[] {
  if (date === undefined) return [];
  const start = new Date(`${cycleStart}T00:00:00.000Z`);
  const current = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(current.getTime()) || current.toISOString().slice(0, 10) !== date) {
    throw new Error("Program Journey date must use a valid YYYY-MM-DD date");
  }
  const completedWeeks = Math.floor((current.getTime() - start.getTime()) / 604_800_000);
  return [4, 8, 12].filter((week): week is 4 | 8 | 12 => completedWeeks >= week);
}

function requiredPrerequisiteId(value: string): RequiredPrerequisiteId {
  if (!REQUIRED_PREREQUISITES.includes(value as RequiredPrerequisiteId)) {
    throw new Error(`Unknown Program prerequisite: ${value}`);
  }
  return value as RequiredPrerequisiteId;
}

function isInitial12RMExerciseId(value: unknown): value is Initial12RMExerciseId {
  return typeof value === "string" && INITIAL_12RM_EXERCISES.includes(value as Initial12RMExerciseId);
}

function assertTimestamp(value: string, label: string): void {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new Error(`${label} must be a canonical timestamp`);
  }
}

function assertJourneyPreflight(result: ConfigurationPreflightResult): void {
  if (result.readiness !== "READY" && result.readiness !== "READY_FOR_SETUP") {
    throw new Error(`Program Journey is blocked by ${result.readiness}`);
  }
}

function toKg(observation: BodyWeightObservation): number {
  return round(
    observation.value.unit === "kg"
      ? observation.value.amount
      : observation.value.amount * 0.45359237,
  );
}

function weightChange(from: number | undefined, to: number): WeightChange {
  if (from === undefined || from <= 0) {
    return { direction: "insufficient-data" };
  }
  const changeKg = round(to - from);
  return {
    changeKg,
    changePercent: round((changeKg / from) * 100),
    direction:
      changeKg > 0
        ? "toward-goal"
        : changeKg < 0
          ? "away-from-goal"
          : "unchanged",
  };
}

function round(value: number): number {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
}

function isAlreadyExists(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "EEXIST";
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
