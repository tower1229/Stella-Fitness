import type {
  ProgramRecord,
  ProgramPrerequisite,
  ProgramSession,
  ProgramSpec,
  ProgramWeek,
} from "../domain/program.js";
import { validateZhuoshuV02Fidelity } from "./fidelity/zhuoshu-v0.2.js";

const SUPPORTED_WEEKDAYS = new Set([
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
]);

export class InvalidProgramSpecError extends Error {
  constructor(readonly issues: readonly string[]) {
    super(`Invalid ProgramSpec: ${issues.join("; ")}`);
    this.name = "InvalidProgramSpecError";
  }
}

export function validateProgramSpec(input: unknown): ProgramSpec {
  const source = record(input, "ProgramSpec");
  const weeks = array(source.weeks, "weeks").map((value, index) =>
    validateWeek(value, index),
  );
  const program: ProgramSpec = {
    schemaVersion: text(source.schema_version, "schema_version"),
    id: text(source.id, "id"),
    version: text(source.version, "version"),
    status: text(source.status, "status"),
    phases: recordArray(source.phases, "phases"),
    prerequisites: validatePrerequisites(source.prerequisites),
    weeks,
    templates: recordMap(source.templates, "templates"),
    loadSymbols: recordMap(source.load_symbols, "load_symbols"),
    testingProtocols: recordMap(source.testing_protocols, "testing_protocols"),
    phaseTransitions: recordMap(source.phase_transitions, "phase_transitions"),
    exerciseAliases: recordMap(source.exercise_aliases, "exercise_aliases"),
    cycleCompletion: record(source.cycle_completion, "cycle_completion"),
  };
  validateRelationships(program);
  return program;
}

function validatePrerequisites(input: unknown): readonly ProgramPrerequisite[] {
  return array(input, "prerequisites").map((value, index) => {
    const prerequisite = record(value, `prerequisites[${index}]`);
    const kind = text(prerequisite.kind, `prerequisites[${index}].kind`);
    if (
      kind !== "equipment" &&
      kind !== "printed-material" &&
      kind !== "recording-protocol"
    ) {
      throw new InvalidProgramSpecError([
        `prerequisites[${index}].kind must be equipment, printed-material or recording-protocol`,
      ]);
    }
    if (prerequisite.required !== true) {
      throw new InvalidProgramSpecError([
        `prerequisites[${index}].required must be true`,
      ]);
    }
    return {
      id: text(prerequisite.id, `prerequisites[${index}].id`),
      kind: kind as ProgramPrerequisite["kind"],
      required: true,
      label: text(prerequisite.label, `prerequisites[${index}].label`),
    };
  });
}

