import { createHash, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";

import type {
  BodyWeightObservation,
  BodyWeightUnit,
  ObservationSource,
} from "../domain/observation.js";
import type { ConfigurationPreflightResult } from "../preflight.js";
import {
  persistBodyWeightCorrection,
  persistBodyWeightDeletion,
  persistBodyWeightObservation,
  readBodyWeightObservation,
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
  "recording-protocol",
] as const;
const INITIAL_12RM_EXERCISES = [
  "goblet-squat",
  "dumbbell-bench-press",
  "dumbbell-deadlift",
] as const;
const SETUP_FILE = join("program", "setup.json");
const INITIAL_12RM_DIRECTORY = join("observations", "special-session");
const JOURNEY_CONFIRMATION_DIRECTORY = join("program", "pending-confirmations");
const RUNTIME_LOCK_DATABASE = "program-setup-lock.sqlite";

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
  readonly provenance:
    | {
        readonly kind: "course-start-12rm-recording";
        readonly confirmationId: string;
        readonly recordedAt: string;
      }
    | {
        readonly kind: "course-start-12rm-correction";
        readonly confirmationId: string;
        readonly recordedAt: string;
        readonly replacesObservationId: string;
      }
    | {
        readonly kind: "course-start-12rm-deletion";
        readonly confirmationId: string;
        readonly recordedAt: string;
        readonly replacesObservationId: string;
      };
};

type PrerequisiteAcknowledgement = {
  readonly prerequisiteId: RequiredPrerequisiteId;
  readonly acknowledgedAt: string;
  readonly source: ObservationSource;
  readonly idempotencyKey?: string;
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
  readonly errors: readonly { readonly file: string; readonly message: string }[];
  readonly requiredCheckpointWeek?: 4 | 8 | 12;
};

type JourneyConfirmationField = {
  readonly path: "amount" | "unit" | "occurredAt" | "exerciseId" | "valueKg";
  readonly question: string;
};

