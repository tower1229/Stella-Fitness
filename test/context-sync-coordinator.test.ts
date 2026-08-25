import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createFitnessContextSyncCoordinator,
  type FitnessContextSyncPublication,
  type FitnessProjectionPointerSnapshot,
} from "../src/context/sync-coordinator.js";

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("Fitness Context Sync Coordinator", () => {
  it("persists standalone degraded with the last verified tuple until re-enable", async () => {
    const runtimeDirectory = temporaryRuntimeDirectory();
    const coordinator = createFitnessContextSyncCoordinator({
      runtimeDirectory,
      publish: async () => publication("source-live", "projection-live"),
      inspectSource: async () => ({
        sourceRevision: "source-live",
        asOf: "2026-08-24T01:00:00.000Z",
      }),
      publishPointerStatus: async () => undefined,
      now: () => new Date("2026-08-25T01:00:00.000Z"),
    });
    await coordinator.resync({ trigger: "startup" });

    await expect(coordinator.markStandaloneDegraded({
      asOf: "2026-08-24T01:00:00.000Z",
    })).resolves.toMatchObject({
      status: "standalone-degraded",
      sourceRevision: "source-live",
      projectionRevision: "projection-live",
      asOf: "2026-08-24T03:00:00.000Z",
      reasonCode: "PLUGIN_UNINSTALLED",
    });
    await expect(coordinator.diagnostics()).resolves.toMatchObject({
      status: "standalone-degraded",
      source_category: "workspace",
      recovery_action: "reinstall-and-run-full-preflight",
    });
    await expect(coordinator.checkForExternalRevision()).resolves.toMatchObject({
      status: "ready",
      sourceRevision: "source-live",
    });
  });

  it("serializes bounded refreshes and preserves a successful canonical write", async () => {
    const runtimeDirectory = temporaryRuntimeDirectory();
    let attempts = 0;
    let activePublishers = 0;
    let maximumPublishers = 0;
    const publish = vi.fn(async (): Promise<FitnessContextSyncPublication> => {
      attempts += 1;
      activePublishers += 1;
      maximumPublishers = Math.max(maximumPublishers, activePublishers);
      await Promise.resolve();
      activePublishers -= 1;
      throw new Error("index unavailable");
    });
    const coordinator = createFitnessContextSyncCoordinator({
      runtimeDirectory,
      maxAttempts: 2,
      publish,
      inspectSource: async () => ({
        sourceRevision: "source-after-write",
        asOf: "2026-08-24T01:00:00.000Z",
      }),
      readPointer: async () => activePointer("source-before-write", "projection-old"),
      publishPointerStatus: async () => undefined,
      now: () => new Date("2026-08-24T01:01:00.000Z"),
    });

    const canonicalResult = { observationId: "observation-1" } as const;
    const [first, second] = await Promise.all([
      coordinator.afterCanonicalWrite(canonicalResult),
      coordinator.resync({ trigger: "explicit" }),
    ]);

    expect(first).toBe(canonicalResult);
    expect(second).toMatchObject({ status: "stale", attempts: 2 });
    expect(attempts).toBe(4);
    expect(maximumPublishers).toBe(1);
    expect(JSON.parse(readFileSync(
      join(runtimeDirectory, "context-sync", "state.json"),
      "utf8",
    ))).toEqual({
      schema_version: "stella-fitness/context-sync-state/v1",
      status: "stale",
      source_category: "fitness-canonical",
      source_revision: "source-before-write",
      projection_revision: "projection-old",
      manifest_checksum: `sha256:${"a".repeat(64)}`,
      as_of: "2026-08-24T00:00:00.000Z",
      reason_code: "PROJECTION_REFRESH_FAILED",
      recovery_action: "retry-on-startup-write-or-resync",
      attempt_count: 2,
      updated_at: "2026-08-24T01:01:00.000Z",
    });
  });

  it("blocks old context before a correction and publishes only the new desired set", async () => {
    const runtimeDirectory = temporaryRuntimeDirectory();
    let sourceRevision = "source-old";
    const events: string[] = [];
    const previous = activePointer("source-old", "projection-old");
    const coordinator = createFitnessContextSyncCoordinator({
      runtimeDirectory,
      publish: async () => {
        events.push(`publish:${sourceRevision}`);
        return publication(sourceRevision, "projection-new");
      },
      inspectSource: async () => ({
        sourceRevision,
        asOf: "2026-08-24T02:00:00.000Z",
      }),
      readPointer: async () => previous,
      async publishPointerStatus(input) {
        events.push(`pointer:${input.status}:${input.sourceRevision}`);
      },
      async restorePointer() {
        events.push("restore-old-active");
      },
      now: () => new Date("2026-08-24T02:01:00.000Z"),
    });

    const result = await coordinator.withRetraction(
      { kind: "correction" },
      async () => {
        events.push("canonical-mutation");
        sourceRevision = "source-new";
        return { observationId: "correction-1" } as const;
      },
    );

    expect(result).toEqual({ observationId: "correction-1" });
    expect(events).toEqual([
      "pointer:blocked:source-old",
      "canonical-mutation",
      "publish:source-new",
    ]);
  });

  it("recovers a crash after canonical mutation without restoring the old active pointer", async () => {
    const runtimeDirectory = temporaryRuntimeDirectory();
    let sourceRevision = "source-old";
    let pointer: FitnessProjectionPointerSnapshot | undefined = activePointer(
      "source-old",
      "projection-old",
    );
    const events: string[] = [];
    const options = {
      runtimeDirectory,
      publish: async () => {
        events.push(`publish:${sourceRevision}`);
        pointer = activePointer(sourceRevision, "projection-new");
        return publication(sourceRevision, "projection-new");
      },
      inspectSource: async () => ({
        sourceRevision,
        asOf: "2026-08-24T03:00:00.000Z",
      }),
      readPointer: async () => pointer,
      async publishPointerStatus(input: {
        readonly status: "blocked" | "revoked" | "stale";
        readonly reasonCode: string;
        readonly sourceRevision: string;
        readonly changedAt: string;
      }) {
        events.push(`pointer:${input.status}:${input.sourceRevision}`);
        pointer = input.status === "stale"
          ? {
              ...activePointer(input.sourceRevision, "projection-old"),
              status: "stale",
            }
          : { status: input.status, sourceRevision: input.sourceRevision };
      },
      async restorePointer(input: {
        readonly pointer: FitnessProjectionPointerSnapshot | undefined;
      }) {
        events.push("restore-old-active");
        pointer = input.pointer;
      },
      now: () => new Date("2026-08-24T03:01:00.000Z"),
    } as const;
    const crashed = createFitnessContextSyncCoordinator(options);

    await expect(crashed.withRetraction(
      { kind: "deletion", testHooks: { crashAfterPhase: "mutation-committed" } },
      async () => {
        events.push("canonical-mutation");
        sourceRevision = "source-new";
        return "deleted" as const;
      },
    )).rejects.toThrow("SIMULATED_CONTEXT_SYNC_CRASH:mutation-committed");

    const restarted = createFitnessContextSyncCoordinator(options);
    await expect(restarted.resync({ trigger: "explicit" })).resolves.toMatchObject({
      status: "ready",
      sourceRevision: "source-new",
      projectionRevision: "projection-new",
    });
    expect(events).toEqual([
      "pointer:blocked:source-old",
      "canonical-mutation",
      "publish:source-new",
    ]);
    expect(pointer).toEqual(activePointer("source-new", "projection-new"));
  });

  it("restores old active only when a failed mutation leaves source revision unchanged", async () => {
    const runtimeDirectory = temporaryRuntimeDirectory();
    const previous = activePointer("source-old", "projection-old");
    let pointer: FitnessProjectionPointerSnapshot | undefined = previous;
    const coordinator = createFitnessContextSyncCoordinator({
      runtimeDirectory,
      publish: async () => publication("source-old", "projection-old"),
      inspectSource: async () => ({
        sourceRevision: "source-old",
        asOf: "2026-08-24T04:00:00.000Z",
      }),
      readPointer: async () => pointer,
      async publishPointerStatus(input) {
        pointer = { status: "blocked", sourceRevision: input.sourceRevision };
      },
      async restorePointer(input) {
        pointer = input.pointer;
      },
      now: () => new Date("2026-08-24T04:01:00.000Z"),
    });

    await expect(coordinator.withRetraction(
      { kind: "correction" },
      async () => {
        throw new Error("canonical validation failed before commit");
      },
    )).rejects.toThrow("canonical validation failed before commit");

    expect(pointer).toEqual(previous);
    expect(existsSync(join(
      runtimeDirectory,
      "context-sync",
      "journal.json",
    ))).toBe(false);
  });

  it("keeps blocked when a failed mutation changed the canonical source", async () => {
    const runtimeDirectory = temporaryRuntimeDirectory();
    let sourceRevision = "source-old";
    let restored = false;
    const coordinator = createFitnessContextSyncCoordinator({
      runtimeDirectory,
      publish: async () => publication(sourceRevision, "projection-new"),
      inspectSource: async () => ({
        sourceRevision,
        asOf: "2026-08-24T05:00:00.000Z",
      }),
      readPointer: async () => activePointer("source-old", "projection-old"),
      publishPointerStatus: async () => undefined,
      async restorePointer() {
        restored = true;
      },
      now: () => new Date("2026-08-24T05:01:00.000Z"),
    });

    await expect(coordinator.withRetraction(
      { kind: "deletion" },
      async () => {
        sourceRevision = "source-partial";
        throw new Error("filesystem result unknown");
      },
    )).rejects.toThrow("filesystem result unknown");

    expect(restored).toBe(false);
    await expect(coordinator.diagnostics()).resolves.toMatchObject({
      status: "conflicted",
      reason_code: "CANONICAL_MUTATION_RESULT_UNKNOWN",
      recovery_action: "inspect-canonical-source-and-resync",
    });
  });

  it("is cancellable between bounded publication attempts", async () => {
    const runtimeDirectory = temporaryRuntimeDirectory();
    const controller = new AbortController();
    let attempts = 0;
    const coordinator = createFitnessContextSyncCoordinator({
      runtimeDirectory,
      maxAttempts: 3,
      async publish() {
        attempts += 1;
        controller.abort();
        throw new Error("cancel after first failure");
      },
      inspectSource: async () => ({
        sourceRevision: "source-current",
        asOf: "2026-08-24T06:00:00.000Z",
      }),
      publishPointerStatus: async () => undefined,
    });

    await expect(coordinator.resync({
      trigger: "explicit",
      signal: controller.signal,
    })).rejects.toMatchObject({ name: "AbortError" });
    expect(attempts).toBe(1);
  });

  it("preserves revoked while allowing an independent canonical correction", async () => {
    const runtimeDirectory = temporaryRuntimeDirectory();
    let sourceRevision = "source-old";
    const publish = vi.fn(async () => publication(sourceRevision, "projection-new"));
    const publishPointerStatus = vi.fn(async () => undefined);
    const restorePointer = vi.fn(async () => undefined);
    const coordinator = createFitnessContextSyncCoordinator({
      runtimeDirectory,
      publish,
      inspectSource: async () => ({
        sourceRevision,
        asOf: "2026-08-24T07:00:00.000Z",
      }),
      readPointer: async () => ({
        status: "revoked",
        sourceRevision: "source-old",
      }),
      publishPointerStatus,
      restorePointer,
    });

    await expect(coordinator.withRetraction(
      { kind: "correction" },
      async () => {
        sourceRevision = "source-new";
        return "corrected" as const;
      },
    )).resolves.toBe("corrected");

    expect(publish).not.toHaveBeenCalled();
    expect(publishPointerStatus).not.toHaveBeenCalled();
    expect(restorePointer).not.toHaveBeenCalled();
    await expect(coordinator.diagnostics()).resolves.toMatchObject({
      status: "degraded",
      source_revision: "source-new",
      reason_code: "PROJECTION_POINTER_REVOKED",
      recovery_action: "renew-authorization-before-resync",
    });
  });

  it("does not mask a failed canonical mutation or restore a revoked pointer", async () => {
    const runtimeDirectory = temporaryRuntimeDirectory();
    const restorePointer = vi.fn(async () => undefined);
    const coordinator = createFitnessContextSyncCoordinator({
      runtimeDirectory,
      publish: async () => publication("source-old", "projection-old"),
      inspectSource: async () => ({
        sourceRevision: "source-old",
        asOf: "2026-08-24T08:00:00.000Z",
      }),
      readPointer: async () => ({
        status: "revoked",
        sourceRevision: "source-old",
      }),
      publishPointerStatus: async () => undefined,
      restorePointer,
    });

    await expect(coordinator.withRetraction(
      { kind: "deletion" },
      async () => {
        throw new Error("canonical mutation rejected");
      },
    )).rejects.toThrow("canonical mutation rejected");
    expect(restorePointer).not.toHaveBeenCalled();
    expect(existsSync(join(
      runtimeDirectory,
      "context-sync",
      "journal.json",
    ))).toBe(false);
  });

  it("recovers a committed mutation without clearing revoked on restart", async () => {
    const runtimeDirectory = temporaryRuntimeDirectory();
    let sourceRevision = "source-old";
    const publish = vi.fn(async () => publication(sourceRevision, "projection-new"));
    const options = {
      runtimeDirectory,
      publish,
      inspectSource: async () => ({
        sourceRevision,
        asOf: "2026-08-24T09:00:00.000Z",
      }),
      readPointer: async () => ({
        status: "revoked" as const,
        sourceRevision: "source-old",
      }),
      publishPointerStatus: async () => undefined,
      restorePointer: async () => undefined,
    };
    const crashed = createFitnessContextSyncCoordinator(options);
    await expect(crashed.withRetraction(
      { kind: "retraction", testHooks: { crashAfterPhase: "mutation-committed" } },
      async () => {
        sourceRevision = "source-new";
        return "retracted";
      },
    )).rejects.toThrow("SIMULATED_CONTEXT_SYNC_CRASH:mutation-committed");

    const restarted = createFitnessContextSyncCoordinator(options);
    await expect(restarted.recover()).resolves.toMatchObject({
      status: "degraded",
      sourceRevision: "source-new",
      reasonCode: "PROJECTION_POINTER_REVOKED",
    });
    expect(publish).not.toHaveBeenCalled();
    expect(existsSync(join(
      runtimeDirectory,
      "context-sync",
      "journal.json",
    ))).toBe(false);
  });

  it.each([
    "FITNESS_PROJECTION_SOURCE_INVALID",
    "FITNESS_PROJECTION_TIMESTAMP_INVALID",
  ])("blocks external canonical error %s and reports only the last verified tuple", async (message) => {
    const runtimeDirectory = temporaryRuntimeDirectory();
    const pointer = activePointer("source-verified", "projection-verified");
    const publishPointerStatus = vi.fn(async () => undefined);
    const coordinator = createFitnessContextSyncCoordinator({
      runtimeDirectory,
      maxAttempts: 1,
      publish: async () => {
        throw new Error(message);
      },
      inspectSource: async () => {
        throw new Error(message);
      },
      readPointer: async () => pointer,
      publishPointerStatus,
    });

    await expect(coordinator.resync({ trigger: "explicit" })).resolves.toMatchObject({
      status: "conflicted",
      sourceRevision: "source-verified",
      projectionRevision: "projection-verified",
      asOf: "2026-08-24T00:00:00.000Z",
      reasonCode: "CANONICAL_SOURCE_INVALID",
    });
    expect(publishPointerStatus).toHaveBeenCalledWith(expect.objectContaining({
      status: "blocked",
      sourceRevision: "source-verified",
      reasonCode: "CANONICAL_SOURCE_INVALID",
    }));
  });

  it("refreshes when a canonical revision detector observes drift", async () => {
    const runtimeDirectory = temporaryRuntimeDirectory();
    let sourceRevision = "source-one";
    const publish = vi.fn(async () => publication(sourceRevision, "projection-current"));
    const coordinator = createFitnessContextSyncCoordinator({
      runtimeDirectory,
      publish,
      inspectSource: async () => ({
        sourceRevision,
        asOf: "2026-08-24T10:00:00.000Z",
      }),
      publishPointerStatus: async () => undefined,
    });

    await coordinator.resync({ trigger: "startup" });
    sourceRevision = "source-two";
    await expect(coordinator.checkForExternalRevision()).resolves.toMatchObject({
      status: "ready",
      sourceRevision: "source-two",
    });
    expect(publish).toHaveBeenLastCalledWith(expect.objectContaining({
      trigger: "external-revision",
    }));
  });

  it.each([
    ["prepared", "ready", false],
    ["pointer-blocked", "ready", true],
    ["mutation-started", "conflicted", false],
  ] as const)(
    "recovers the %s journal crash phase deterministically",
    async (phase, expectedStatus, expectsRestore) => {
      const runtimeDirectory = temporaryRuntimeDirectory();
      const previous = activePointer("source-old", "projection-old");
      let pointer: FitnessProjectionPointerSnapshot | undefined = previous;
      const restorePointer = vi.fn(async (input: {
        readonly pointer: FitnessProjectionPointerSnapshot | undefined;
      }) => {
        pointer = input.pointer;
      });
      const options = {
        runtimeDirectory,
        publish: async () => publication("source-old", "projection-old"),
        inspectSource: async () => ({
          sourceRevision: "source-old",
          asOf: "2026-08-24T11:00:00.000Z",
        }),
        readPointer: async () => pointer,
        async publishPointerStatus(input: { readonly sourceRevision: string }) {
          pointer = { status: "blocked", sourceRevision: input.sourceRevision };
        },
        restorePointer,
      };
      const crashed = createFitnessContextSyncCoordinator(options);
      await expect(crashed.withRetraction(
        { kind: "correction", testHooks: { crashAfterPhase: phase } },
        async () => "not-reached",
      )).rejects.toThrow(`SIMULATED_CONTEXT_SYNC_CRASH:${phase}`);

      const restarted = createFitnessContextSyncCoordinator(options);
      await expect(restarted.recover()).resolves.toMatchObject({
        status: expectedStatus,
      });
      expect(restorePointer).toHaveBeenCalledTimes(expectsRestore ? 1 : 0);
      expect(existsSync(join(
        runtimeDirectory,
        "context-sync",
        "journal.json",
      ))).toBe(expectedStatus === "conflicted");
    },
  );

  it("rejects a journal whose previous pointer is not a valid exact union", async () => {
    const runtimeDirectory = temporaryRuntimeDirectory();
    const directory = join(runtimeDirectory, "context-sync");
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, "journal.json"), JSON.stringify({
      before_as_of: "2026-08-24T00:00:00.000Z",
      before_source_revision: "source-old",
      kind: "correction",
      operation_id: "operation-1",
      phase: "pointer-blocked",
      previous_pointer: { status: "active", sourceRevision: "source-old" },
      schema_version: "stella-fitness/context-sync-journal/v1",
      started_at: "2026-08-24T00:00:00.000Z",
      updated_at: "2026-08-24T00:00:00.000Z",
    }));
    const coordinator = createFitnessContextSyncCoordinator({
      runtimeDirectory,
      publish: async () => publication("source-old", "projection-old"),
      inspectSource: async () => ({
        sourceRevision: "source-old",
        asOf: "2026-08-24T00:00:00.000Z",
      }),
      publishPointerStatus: async () => undefined,
    });

    await expect(coordinator.recover()).rejects.toThrow(
      "CONTEXT_SYNC_JOURNAL_INVALID",
    );
  });

  it("clears a pre-mutation crash journal without changing a revoked pointer", async () => {
    const runtimeDirectory = temporaryRuntimeDirectory();
    const publish = vi.fn(async () => publication("source-old", "projection-old"));
    const restorePointer = vi.fn(async () => undefined);
    const options = {
      runtimeDirectory,
      publish,
      inspectSource: async () => ({
        sourceRevision: "source-old",
        asOf: "2026-08-24T12:00:00.000Z",
      }),
      readPointer: async () => ({
        status: "revoked" as const,
        sourceRevision: "source-old",
      }),
      publishPointerStatus: async () => undefined,
      restorePointer,
    };
    const crashed = createFitnessContextSyncCoordinator(options);
    await expect(crashed.withRetraction(
      { kind: "deletion", testHooks: { crashAfterPhase: "pointer-blocked" } },
      async () => "not-reached",
    )).rejects.toThrow("SIMULATED_CONTEXT_SYNC_CRASH:pointer-blocked");

    const restarted = createFitnessContextSyncCoordinator(options);
    await expect(restarted.recover()).resolves.toMatchObject({
      status: "degraded",
      reasonCode: "PROJECTION_POINTER_REVOKED",
    });
    expect(publish).not.toHaveBeenCalled();
    expect(restorePointer).not.toHaveBeenCalled();
    expect(existsSync(join(directoryFor(runtimeDirectory), "journal.json"))).toBe(false);
  });
});

function temporaryRuntimeDirectory(): string {
  const root = mkdtempSync(join(tmpdir(), "stella-context-sync-"));
  temporaryRoots.push(root);
  return root;
}

function directoryFor(runtimeDirectory: string): string {
  return join(runtimeDirectory, "context-sync");
}

function activePointer(
  sourceRevision: string,
  projectionRevision: string,
): Extract<FitnessProjectionPointerSnapshot, { readonly status: "active" | "stale" }> {
  return {
    status: "active",
    sourceRevision,
    projectionRevision,
    manifestChecksum: `sha256:${"a".repeat(64)}`,
    asOf: "2026-08-24T00:00:00.000Z",
  };
}

function publication(
  sourceRevision: string,
  projectionRevision: string,
): FitnessContextSyncPublication {
  return {
    sourceRevision,
    projectionRevision,
    manifestChecksum: `sha256:${"b".repeat(64)}`,
    asOf: "2026-08-24T03:00:00.000Z",
  };
}