function validateRelationships(program: ProgramSpec): void {
  const issues: string[] = [];
  if (program.schemaVersion !== "stella-fitness/program/v0.1") {
    issues.push(`unsupported schema_version ${program.schemaVersion}`);
  }
  const phaseDefinitions = new Map<
    string,
    { readonly frequency: number; readonly weeks: ReadonlySet<number> }
  >();
  for (const [index, phase] of program.phases.entries()) {
    const id = safeText(phase.id, `phases[${index}].id`, issues);
    const frequency = safePositiveInteger(
      phase.frequency_per_week,
      `phases[${index}].frequency_per_week`,
      issues,
    );
    const weeks = safeIntegerArray(
      phase.weeks,
      `phases[${index}].weeks`,
      issues,
    );
    if (id !== undefined && frequency !== undefined && weeks !== undefined) {
      if (phaseDefinitions.has(id)) {
        issues.push(`phases[${index}].id duplicates ${id}`);
      }
      phaseDefinitions.set(id, { frequency, weeks: new Set(weeks) });
    }
  }
  const weekNumbers = new Set<number>();

  for (const [index, week] of program.weeks.entries()) {
    if (weekNumbers.has(week.week)) {
      issues.push(`weeks[${index}].week duplicates ${week.week}`);
    }
    weekNumbers.add(week.week);
    const phase = phaseDefinitions.get(week.phase);
    if (phase === undefined) {
      issues.push(
        `weeks[${index}].phase references unknown phase ${week.phase}`,
      );
    } else {
      if (!phase.weeks.has(week.week)) {
        issues.push(`week ${week.week} is not declared by phase ${week.phase}`);
      }
      if (week.sessions.length !== phase.frequency) {
        issues.push(
          `week ${week.week} must contain ${phase.frequency} sessions for phase ${week.phase}`,
        );
      }
    }

    const days = new Set<string>();
    for (const [sessionIndex, session] of week.sessions.entries()) {
      const path = `weeks[${index}].sessions[${sessionIndex}]`;
      if (days.has(session.day)) {
        issues.push(`${path}.day duplicates ${session.day}`);
      }
      if (!SUPPORTED_WEEKDAYS.has(session.day)) {
        issues.push(`${path}.day must be a supported weekday`);
      }
      days.add(session.day);
      const template = optionalText(session.template);
      if (session.type === "strength-test") {
        if (!Array.isArray(session.tests) || session.tests.length === 0) {
          issues.push(`${path} strength-test session requires tests`);
        }
      } else if (template === undefined) {
        issues.push(`${path} resolved non-test session requires a template`);
      }
      if (template !== undefined && program.templates[template] === undefined) {
        issues.push(`${path} references unknown template ${template}`);
      }
      if (template !== undefined && session.type.endsWith("-recovery")) {
        validateRecoveryRelationship(
          program,
          week.phase,
          session.type,
          template,
          path,
          issues,
        );
      }
      validateSymbolReference(
        session.load,
        `${path}.load`,
        program.loadSymbols,
        issues,
      );
      validateTests(session.tests, `${path}.tests`, program, issues);
    }
  }

  const orderedWeeks = [...weekNumbers].sort((left, right) => left - right);
  for (const [index, week] of orderedWeeks.entries()) {
    if (week !== index + 1) {
      issues.push("weeks must be consecutive and start at 1");
      break;
    }
  }
  for (const [phaseId, phase] of phaseDefinitions) {
    for (const week of phase.weeks) {
      const actual = program.weeks.find((candidate) => candidate.week === week);
      if (actual === undefined || actual.phase !== phaseId) {
        issues.push(`phase ${phaseId} references missing week ${week}`);
      }
    }
  }

  for (const [symbol, definition] of Object.entries(program.loadSymbols)) {
    if (definition.per_exercise !== true) {
      issues.push(`load_symbols.${symbol}.per_exercise must be true`);
    }
  }
  validateTemplates(program, weekNumbers, issues);
  validateResultBindings(program, issues);
  validateTransitions(program, issues);
  validateCycleCompletion(program, weekNumbers, issues);
  validateAliases(program, issues);
  issues.push(...validateZhuoshuV02Fidelity(program));

  if (issues.length > 0) {
    throw new InvalidProgramSpecError(issues);
  }
}

function validateRecoveryRelationship(
  program: ProgramSpec,
  phase: string,
  recoveryType: string,
  recoveryTemplateId: string,
  path: string,
  issues: string[],
): void {
  if (!recoveryTemplateId.endsWith(`-${recoveryType}`)) {
    issues.push(
      `${path} recovery template ${recoveryTemplateId} does not match ${recoveryType}`,
    );
  }
  const basedOn = optionalText(program.templates[recoveryTemplateId]?.based_on);
  if (basedOn === undefined) {
    return;
  }
  const ordinaryType = recoveryType.slice(0, -"-recovery".length);
  const ordinaryTemplates = new Set(
    program.weeks
      .filter((week) => week.phase === phase)
      .flatMap((week) => week.sessions)
      .filter((session) => session.type === ordinaryType)
      .map((session) => optionalText(session.template))
      .filter((template): template is string => template !== undefined),
  );
  if (ordinaryTemplates.size !== 1) {
    issues.push(
      `${path} cannot resolve one ${phase} ${ordinaryType} template for recovery`,
    );
    return;
  }
  const expected = [...ordinaryTemplates][0]!;
  if (basedOn !== expected) {
    issues.push(
      `${path} ${recoveryType} must inherit the ${phase} ${ordinaryType} template ${expected}`,
    );
  }
}