type PendingJourneyConfirmation = {
  readonly schemaVersion: "stella-fitness/program-journey-confirmation/v0.1";
  readonly confirmationId: string;
  readonly kind: "baseline-body-weight" | "course-start-12rm";
  readonly candidate: Readonly<Record<string, string | number>>;
  readonly fields: readonly JourneyConfirmationField[];
  readonly source: ObservationSource;
  readonly receivedAt: string;
  readonly artifactReference: {
    readonly kind: "openclaw-message";
    readonly channel?: string;
    readonly messageId?: string;
    readonly runId?: string;
  };
  readonly executionProvenance: {
    readonly kind: "deterministic-text-parser";
    readonly version: "v0.1";
    readonly executedAt: string;
  };
  readonly resolution?: {
    readonly valuesFingerprint: string;
    readonly values: Readonly<Record<string, unknown>>;
    readonly observationId: string;
    readonly resolvedAt: string;
    readonly source: ObservationSource;
  };
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
  readonly runtimeDirectory: string;
  readonly preflight: () => ConfigurationPreflightResult;
}) {
  const personalDataDirectory = options.personalDataDirectory;
  const runtimeDirectory = options.runtimeDirectory;
  return {
    async status(input: { readonly date?: string } = {}): Promise<ProgramJourneyStatus> {
      assertJourneyPreflight(options.preflight());
      const setup = await ensureSetup(personalDataDirectory);
      const active = await readActiveProgramIfPresent({ personalDataDirectory });
      const baseline = setup.baselineObservationId === undefined
        ? undefined
        : await resolveBodyWeightReference(personalDataDirectory, setup.baselineObservationId);
      const initial = await readInitial12RMObservations(personalDataDirectory);
      const bodyWeightView = await rebuildBodyWeightView(personalDataDirectory);
      const activeInitialByExercise = new Map<
        Initial12RMExerciseId,
        CourseStart12RMObservation
      >();
      for (const exerciseId of INITIAL_12RM_EXERCISES) {
        const referenceId = setup.initial12RMObservationIds[exerciseId];
        if (referenceId === undefined) continue;
        const resolved = resolveInitial12RMReference(initial.observations, referenceId);
        if (resolved?.exerciseId === exerciseId) {
          activeInitialByExercise.set(exerciseId, resolved);
        }
      }
      const missingPrerequisiteIds = REQUIRED_PREREQUISITES.filter(
        (id) => setup.prerequisiteAcknowledgements[id] === undefined,
      );
      const missingInitial12RMExerciseIds = INITIAL_12RM_EXERCISES.filter((id) => {
        return activeInitialByExercise.get(id) === undefined;
      });
      const common = {
        schemaVersion: "stella-fitness/program-journey-status/v0.1" as const,
        program: { id: "zhuoshu-12-week", version: "0.2.0" },
        missingPrerequisiteIds,
        missingInitial12RMExerciseIds,
        errors: [...bodyWeightView.errors, ...initial.errors],
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
      assertJourneyPreflight(options.preflight());
      const prerequisiteId = requiredPrerequisiteId(input.prerequisiteId);
      assertTimestamp(input.acknowledgedAt, "acknowledgedAt");
      await ensureSetup(personalDataDirectory);
      await updateSetup(personalDataDirectory, runtimeDirectory, (setup) => {
        const existing = setup.prerequisiteAcknowledgements[prerequisiteId];
        const idempotencyKey = prerequisiteIdempotencyKey(
          prerequisiteId,
          input.source,
        );
        const reusedBy = Object.values(setup.prerequisiteAcknowledgements)
          .find((candidate) =>
            candidate !== undefined &&
            candidate.prerequisiteId !== prerequisiteId &&
            (candidate.idempotencyKey ?? prerequisiteIdempotencyKey(
              candidate.prerequisiteId,
              candidate.source,
            )) === idempotencyKey,
          );
        if (reusedBy !== undefined) {
          throw new Error(
            `Prerequisite idempotency key was reused for another prerequisite: ${reusedBy.prerequisiteId}`,
          );
        }
        const acknowledgement: PrerequisiteAcknowledgement = {
          prerequisiteId,
          acknowledgedAt: input.acknowledgedAt,
          source: input.source,
          idempotencyKey,
        };
        if (existing !== undefined) {
          const existingIdempotencyKey = existing.idempotencyKey ??
            prerequisiteIdempotencyKey(prerequisiteId, existing.source);
          if (existingIdempotencyKey === acknowledgement.idempotencyKey) {
            return setup;
          }
          if (JSON.stringify(existing) !== JSON.stringify(acknowledgement)) {
            throw new Error(`Prerequisite ${prerequisiteId} was already acknowledged with different provenance`);
          }
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
      assertJourneyPreflight(options.preflight());
      await ensureSetup(personalDataDirectory);
      const candidate = parseBodyWeightInput(input);
      if ("status" in candidate) {
        return candidate;
      }
      if (input.role === "checkpoint" && ![4, 8, 12].includes(input.checkpointWeek ?? 0)) {
        throw new Error("Checkpoint week must be 4, 8 or 12");
      }
      return await withSetupLock(runtimeDirectory, async () => {
        const journeyStatus = input.role === "baseline"
          ? await this.status()
          : await this.status({
              date: await checkpointGateDate(
                personalDataDirectory,
                input.checkpointWeek,
              ),
            });
        if (
          input.role === "baseline" &&
          journeyStatus.state !== "BASELINE_WEIGHT_REQUIRED"
        ) {
          throw new Error(`Baseline body weight is unavailable in ${journeyStatus.state}`);
        }
        if (
          input.role === "checkpoint" &&
          (journeyStatus.state !== "PHASE_CHECKPOINT_REQUIRED" ||
            journeyStatus.requiredCheckpointWeek !== input.checkpointWeek)
        ) {
          throw new Error(`Checkpoint body weight is unavailable in ${journeyStatus.state}`);
        }
        const observation = await persistBodyWeightObservation({
          personalDataDirectory,
          amount: candidate.amount,
          unit: candidate.unit,
          occurredAt: candidate.occurredAt,
          source: { kind: "user-text", text: input.text, ...input.source },
          recordedAt: new Date(input.receivedAt).toISOString(),
        });
        await writeUpdatedSetup(personalDataDirectory, (setup) =>
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
        return { status: "recorded" as const, role: input.role, observation };
      });
    },

    async correctBodyWeight(input: {
      readonly replacesObservationId: string;
      readonly text: string;
      readonly receivedAt: string;
      readonly source?: Omit<ObservationSource, "kind" | "text">;
    }) {
      assertJourneyPreflight(options.preflight());
      const candidate = parseBodyWeightInput(input);
      if ("status" in candidate) return candidate;
      return await withSetupLock(runtimeDirectory, async () => {
        const setup = await readSetup(personalDataDirectory);
        const active = setup.baselineObservationId === undefined
          ? undefined
          : await resolveBodyWeightReference(
              personalDataDirectory,
              setup.baselineObservationId,
            );
        if (active?.id !== input.replacesObservationId) {
          throw new Error("Only the active baseline body weight can be corrected");
        }
        const observation = await persistBodyWeightCorrection({
          personalDataDirectory,
          replacesObservationId: input.replacesObservationId,
          amount: candidate.amount,
          unit: candidate.unit,
          ...(candidate.occurrenceTimeSource === "explicit"
            ? { occurredAt: candidate.occurredAt }
            : {}),
          source: { kind: "user-text", text: input.text, ...input.source },
          recordedAt: new Date(input.receivedAt).toISOString(),
        });
        return { status: "recorded" as const, role: "baseline" as const, observation };
      });
    },

    async deleteBodyWeight(input: {
      readonly observationId: string;
      readonly deletedAt: string;
      readonly source: ObservationSource;
    }): Promise<BodyWeightObservation> {
      assertJourneyPreflight(options.preflight());
      assertTimestamp(input.deletedAt, "deletedAt");
      return await withSetupLock(runtimeDirectory, async () => {
        const setup = await readSetup(personalDataDirectory);
        const active = setup.baselineObservationId === undefined
          ? undefined
          : await resolveBodyWeightReference(
              personalDataDirectory,
              setup.baselineObservationId,
            );
        if (active?.id !== input.observationId) {
          throw new Error("Only the active baseline body weight can be deleted");
        }
        return await persistBodyWeightDeletion({
          personalDataDirectory,
          observationId: input.observationId,
          source: input.source,
          recordedAt: input.deletedAt,
        });
      });
    },

    async recordInitial12RM(input: {
      readonly exerciseId: Initial12RMExerciseId;
      readonly valueKg: number;
      readonly confirmationId: string;
      readonly occurredAt: string;
      readonly recordedAt: string;
      readonly source: ObservationSource;
    }): Promise<CourseStart12RMObservation> {
      assertJourneyPreflight(options.preflight());
      await ensureSetup(personalDataDirectory);
      if ((await readActiveProgramIfPresent({ personalDataDirectory })) !== undefined) {
        throw new Error("Course-start 12RM cannot change after activation");
      }
      const journeyStatus = await this.status();
      if (journeyStatus.state !== "INITIAL_12RM_REQUIRED") {
        const existing = await findInitial12RMByConfirmation(
          personalDataDirectory,
          input.confirmationId,
        );
        if (existing !== undefined) {
          assertSameInitial12RM(existing, input);
          return existing;
        }
        throw new Error(`Course-start 12RM is unavailable in ${journeyStatus.state}`);
      }
      return await withSetupLock(runtimeDirectory, async () => {
        const setup = await readSetup(personalDataDirectory);
        const existingObservationId = setup.initial12RMObservationIds[input.exerciseId];
        if (existingObservationId !== undefined) {
          const existing = resolveInitial12RMReference(
            (await readInitial12RMObservations(personalDataDirectory)).observations,
            existingObservationId,
          );
          if (existing !== undefined) {
            if (existing.provenance.confirmationId === input.confirmationId) {
              assertSameInitial12RM(existing, input);
              return existing;
            }
            throw new Error(`Course-start 12RM is already recorded for ${input.exerciseId}`);
          }
        }
        const observation = await persistInitial12RM(personalDataDirectory, input);
        await writeUpdatedSetup(personalDataDirectory, (setup) => ({
          ...setup,
          initial12RMObservationIds: {
            ...setup.initial12RMObservationIds,
            [input.exerciseId]: observation.id,
          },
        }));
        return observation;
      });
    },

    async correctInitial12RM(input: {
      readonly replacesObservationId: string;
      readonly valueKg: number;
      readonly confirmationId: string;
      readonly occurredAt: string;
      readonly recordedAt: string;
      readonly source: ObservationSource;
    }): Promise<CourseStart12RMObservation> {
      assertJourneyPreflight(options.preflight());
      if ((await readActiveProgramIfPresent({ personalDataDirectory })) !== undefined) {
        throw new Error("Course-start 12RM cannot change after activation");
      }
      return await withSetupLock(runtimeDirectory, async () => {
        const setup = await readSetup(personalDataDirectory);
        const records = (await readInitial12RMObservations(personalDataDirectory)).observations;
        const activeEntry = INITIAL_12RM_EXERCISES.map((exerciseId) => ({
          exerciseId,
          referenceId: setup.initial12RMObservationIds[exerciseId],
        })).find(({ referenceId }) =>
          referenceId !== undefined &&
          resolveInitial12RMReference(records, referenceId)?.id === input.replacesObservationId,
        );
        if (activeEntry === undefined) {
          const existing = await findInitial12RMByConfirmation(
            personalDataDirectory,
            input.confirmationId,
          );
          if (existing !== undefined) {
            assertSameInitial12RM(existing, {
              exerciseId: existing.exerciseId,
              valueKg: input.valueKg,
              source: input.source,
            });
            return existing;
          }
          throw new Error("Only an active course-start 12RM can be corrected");
        }
        return await persistInitial12RMReplacement(personalDataDirectory, {
          ...input,
          exerciseId: activeEntry.exerciseId,
          kind: "course-start-12rm-correction",
        });
      });
    },

    async deleteInitial12RM(input: {
      readonly observationId: string;
      readonly confirmationId: string;
      readonly deletedAt: string;
      readonly source: ObservationSource;
    }): Promise<CourseStart12RMObservation> {
      assertJourneyPreflight(options.preflight());
      if ((await readActiveProgramIfPresent({ personalDataDirectory })) !== undefined) {
        throw new Error("Course-start 12RM cannot change after activation");
      }
      assertTimestamp(input.deletedAt, "deletedAt");
      return await withSetupLock(runtimeDirectory, async () => {
        const setup = await readSetup(personalDataDirectory);
        const records = (await readInitial12RMObservations(personalDataDirectory)).observations;
        const active = INITIAL_12RM_EXERCISES.map((exerciseId) => {
          const referenceId = setup.initial12RMObservationIds[exerciseId];
          return referenceId === undefined
            ? undefined
            : resolveInitial12RMReference(records, referenceId);
        }).find((observation) => observation?.id === input.observationId);
        if (active === undefined) {
          const existing = await findInitial12RMByConfirmation(
            personalDataDirectory,
            input.confirmationId,
          );
          if (
            existing?.provenance.kind === "course-start-12rm-deletion" &&
            existing.provenance.replacesObservationId === input.observationId
          ) return existing;
          throw new Error("Only an active course-start 12RM can be deleted");
        }
        return await persistInitial12RMReplacement(personalDataDirectory, {
          exerciseId: active.exerciseId,
          valueKg: active.result.value,
          confirmationId: input.confirmationId,
          occurredAt: active.occurredAt,
          recordedAt: input.deletedAt,
          source: input.source,
          replacesObservationId: active.id,
          kind: "course-start-12rm-deletion",
        });
      });
    },

    async submitText(input: {
      readonly text: string;
      readonly receivedAt: string;
      readonly source?: Omit<ObservationSource, "kind" | "text">;
    }) {
      assertJourneyPreflight(options.preflight());
      const receivedAt = new Date(input.receivedAt).toISOString();
      const source: ObservationSource = {
        kind: "user-text",
        text: input.text,
        ...input.source,
      };
      const status = await this.status({ date: receivedAt.slice(0, 10) });
      if (status.state === "BASELINE_WEIGHT_REQUIRED") {
        const parsed = parseBodyWeightInput(input);
        if (!("status" in parsed)) {
          const recorded = await this.recordBodyWeight({
            role: "baseline",
            ...input,
          });
          if (recorded.status !== "recorded") {
            throw new Error("Clear baseline input unexpectedly needs confirmation");
          }
          return {
            status: "recorded" as const,
            kind: "baseline-body-weight" as const,
            observation: recorded.observation,
          };
        }
        const candidate = partialBodyWeightCandidate(input.text, receivedAt);
        const fields = bodyWeightConfirmationFields(candidate, parsed);
        return await persistJourneyConfirmation(personalDataDirectory, {
          kind: "baseline-body-weight",
          candidate,
          fields,
          source,
          receivedAt,
        });
      }
      if (status.state === "INITIAL_12RM_REQUIRED") {
        const parsed = parseInitial12RMText(input.text, receivedAt);
        if (parsed.fields.length === 0) {
          const observation = await this.recordInitial12RM({
            exerciseId: parsed.candidate.exerciseId as Initial12RMExerciseId,
            valueKg: parsed.candidate.valueKg as number,
            confirmationId: stableJourneyConfirmationId(
              "course-start-12rm",
              source,
            ),
            occurredAt: parsed.candidate.occurredAt as string,
            recordedAt: receivedAt,
            source,
          });
          return {
            status: "recorded" as const,
            kind: "course-start-12rm" as const,
            observation,
          };
        }
        return await persistJourneyConfirmation(personalDataDirectory, {
          kind: "course-start-12rm",
          candidate: parsed.candidate,
          fields: parsed.fields,
          source,
          receivedAt,
        });
      }
      throw new Error(`Program Journey text recording is unavailable in ${status.state}`);
    },

    async confirmCandidate(input: {
      readonly confirmationId: string;
      readonly values: Readonly<Record<string, unknown>>;
      readonly confirmedAt: string;
      readonly source: ObservationSource;
    }) {
      assertJourneyPreflight(options.preflight());
      return await withSetupLock(runtimeDirectory, async () => {
        const pending = await readJourneyConfirmation(
        personalDataDirectory,
        input.confirmationId,
        );
        const valuesFingerprint = fingerprintJson(input.values);
        if (pending.resolution !== undefined) {
          if (pending.resolution.valuesFingerprint !== valuesFingerprint) {
            throw new Error("Program Journey confirmation ID was reused with different values");
          }
          return await resolvedJourneyConfirmation(personalDataDirectory, pending);
        }
        const allowedPaths = new Set(pending.fields.map(({ path }) => path));
        const unexpectedPath = Object.keys(input.values).find(
          (path) => !allowedPaths.has(path as JourneyConfirmationField["path"]),
        );
        if (unexpectedPath !== undefined) {
          throw new Error(`Program Journey confirmation does not accept ${unexpectedPath}`);
        }
        const merged = { ...pending.candidate, ...input.values };
        const missing = pending.fields.filter(({ path }) => merged[path] === undefined);
        if (missing.length > 0) {
          throw new Error(`Program Journey confirmation is missing ${missing[0]!.path}`);
        }
        let result;
        if (pending.kind === "baseline-body-weight") {
          const status = await this.status();
          if (status.state !== "BASELINE_WEIGHT_REQUIRED") {
            throw new Error(`Baseline confirmation is unavailable in ${status.state}`);
          }
          const setup = await readSetup(personalDataDirectory);
          const existingBaseline = setup.baselineObservationId === undefined
            ? undefined
            : await resolveBodyWeightReference(
                personalDataDirectory,
                setup.baselineObservationId,
              );
          if (existingBaseline !== undefined) {
            throw new Error("Baseline body weight is already recorded");
          }
          const amount = positiveNumber(merged.amount, "Baseline amount");
          const unit = bodyWeightUnit(merged.unit);
          const occurredAt = canonicalTimestamp(merged.occurredAt, "Baseline occurredAt");
          const observation = await persistBodyWeightObservation({
            personalDataDirectory,
            amount,
            unit,
            occurredAt,
            source: confirmationSource(pending),
            recordedAt: new Date(input.confirmedAt).toISOString(),
          });
          await writeUpdatedSetup(personalDataDirectory, (setup) => ({
            ...setup,
            baselineObservationId: observation.id,
          }));
          result = {
            status: "recorded" as const,
            kind: "baseline-body-weight" as const,
            observation,
          };
        } else {
          const status = await this.status();
          if (status.state !== "INITIAL_12RM_REQUIRED") {
            throw new Error(`Course-start 12RM confirmation is unavailable in ${status.state}`);
          }
          const exerciseId = initial12RMExerciseId(merged.exerciseId);
          const setup = await readSetup(personalDataDirectory);
          const existingReference = setup.initial12RMObservationIds[exerciseId];
          const existingObservation = existingReference === undefined
            ? undefined
            : resolveInitial12RMReference(
                (await readInitial12RMObservations(personalDataDirectory)).observations,
                existingReference,
              );
          if (existingObservation !== undefined) {
            throw new Error(`Course-start 12RM is already recorded for ${exerciseId}`);
          }
          const valueKg = positiveNumber(merged.valueKg, "Initial 12RM valueKg");
          const observation = await persistInitial12RM(personalDataDirectory, {
            exerciseId,
            valueKg,
            confirmationId: pending.confirmationId,
            occurredAt: canonicalTimestamp(merged.occurredAt, "Initial 12RM occurredAt"),
            recordedAt: new Date(input.confirmedAt).toISOString(),
            source: confirmationSource(pending),
          });
          await writeUpdatedSetup(personalDataDirectory, (setup) => ({
            ...setup,
            initial12RMObservationIds: {
              ...setup.initial12RMObservationIds,
              [exerciseId]: observation.id,
            },
          }));
          result = {
            status: "recorded" as const,
            kind: "course-start-12rm" as const,
            observation,
          };
        }
        await writeJourneyConfirmation(personalDataDirectory, {
          ...pending,
          resolution: {
            valuesFingerprint,
            values: input.values,
            observationId: result.observation.id,
            resolvedAt: new Date(input.confirmedAt).toISOString(),
            source: input.source,
          },
        });
        return result;
      });
    },

    async activate(cycleStart: string): Promise<ProgramState> {
      assertJourneyPreflight(options.preflight());
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
      const bindings: Record<string, Readonly<Record<"A", SymbolicLoadBinding>>> = {};
      for (const exerciseId of INITIAL_12RM_EXERCISES) {
        const observationId = setup.initial12RMObservationIds[exerciseId]!;
        const observation = resolveInitial12RMReference(
          observations.observations,
          observationId,
        );
        if (observation === undefined) {
          throw new Error(`Initial 12RM Observation is missing for ${exerciseId}`);
        }
        if (observation.exerciseId !== exerciseId) {
          throw new Error(`Initial 12RM Observation is mapped to the wrong exercise: ${exerciseId}`);
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
      assertJourneyPreflight(options.preflight());
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
  runtimeDirectory: string,
  update: (setup: ProgramSetup) => ProgramSetup,
): Promise<ProgramSetup> {
  return await withSetupLock(runtimeDirectory, async () =>
    await writeUpdatedSetup(personalDataDirectory, update),
  );
}

async function writeUpdatedSetup(
  personalDataDirectory: string,
  update: (setup: ProgramSetup) => ProgramSetup,
): Promise<ProgramSetup> {
  const current = await readSetup(personalDataDirectory);
  const next = update(current);
  const path = join(personalDataDirectory, SETUP_FILE);
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(next, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    await rename(temporaryPath, path);
  } finally {
    await unlink(temporaryPath).catch(() => undefined);
  }
  return next;
}

async function withSetupLock<T>(runtimeDirectory: string, run: () => Promise<T>): Promise<T> {
  await mkdir(runtimeDirectory, { recursive: true, mode: 0o700 });
  const databasePath = join(runtimeDirectory, RUNTIME_LOCK_DATABASE);
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const database = new DatabaseSync(databasePath);
    let transactionOpen = false;
    try {
      database.exec("BEGIN IMMEDIATE");
      transactionOpen = true;
      const result = await run();
      database.exec("COMMIT");
      transactionOpen = false;
      return result;
    } catch (error) {
      if (transactionOpen) {
        try {
          database.exec("ROLLBACK");
        } catch {
          // Closing the connection below also releases an interrupted transaction.
        }
        transactionOpen = false;
      }
      if (!isSqliteBusy(error)) throw error;
    } finally {
      database.close();
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Program Setup is busy");
}

function isSqliteBusy(error: unknown): boolean {
  return error instanceof Error &&
    (("errcode" in error && error.errcode === 5) ||
      /SQLITE_BUSY|database is locked/iu.test(error.message));
}

async function persistJourneyConfirmation(
  personalDataDirectory: string,
  input: Omit<
    PendingJourneyConfirmation,
    "schemaVersion" | "confirmationId" | "artifactReference" | "executionProvenance"
  >,
) {
  const confirmation: PendingJourneyConfirmation = {
    schemaVersion: "stella-fitness/program-journey-confirmation/v0.1",
    confirmationId: stableJourneyConfirmationId(input.kind, input.source),
    kind: input.kind,
    candidate: input.candidate,
    fields: input.fields,
    source: input.source,
    receivedAt: input.receivedAt,
    artifactReference: {
      kind: "openclaw-message",
      ...(input.source.channel === undefined ? {} : { channel: input.source.channel }),
      ...(input.source.messageId === undefined ? {} : { messageId: input.source.messageId }),
      ...(input.source.runId === undefined ? {} : { runId: input.source.runId }),
    },
    executionProvenance: {
      kind: "deterministic-text-parser",
      version: "v0.1",
      executedAt: input.receivedAt,
    },
  };
  const directory = join(personalDataDirectory, JOURNEY_CONFIRMATION_DIRECTORY);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, `${confirmation.confirmationId}.json`);
  const existing = await readFile(path, "utf8").then(
    (source) => parseJourneyConfirmation(source),
    (error: unknown) => {
      if (isMissing(error)) return undefined;
      throw error;
    },
  );
  if (existing !== undefined) {
    const { resolution: _existingResolution, ...existingCandidate } = existing;
    if (fingerprintJson(existingCandidate) !== fingerprintJson(confirmation)) {
      throw new Error("Program Journey confirmation ID identifies a different candidate");
    }
  } else {
    await writeFile(path, `${JSON.stringify(confirmation, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    }).catch(async (error: unknown) => {
      if (!isAlreadyExists(error)) throw error;
      const concurrent = parseJourneyConfirmation(await readFile(path, "utf8"));
      const { resolution: _concurrentResolution, ...concurrentCandidate } = concurrent;
      if (fingerprintJson(concurrentCandidate) !== fingerprintJson(confirmation)) {
        throw new Error("Program Journey confirmation ID identifies a different candidate");
      }
    });
  }
  return {
    status: "confirmation" as const,
    kind: confirmation.kind,
    confirmationId: confirmation.confirmationId,
    fields: confirmation.fields,
  };
}

async function readJourneyConfirmation(
  personalDataDirectory: string,
  confirmationId: string,
): Promise<PendingJourneyConfirmation> {
  if (!isUuid(confirmationId)) {
    throw new Error("Program Journey confirmation ID must be a UUID");
  }
  return parseJourneyConfirmation(await readFile(join(
    personalDataDirectory,
    JOURNEY_CONFIRMATION_DIRECTORY,
    `${confirmationId}.json`,
  ), "utf8").catch((error: unknown) => {
    if (isMissing(error)) {
      throw new Error("Program Journey confirmation is unavailable");
    }
    throw error;
  }));
}

async function writeJourneyConfirmation(
  personalDataDirectory: string,
  confirmation: PendingJourneyConfirmation,
): Promise<void> {
  const directory = join(personalDataDirectory, JOURNEY_CONFIRMATION_DIRECTORY);
  const path = join(directory, `${confirmation.confirmationId}.json`);
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(confirmation, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  await rename(temporary, path);
}

function parseJourneyConfirmation(source: string): PendingJourneyConfirmation {
  const value: unknown = JSON.parse(source);
  if (
    !isRecord(value) ||
    value.schemaVersion !== "stella-fitness/program-journey-confirmation/v0.1" ||
    !isUuid(value.confirmationId) ||
    (value.kind !== "baseline-body-weight" && value.kind !== "course-start-12rm") ||
    !isRecord(value.candidate) ||
    !Object.values(value.candidate).every((entry) =>
      typeof entry === "string" ||
      (typeof entry === "number" && Number.isFinite(entry)),
    ) ||
    !Array.isArray(value.fields) ||
    !value.fields.every((field) =>
      isRecord(field) &&
      isJourneyConfirmationPath(field.path) &&
      typeof field.question === "string" &&
      field.question.trim().length > 0,
    ) ||
    !isObservationSource(value.source) ||
    typeof value.receivedAt !== "string" ||
    !isCanonicalTimestamp(value.receivedAt) ||
    !isRecord(value.artifactReference) ||
    value.artifactReference.kind !== "openclaw-message" ||
    !isRecord(value.executionProvenance) ||
    value.executionProvenance.kind !== "deterministic-text-parser" ||
    value.executionProvenance.version !== "v0.1" ||
    (value.resolution !== undefined &&
      (!isRecord(value.resolution) ||
        typeof value.resolution.valuesFingerprint !== "string" ||
        !isRecord(value.resolution.values) ||
        !isUuid(value.resolution.observationId) ||
        typeof value.resolution.resolvedAt !== "string" ||
        !isCanonicalTimestamp(value.resolution.resolvedAt) ||
        !isObservationSource(value.resolution.source)))
  ) {
    throw new Error("Program Journey confirmation is schema-invalid");
  }
  return value as PendingJourneyConfirmation;
}

function stableJourneyConfirmationId(
  kind: PendingJourneyConfirmation["kind"],
  source: ObservationSource,
): string {
  if (source.messageId === undefined && source.runId === undefined) {
    return randomUUID();
  }
  const hex = createHash("sha256")
    .update([kind, source.channel ?? "", source.messageId ?? "", source.runId ?? ""].join("\u0000"))
    .digest("hex")
    .slice(0, 32)
    .split("");
  hex[12] = "4";
  hex[16] = "8";
  return `${hex.slice(0, 8).join("")}-${hex.slice(8, 12).join("")}-${hex.slice(12, 16).join("")}-${hex.slice(16, 20).join("")}-${hex.slice(20).join("")}`;
}

function fingerprintJson(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (isRecord(value)) {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new Error("Program Journey confirmation contains an unsupported value");
  }
  return serialized;
}

function partialBodyWeightCandidate(
  text: string,
  receivedAt: string,
): Readonly<Record<string, string | number>> {
  const amounts = [...text.matchAll(/([+-]?\d+(?:\.\d+)?)(?![^\d]*(?:T|:))/gu)]
    .map((match) => Number(match[1]))
    .filter((value) => Number.isFinite(value) && value > 0);
  const unit = /(?:kg|kgs?)\b|公斤|千克/iu.test(text)
    ? "kg"
    : /(?:lb|lbs?)\b|磅/iu.test(text)
      ? "lb"
      : undefined;
  const ambiguousTime = /昨天|前天|yesterday|the day before yesterday/iu.test(text) ||
    /\b\d{4}-\d{2}-\d{2}\b(?!T)/u.test(text);
  return {
    ...(amounts.length === 1 ? { amount: amounts[0]! } : {}),
    ...(unit === undefined ? {} : { unit }),
    ...(ambiguousTime ? {} : { occurredAt: receivedAt }),
  };
}

function bodyWeightConfirmationFields(
  candidate: Readonly<Record<string, string | number>>,
  clarification: { readonly question: string },
): readonly JourneyConfirmationField[] {
  const fields: JourneyConfirmationField[] = [];
  if (candidate.amount === undefined) {
    fields.push({ path: "amount", question: "请确认一个体重数值。" });
  }
  if (candidate.unit === undefined) {
    fields.push({ path: "unit", question: "请确认体重单位：kg 还是 lb？" });
  }
  if (candidate.occurredAt === undefined) {
    fields.push({ path: "occurredAt", question: "请确认这次测量的发生时间。" });
  }
  return fields.length === 0
    ? [{ path: "amount", question: clarification.question }]
    : fields;
}

function parseInitial12RMText(text: string, receivedAt: string): {
  readonly candidate: Readonly<Record<string, string | number>>;
  readonly fields: readonly JourneyConfirmationField[];
} {
  const exerciseIds = INITIAL_12RM_EXERCISES.filter((exerciseId) => {
    const pattern = exerciseId === "goblet-squat"
      ? /高脚杯深蹲|goblet[ -]squat/iu
      : exerciseId === "dumbbell-bench-press"
        ? /哑铃卧推|dumbbell[ -]bench[ -]press/iu
        : /哑铃硬拉|dumbbell[ -]deadlift/iu;
    return pattern.test(text);
  });
  const withoutProtocol = text.replace(/12\s*RM/giu, "");
  const values = [...withoutProtocol.matchAll(/\b\d+(?:\.\d+)?\b/gu)]
    .map((match) => Number(match[0]))
    .filter((value) => Number.isFinite(value) && value > 0);
  const fields: JourneyConfirmationField[] = [];
  if (exerciseIds.length !== 1) {
    fields.push({ path: "exerciseId", question: "请确认一个 12RM 动作。" });
  }
  if (values.length !== 1 || !/(?:kg\b|公斤|千克)/iu.test(text)) {
    fields.push({ path: "valueKg", question: "请确认一个以 kg 表示的 12RM 数值。" });
  }
  const ambiguousTime = /昨天|前天|yesterday|the day before yesterday/iu.test(text);
  if (ambiguousTime) {
    fields.push({ path: "occurredAt", question: "请确认这次 12RM 的发生时间。" });
  }
  return {
    candidate: {
      ...(exerciseIds.length === 1 ? { exerciseId: exerciseIds[0]! } : {}),
      ...(values.length === 1 && /(?:kg\b|公斤|千克)/iu.test(text)
        ? { valueKg: values[0]! }
        : {}),
      ...(ambiguousTime ? {} : { occurredAt: receivedAt }),
    },
    fields,
  };
}

function confirmationSource(pending: PendingJourneyConfirmation): ObservationSource {
  return {
    ...pending.source,
    messageId: `confirmation:${pending.confirmationId}`,
  };
}

function positiveNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be a positive number`);
  }
  return value;
}

function bodyWeightUnit(value: unknown): BodyWeightUnit {
  if (value !== "kg" && value !== "lb") {
    throw new Error("Baseline unit must be kg or lb");
  }
  return value;
}

function canonicalTimestamp(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} must be an ISO timestamp`);
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) throw new Error(`${label} must be an ISO timestamp`);
  return timestamp.toISOString();
}

function initial12RMExerciseId(value: unknown): Initial12RMExerciseId {
  if (typeof value !== "string" || !isInitial12RMExerciseId(value)) {
    throw new Error("Initial 12RM exerciseId is unsupported");
  }
  return value;
}

function isJourneyConfirmationPath(
  value: unknown,
): value is JourneyConfirmationField["path"] {
  return value === "amount" || value === "unit" || value === "occurredAt" ||
    value === "exerciseId" || value === "valueKg";
}

async function resolvedJourneyConfirmation(
  personalDataDirectory: string,
  pending: PendingJourneyConfirmation,
) {
  if (pending.resolution === undefined) {
    throw new Error("Program Journey confirmation is unresolved");
  }
  const resolution = pending.resolution;
  if (pending.kind === "baseline-body-weight") {
    return {
      status: "recorded" as const,
      kind: pending.kind,
      observation: await readBodyWeightObservation(
        personalDataDirectory,
        resolution.observationId,
      ),
    };
  }
  const observation = (await readInitial12RMObservations(personalDataDirectory))
    .observations.find(({ id }) => id === resolution.observationId);
  if (observation === undefined) {
    throw new Error("Resolved course-start 12RM Observation is unavailable");
  }
  return { status: "recorded" as const, kind: pending.kind, observation };
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
  const existing = (await readInitial12RMObservations(personalDataDirectory)).observations.find(
    ({ provenance }) => provenance.confirmationId === input.confirmationId,
  );
  if (existing !== undefined) {
    assertSameInitial12RM(existing, input);
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

async function persistInitial12RMReplacement(
  personalDataDirectory: string,
  input: {
    readonly kind:
      | "course-start-12rm-correction"
      | "course-start-12rm-deletion";
    readonly replacesObservationId: string;
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
  const existing = await findInitial12RMByConfirmation(
    personalDataDirectory,
    input.confirmationId,
  );
  if (existing !== undefined) {
    if (
      existing.provenance.kind !== input.kind ||
      existing.provenance.replacesObservationId !== input.replacesObservationId
    ) {
      throw new Error("Initial 12RM confirmation ID was reused for different facts");
    }
    assertSameInitial12RM(existing, input);
    return existing;
  }
  if (!isUuid(input.confirmationId) || !isUuid(input.replacesObservationId)) {
    throw new Error("Initial 12RM confirmation and replacement IDs must be UUIDs");
  }
  assertTimestamp(input.occurredAt, "occurredAt");
  assertTimestamp(input.recordedAt, "recordedAt");
  const record: CourseStart12RMObservation = {
    schemaVersion: "stella-fitness/observation/course-start-12rm/v0.1",
    id: randomUUID(),
    kind: "course-start-12rm",
    exerciseId: input.exerciseId,
    result: { value: input.valueKg, unit: "kg", test: "12RM" },
    occurredAt: input.occurredAt,
    source: input.source,
    provenance: {
      kind: input.kind,
      confirmationId: input.confirmationId,
      recordedAt: input.recordedAt,
      replacesObservationId: input.replacesObservationId,
    },
  };
  const directory = join(personalDataDirectory, INITIAL_12RM_DIRECTORY);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(join(directory, `${record.id}.json`), `${JSON.stringify(record, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  return record;
}

function resolveInitial12RMReference(
  records: readonly CourseStart12RMObservation[],
  referenceId: string,
): CourseStart12RMObservation | undefined {
  const replacements = new Map<string, CourseStart12RMObservation>();
  for (const record of records) {
    if (record.provenance.kind === "course-start-12rm-recording") continue;
    if (replacements.has(record.provenance.replacesObservationId)) {
      throw new Error(
        `Course-start 12RM Observation ${record.provenance.replacesObservationId} has multiple replacements`,
      );
    }
    replacements.set(record.provenance.replacesObservationId, record);
  }
  let current = records.find(({ id }) => id === referenceId);
  const visited = new Set<string>();
  while (current !== undefined) {
    if (visited.has(current.id)) return undefined;
    visited.add(current.id);
    const replacement = replacements.get(current.id);
    if (replacement === undefined) return current;
    if (replacement.provenance.kind === "course-start-12rm-deletion") {
      return undefined;
    }
    current = replacement;
  }
  return undefined;
}

async function findInitial12RMByConfirmation(
  personalDataDirectory: string,
  confirmationId: string,
): Promise<CourseStart12RMObservation | undefined> {
  return (await readInitial12RMObservations(personalDataDirectory)).observations.find(
    ({ provenance }) => provenance.confirmationId === confirmationId,
  );
}

function assertSameInitial12RM(
  existing: CourseStart12RMObservation,
  input: {
    readonly exerciseId: Initial12RMExerciseId;
    readonly valueKg: number;
    readonly source: ObservationSource;
  },
): void {
  if (
    existing.exerciseId !== input.exerciseId ||
    existing.result.value !== input.valueKg ||
    existing.source.text !== input.source.text
  ) {
    throw new Error("Initial 12RM confirmation ID was reused for different facts");
  }
}

async function readInitial12RMObservations(personalDataDirectory: string): Promise<{
  readonly observations: readonly CourseStart12RMObservation[];
  readonly errors: readonly { readonly file: string; readonly message: string }[];
}> {
  const directory = join(personalDataDirectory, INITIAL_12RM_DIRECTORY);
  const files = await readdir(directory).catch((error: unknown) => {
    if (isMissing(error)) return [];
    throw error;
  });
  const observations: CourseStart12RMObservation[] = [];
  const errors: Array<{ file: string; message: string }> = [];
  for (const file of files.filter((name) => name.endsWith(".json")).sort()) {
    try {
      const observation = parseInitial12RM(await readFile(join(directory, file), "utf8"));
      if (file !== `${observation.id}.json`) {
        throw new Error("Course-start 12RM Observation filename does not match its ID");
      }
      observations.push(observation);
    } catch (error) {
      errors.push({
        file: join(INITIAL_12RM_DIRECTORY, file),
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { observations, errors };
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
    typeof value.occurredAt !== "string" || !isCanonicalTimestamp(value.occurredAt) ||
    !isObservationSource(value.source) ||
    !isRecord(value.provenance) ||
    (value.provenance.kind !== "course-start-12rm-recording" &&
      value.provenance.kind !== "course-start-12rm-correction" &&
      value.provenance.kind !== "course-start-12rm-deletion") ||
    !isUuid(value.provenance.confirmationId) ||
    typeof value.provenance.recordedAt !== "string" ||
    !isCanonicalTimestamp(value.provenance.recordedAt) ||
    (value.provenance.kind !== "course-start-12rm-recording" &&
      !isUuid(value.provenance.replacesObservationId))
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
    !isRecord(value.checkpointObservationIds) ||
    !hasOnlyKeys(value, [
      "schemaVersion",
      "prerequisiteAcknowledgements",
      "baselineObservationId",
      "initial12RMObservationIds",
      "checkpointObservationIds",
    ]) ||
    (value.baselineObservationId !== undefined && !isUuid(value.baselineObservationId)) ||
    !validPrerequisiteAcknowledgements(value.prerequisiteAcknowledgements) ||
    !validObservationReferences(value.initial12RMObservationIds, INITIAL_12RM_EXERCISES) ||
    !validObservationReferences(value.checkpointObservationIds, ["4", "8", "12"])
  ) {
    throw new Error("Program Setup is schema-invalid");
  }
  return value as ProgramSetup;
}

function validPrerequisiteAcknowledgements(value: Record<string, unknown>): boolean {
  if (!hasOnlyKeys(value, REQUIRED_PREREQUISITES)) return false;
  return Object.entries(value).every(([key, acknowledgement]) =>
    isRecord(acknowledgement) &&
    hasOnlyKeys(acknowledgement, [
      "prerequisiteId",
      "acknowledgedAt",
      "source",
      "idempotencyKey",
    ]) &&
    acknowledgement.prerequisiteId === key &&
    typeof acknowledgement.acknowledgedAt === "string" &&
    isCanonicalTimestamp(acknowledgement.acknowledgedAt) &&
    (acknowledgement.idempotencyKey === undefined ||
      /^sha256:[0-9a-f]{64}$/u.test(String(acknowledgement.idempotencyKey))) &&
    isObservationSource(acknowledgement.source),
  );
}

function prerequisiteIdempotencyKey(
  prerequisiteId: RequiredPrerequisiteId,
  source: ObservationSource,
): string {
  const identity = source.messageId !== undefined
    ? ["message", source.channel ?? "", source.messageId]
    : source.runId !== undefined
      ? ["run", source.channel ?? "", source.runId]
      : ["fallback", prerequisiteId, source.channel ?? "", source.text];
  return `sha256:${createHash("sha256").update(identity.join("\u0000")).digest("hex")}`;
}

function validObservationReferences(
  value: Record<string, unknown>,
  allowedKeys: readonly string[],
): boolean {
  return hasOnlyKeys(value, allowedKeys) && Object.values(value).every(isUuid);
}

function isObservationSource(value: unknown): value is ObservationSource {
  return isRecord(value) &&
    hasOnlyKeys(value, ["kind", "text", "channel", "messageId", "runId"]) &&
    value.kind === "user-text" &&
    typeof value.text === "string" &&
    [value.channel, value.messageId, value.runId].every(
      (item) => item === undefined || typeof item === "string",
    );
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
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

async function checkpointGateDate(
  personalDataDirectory: string,
  checkpointWeek: 4 | 8 | 12 | undefined,
): Promise<string> {
  if (checkpointWeek === undefined) {
    throw new Error("Checkpoint week must be 4, 8 or 12");
  }
  const active = await readActiveProgramIfPresent({ personalDataDirectory });
  if (active === undefined) {
    throw new Error("Checkpoint body weight requires an Active Program State");
  }
  const start = new Date(`${active.state.cycle.startDate}T00:00:00.000Z`);
  return new Date(start.getTime() + checkpointWeek * 604_800_000)
    .toISOString()
    .slice(0, 10);
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
  if (result.readiness === "BLOCKED_CONFIGURATION") {
    throw new Error(`Program Journey is blocked by ${result.readiness}`);
  }
}

function isCanonicalTimestamp(value: string): boolean {
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
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
