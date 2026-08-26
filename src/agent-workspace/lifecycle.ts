import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const JOURNAL_FILE = "managed-artifact-lifecycle-journal.json";
const JOURNAL_SCHEMA = "stella-fitness/managed-artifact-lifecycle-journal/v1";

type LifecycleInput = {
  readonly agentId: string;
  readonly asOf: string;
};

type LifecycleTransitionResult = {
  readonly status: string;
  readonly reasonCode?: string;
};

type LifecycleJournal = LifecycleInput & {
  readonly schema_version: typeof JOURNAL_SCHEMA;
  readonly phase: "prepared" | "workspace-retained";
};

type LifecycleTransactionOptions = {
  readonly runtimeDirectory: string;
  readonly transitionWorkspace: (
    input: LifecycleInput,
  ) => Promise<LifecycleTransitionResult>;
  readonly markContextStandalone: (
    input: { readonly asOf: string },
  ) => Promise<LifecycleTransitionResult>;
};

export type ManagedArtifactLifecycleTransaction = {
  retain(input: LifecycleInput): Promise<void>;
  recover(): Promise<boolean>;
};

export function createManagedArtifactLifecycleTransaction(
  options: LifecycleTransactionOptions,
): ManagedArtifactLifecycleTransaction {
  let active: Promise<void> | undefined;
  return {
    retain(input) {
      if (active !== undefined) return active;
      active = retain(options, input).finally(() => {
        active = undefined;
      });
      return active;
    },
    async recover() {
      const journal = await readJournal(options.runtimeDirectory);
      if (journal === undefined) return false;
      await this.retain({ agentId: journal.agentId, asOf: journal.asOf });
      return true;
    },
  };
}

async function retain(
  options: LifecycleTransactionOptions,
  input: LifecycleInput,
): Promise<void> {
  const existing = await readJournal(options.runtimeDirectory);
  if (
    existing !== undefined &&
    (existing.agentId !== input.agentId || existing.asOf !== input.asOf)
  ) {
    throw new Error("STANDALONE_RETENTION_JOURNAL_CONFLICT");
  }
  let journal = existing ?? await persistJournal(options.runtimeDirectory, {
    schema_version: JOURNAL_SCHEMA,
    phase: "prepared",
    ...input,
  });
  if (journal.phase === "prepared") {
    const result = await options.transitionWorkspace(input);
    assertStandalone(result);
    journal = await persistJournal(options.runtimeDirectory, {
      ...journal,
      phase: "workspace-retained",
    });
  }
  const context = await options.markContextStandalone({ asOf: journal.asOf });
  assertStandalone(context);
  await rm(journalPath(options.runtimeDirectory), { force: true });
}

function assertStandalone(result: LifecycleTransitionResult): void {
  if (result.status !== "standalone-degraded") {
    throw new Error(result.reasonCode ?? "STANDALONE_RETENTION_INCOMPLETE");
  }
}

async function readJournal(
  runtimeDirectory: string,
): Promise<LifecycleJournal | undefined> {
  try {
    const parsed: unknown = JSON.parse(
      await readFile(journalPath(runtimeDirectory), "utf8"),
    );
    if (!isJournal(parsed)) throw new Error("STANDALONE_RETENTION_JOURNAL_INVALID");
    return parsed;
  } catch (error) {
    if (isMissingFile(error)) return undefined;
    throw error;
  }
}

async function persistJournal(
  runtimeDirectory: string,
  journal: LifecycleJournal,
): Promise<LifecycleJournal> {
  await mkdir(runtimeDirectory, { recursive: true });
  const path = journalPath(runtimeDirectory);
  const temporary = `${path}.tmp`;
  await writeFile(temporary, `${JSON.stringify(journal)}\n`, { mode: 0o600 });
  await rename(temporary, path);
  return journal;
}

function journalPath(runtimeDirectory: string): string {
  return join(runtimeDirectory, JOURNAL_FILE);
}

function isJournal(value: unknown): value is LifecycleJournal {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return record.schema_version === JOURNAL_SCHEMA &&
    (record.phase === "prepared" || record.phase === "workspace-retained") &&
    typeof record.agentId === "string" &&
    typeof record.asOf === "string";
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