function validateTemplates(
  program: ProgramSpec,
  weekNumbers: ReadonlySet<number>,
  issues: string[],
): void {
  for (const [templateId, template] of Object.entries(program.templates)) {
    const path = `templates.${templateId}`;
    const basedOn = optionalText(template.based_on);
    if (basedOn !== undefined && program.templates[basedOn] === undefined) {
      issues.push(`${path}.based_on references unknown template ${basedOn}`);
    }
    if (basedOn === templateId) {
      issues.push(`${path}.based_on must not reference itself`);
    }
    if (basedOn === undefined && !Array.isArray(template.exercises)) {
      issues.push(`${path}.exercises must be an array`);
      continue;
    }
    if (!Array.isArray(template.exercises)) {
      validateRecoveryOverrides(template, path, weekNumbers, issues);
      continue;
    }
    for (const [index, value] of template.exercises.entries()) {
      if (typeof value === "string") {
        continue;
      }
      const exercise = safeRecord(value, `${path}.exercises[${index}]`, issues);
      if (exercise === undefined) {
        continue;
      }
      safeText(
        exercise.exercise,
        `${path}.exercises[${index}].exercise`,
        issues,
      );
      validatePullUpSemantics(exercise, `${path}.exercises[${index}]`, issues);
      validateSymbolReference(
        exercise.load,
        `${path}.exercises[${index}].load`,
        program.loadSymbols,
        issues,
      );
      const load = safeRecord(exercise.load, "", []);
      if (load?.mode === "historical_reference") {
        const referencedWeek = load.week;
        if (
          typeof referencedWeek !== "number" ||
          !weekNumbers.has(referencedWeek)
        ) {
          issues.push(
            `${path}.exercises[${index}].load references unknown week ${String(referencedWeek)}`,
          );
        }
      }
    }
  }
  validateTemplateInheritance(program, issues);
}

function validateRecoveryOverrides(
  template: ProgramRecord,
  path: string,
  weekNumbers: ReadonlySet<number>,
  issues: string[],
): void {
  const overrides = safeRecord(template.overrides, `${path}.overrides`, issues);
  if (overrides === undefined) {
    return;
  }
  const allowed = new Set([
    "pullup_total",
    "overhead_press",
    "bench_effort",
    "lateral_raise",
    "main_effort",
  ]);
  for (const key of Object.keys(overrides)) {
    if (!allowed.has(key)) {
      issues.push(`${path}.overrides contains unsupported relationship ${key}`);
    }
  }
  if (overrides.pullup_total !== undefined) {
    safePositiveInteger(
      overrides.pullup_total,
      `${path}.overrides.pullup_total`,
      issues,
    );
  }
  for (const field of ["bench_effort", "main_effort"] as const) {
    if (overrides[field] !== undefined) {
      safeText(overrides[field], `${path}.overrides.${field}`, issues);
    }
  }
  for (const field of ["overhead_press", "lateral_raise"] as const) {
    if (overrides[field] === undefined) {
      continue;
    }
    const values = safeRecord(
      overrides[field],
      `${path}.overrides.${field}`,
      issues,
    );
    if (values === undefined) {
      continue;
    }
    safePositiveInteger(values.sets, `${path}.overrides.${field}.sets`, issues);
    safePositiveInteger(values.reps, `${path}.overrides.${field}.reps`, issues);
    safeText(values.effort, `${path}.overrides.${field}.effort`, issues);
    const reference = safeText(
      values.load_reference,
      `${path}.overrides.${field}.load_reference`,
      issues,
    );
    const match =
      reference === undefined ? null : /^week-(\d+)$/.exec(reference);
    if (match === null || !weekNumbers.has(Number(match[1]))) {
      issues.push(
        `${path}.overrides.${field}.load_reference references unknown week ${String(reference)}`,
      );
    }
  }
}

function validateTemplateInheritance(
  program: ProgramSpec,
  issues: string[],
): void {
  const complete = new Set<string>();
  const visiting = new Set<string>();

  const visit = (templateId: string): void => {
    if (complete.has(templateId)) {
      return;
    }
    if (visiting.has(templateId)) {
      issues.push(`template inheritance cycle includes ${templateId}`);
      return;
    }
    visiting.add(templateId);
    const basedOn = optionalText(program.templates[templateId]?.based_on);
    if (basedOn !== undefined && program.templates[basedOn] !== undefined) {
      visit(basedOn);
    }
    visiting.delete(templateId);
    complete.add(templateId);
  };

  for (const templateId of Object.keys(program.templates)) {
    visit(templateId);
  }
}

function validatePullUpSemantics(
  exercise: ProgramRecord,
  path: string,
  issues: string[],
): void {
  if (exercise.exercise !== "pull-up") {
    return;
  }
  const prescription =
    typeof exercise.prescription === "string"
      ? exercise.prescription
      : safeRecord(exercise.prescription, "", [])?.type;
  if (prescription !== "total_reps") {
    issues.push(`${path} ordinary pull-up prescription must be total_reps`);
  }
  const prescriptionRecord = safeRecord(exercise.prescription, "", []);
  if (
    exercise.sets !== "self_selected" &&
    prescriptionRecord?.sets !== "self_selected"
  ) {
    issues.push(`${path} ordinary pull-up sets must be self_selected`);
  }
  if (exercise.rest !== "self_selected") {
    issues.push(`${path} ordinary pull-up rest must be self_selected`);
  }
}

function validateResultBindings(program: ProgramSpec, issues: string[]): void {
  const allowed = new Set(Object.keys(program.loadSymbols));
  const assistanceBindings = new Set<string>();
  for (const [templateId, template] of Object.entries(program.templates)) {
    const assistance = safeRecord(template.pullup_assistance, "", []);
    if (assistance === undefined) {
      continue;
    }
    const source = safeText(
      assistance.source_baseline,
      `templates.${templateId}.pullup_assistance.source_baseline`,
      issues,
    );
    if (source !== undefined) {
      allowed.add(source);
      assistanceBindings.add(source);
    }
    if (assistance.preserve_programmed_total_reps !== true) {
      issues.push(
        `templates.${templateId}.pullup_assistance must preserve programmed total reps`,
      );
    }
  }

  const produced = new Set<string>();
  for (const [weekIndex, week] of program.weeks.entries()) {
    for (const [sessionIndex, session] of week.sessions.entries()) {
      if (!Array.isArray(session.tests)) {
        continue;
      }
      for (const [testIndex, input] of session.tests.entries()) {
        const test = safeRecord(input, "", []);
        const binding = optionalText(test?.result_binding);
        if (binding === undefined) {
          continue;
        }
        produced.add(binding);
        if (!allowed.has(binding)) {
          issues.push(
            `weeks[${weekIndex}].sessions[${sessionIndex}].tests[${testIndex}].result_binding references unknown relationship ${binding}`,
          );
        }
      }
    }
  }
  for (const binding of assistanceBindings) {
    if (!produced.has(binding)) {
      issues.push(
        `pull-up assistance relationship ${binding} has no producing test`,
      );
    }
  }
}

function validateTests(
  input: unknown,
  path: string,
  program: ProgramSpec,
  issues: string[],
): void {
  if (input === undefined) {
    return;
  }
  if (!Array.isArray(input)) {
    issues.push(`${path} must be an array`);
    return;
  }
  for (const [index, value] of input.entries()) {
    const test = safeRecord(value, `${path}[${index}]`, issues);
    if (test === undefined) {
      continue;
    }
    const protocol = safeText(
      test.protocol_ref,
      `${path}[${index}].protocol_ref`,
      issues,
    );
    const protocolDefinition =
      protocol === undefined ? undefined : program.testingProtocols[protocol];
    if (protocol !== undefined && protocolDefinition === undefined) {
      issues.push(
        `${path}[${index}] references unknown testing protocol ${protocol}`,
      );
    }
    const exercise = safeText(
      test.exercise,
      `${path}[${index}].exercise`,
      issues,
    );
    const testType = safeText(test.test, `${path}[${index}].test`, issues);
    safeText(test.result_binding, `${path}[${index}].result_binding`, issues);
    if (protocolDefinition !== undefined && protocol !== undefined) {
      const protocolType = safeText(
        protocolDefinition.type,
        `testing_protocols.${protocol}.type`,
        issues,
      );
      if (
        testType !== undefined &&
        protocolType !== undefined &&
        testType !== protocolType
      ) {
        issues.push(
          `${path}[${index}] test ${testType} does not match protocol ${protocol} type ${protocolType}`,
        );
      }
      if (
        exercise !== undefined &&
        Array.isArray(protocolDefinition.applies_to) &&
        !protocolDefinition.applies_to.includes(exercise)
      ) {
        issues.push(
          `${path}[${index}] exercise ${exercise} is not covered by protocol ${protocol}`,
        );
      }
      if (
        exercise !== undefined &&
        typeof protocolDefinition.exercise === "string" &&
        protocolDefinition.exercise !== exercise
      ) {
        issues.push(
          `${path}[${index}] exercise ${exercise} does not match protocol ${protocol} exercise ${protocolDefinition.exercise}`,
        );
      }
    }
  }
}

function validateTransitions(program: ProgramSpec, issues: string[]): void {
  for (const [id, transition] of Object.entries(program.phaseTransitions)) {
    const path = `phase_transitions.${id}`;
    for (const field of [
      "protocol_ref",
      "main_protocol_ref",
      "pullup_protocol_ref",
    ] as const) {
      const protocol = optionalText(transition[field]);
      if (
        protocol !== undefined &&
        program.testingProtocols[protocol] === undefined
      ) {
        issues.push(
          `${path}.${field} references unknown testing protocol ${protocol}`,
        );
      }
    }
    for (const field of [
      "bind_results_to",
      "bind_main_results_to",
      "bind_results_to_next_cycle",
    ] as const) {
      const symbol = optionalText(transition[field]);
      if (symbol !== undefined && program.loadSymbols[symbol] === undefined) {
        issues.push(
          `${path}.${field} references unknown load symbol ${symbol}`,
        );
      }
    }
    if (
      typeof transition.week === "number" &&
      typeof transition.day === "string"
    ) {
      const session = program.weeks
        .find(({ week }) => week === transition.week)
        ?.sessions.find(({ day }) => day === transition.day);
      if (session === undefined) {
        issues.push(`${path} references a missing session`);
      }
    }
  }
}

function validateCycleCompletion(
  program: ProgramSpec,
  weekNumbers: ReadonlySet<number>,
  issues: string[],
): void {
  const completion = program.cycleCompletion;
  const protocol = optionalText(completion.protocol_ref);
  if (
    protocol === undefined ||
    program.testingProtocols[protocol] === undefined
  ) {
    issues.push(
      `cycle_completion.protocol_ref references unknown testing protocol ${String(protocol)}`,
    );
  }
  const symbol = optionalText(completion.bind_to);
  if (symbol === undefined || program.loadSymbols[symbol] === undefined) {
    issues.push(
      `cycle_completion.bind_to references unknown load symbol ${String(symbol)}`,
    );
  }
  if (
    typeof completion.restart_from_week !== "number" ||
    !weekNumbers.has(completion.restart_from_week)
  ) {
    issues.push("cycle_completion.restart_from_week references unknown week");
  }
}

function validateAliases(program: ProgramSpec, issues: string[]): void {
  const aliases = new Set<string>();
  for (const [exerciseId, definition] of Object.entries(
    program.exerciseAliases,
  )) {
    const path = `exercise_aliases.${exerciseId}`;
    const canonical = safeText(
      definition.canonical_display_name,
      `${path}.canonical_display_name`,
      issues,
    );
    if (!Array.isArray(definition.aliases)) {
      issues.push(`${path}.aliases must be an array`);
      continue;
    }
    const values = definition.aliases.filter(
      (alias): alias is string => typeof alias === "string" && alias.length > 0,
    );
    if (values.length !== definition.aliases.length) {
      issues.push(`${path}.aliases must contain non-empty strings`);
    }
    if (canonical !== undefined && !values.includes(canonical)) {
      issues.push(`${path}.aliases must include the canonical display name`);
    }
    for (const alias of values) {
      if (aliases.has(alias)) {
        issues.push(`${path}.aliases duplicates ${alias}`);
      }
      aliases.add(alias);
    }
  }
}

function validateSymbolReference(
  input: unknown,
  path: string,
  symbols: Readonly<Record<string, ProgramRecord>>,
  issues: string[],
): void {
  if (
    typeof input === "string" &&
    input !== "self_selected" &&
    input !== "none" &&
    symbols[input] === undefined
  ) {
    issues.push(`${path} references unknown load symbol ${input}`);
  }
}

function safeRecord(
  input: unknown,
  path: string,
  issues: string[],
): ProgramRecord | undefined {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    if (path.length > 0) {
      issues.push(`${path} must be an object`);
    }
    return undefined;
  }
  return input as ProgramRecord;
}

function safeText(
  input: unknown,
  path: string,
  issues: string[],
): string | undefined {
  if (typeof input !== "string" || input.trim().length === 0) {
    issues.push(`${path} must be a non-empty string`);
    return undefined;
  }
  return input;
}

function optionalText(input: unknown): string | undefined {
  return typeof input === "string" && input.trim().length > 0
    ? input
    : undefined;
}

function safePositiveInteger(
  input: unknown,
  path: string,
  issues: string[],
): number | undefined {
  if (!Number.isInteger(input) || (input as number) <= 0) {
    issues.push(`${path} must be a positive integer`);
    return undefined;
  }
  return input as number;
}

function safeIntegerArray(
  input: unknown,
  path: string,
  issues: string[],
): readonly number[] | undefined {
  if (
    !Array.isArray(input) ||
    !input.every((value) => Number.isInteger(value))
  ) {
    issues.push(`${path} must contain integers`);
    return undefined;
  }
  return input as readonly number[];
}

function validateWeek(input: unknown, index: number): ProgramWeek {
  const value = record(input, `weeks[${index}]`);
  return {
    week: integer(value.week, `weeks[${index}].week`),
    phase: text(value.phase, `weeks[${index}].phase`),
    sessions: array(value.sessions, `weeks[${index}].sessions`).map(
      (session, sessionIndex) =>
        validateSession(session, `weeks[${index}].sessions[${sessionIndex}]`),
    ),
  };
}

function validateSession(input: unknown, path: string): ProgramSession {
  const value = record(input, path);
  const status = text(value.status, `${path}.status`);
  if (status !== "resolved") {
    throw new InvalidProgramSpecError([`${path}.status must be resolved`]);
  }
  return {
    ...value,
    day: text(value.day, `${path}.day`),
    type: text(value.type, `${path}.type`),
    status,
  };
}

function recordMap(
  input: unknown,
  path: string,
): Readonly<Record<string, ProgramRecord>> {
  const value = record(input, path);
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      record(entry, `${path}.${key}`),
    ]),
  );
}

function recordArray(input: unknown, path: string): readonly ProgramRecord[] {
  return array(input, path).map((value, index) =>
    record(value, `${path}[${index}]`),
  );
}

function record(input: unknown, path: string): ProgramRecord {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new InvalidProgramSpecError([`${path} must be an object`]);
  }
  return input as ProgramRecord;
}

function array(input: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(input)) {
    throw new InvalidProgramSpecError([`${path} must be an array`]);
  }
  return input;
}

function text(input: unknown, path: string): string {
  if (typeof input !== "string" || input.trim().length === 0) {
    throw new InvalidProgramSpecError([`${path} must be a non-empty string`]);
  }
  return input;
}

function integer(input: unknown, path: string): number {
  if (!Number.isInteger(input)) {
    throw new InvalidProgramSpecError([`${path} must be an integer`]);
  }
  return input as number;
}
