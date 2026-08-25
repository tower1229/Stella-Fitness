import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  classifyFitnessIdentityContextDiff,
  createFitnessIdentityEvolutionCoordinator,
  type FitnessIdentityPublicationCandidate,
  type FitnessIdentitySnapshot,
} from "../src/context/identity-evolution.js";
import { canonicalizeJcs } from "../src/context/runtime-contract.js";

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("Fitness Identity Evolution", () => {
  it("classifies semantic field changes without collapsing retractions or conflicts", () => {
    const active = snapshot();

    expect(classifyFitnessIdentityContextDiff(active, snapshot({
      fields: { ...active.fields, "agent-name": field("Nova", "identity-source") },
    }))).toMatchObject({ kind: "material", changedFieldIds: ["agent-name"] });
    expect(classifyFitnessIdentityContextDiff(active, snapshot({
      fields: {
        ...active.fields,
        "stable-values": field("诚实、尊重边界", "identity-source"),
      },
    }))).toMatchObject({ kind: "material", changedFieldIds: ["stable-values"] });
    expect(classifyFitnessIdentityContextDiff(active, snapshot({
      fields: {
        ...active.fields,
        "communication-preferences": field("先给结论", "user-source"),
      },
    }))).toMatchObject({
      kind: "minor",
      changedFieldIds: ["communication-preferences"],
    });
    expect(classifyFitnessIdentityContextDiff(active, snapshot({
      fields: {
        "agent-name": active.fields["agent-name"]!,
        "persona-core": active.fields["persona-core"]!,
      },
      retractions: [{
        id: "retraction-user",
        sourceReferenceId: "user-source",
        retractedRevision: "authority-41",
      }],
    }))).toMatchObject({
      kind: "retraction",
      changedFieldIds: ["communication-preferences"],
    });
    expect(classifyFitnessIdentityContextDiff(active, snapshot({
      conflicts: [{
        id: "identity-conflict",
        sourceReferenceIds: ["identity-source", "identity-source-2"],
        summary: "identity sources disagree",
      }],
    }))).toMatchObject({ kind: "conflict", conflictIds: ["identity-conflict"] });
  });

  it("keeps the last verified identity until an exact material update is accepted", async () => {
    const runtimeDirectory = temporaryRuntimeDirectory();
    const publish = vi.fn(async () => ({ status: "ready" as const }));
    const coordinator = createFitnessIdentityEvolutionCoordinator({
      runtimeDirectory,
      publish,
      now: () => new Date("2026-08-25T01:00:00.000Z"),
    });
    const active = candidate();
    await coordinator.recordPublished(active);
    const changed = candidate({
      sourceRevision: "authority-43",
      projectionRevision: "projection-43",
      manifestChecksum: `sha256:${"b".repeat(64)}`,
      fields: { ...active.fields, "agent-name": field("Nova", "identity-source") },
    });

    await expect(coordinator.reconcile(changed)).resolves.toMatchObject({
      status: "pending",
      active: { sourceRevision: "authority-42" },
      pending: {
        baseSourceRevision: "authority-42",
        baseManifestChecksum: `sha256:${"a".repeat(64)}`,
        candidateSourceRevision: "authority-43",
        candidateManifestChecksum: `sha256:${"b".repeat(64)}`,
        changedFieldIds: ["agent-name"],
      },
    });
    expect(publish).not.toHaveBeenCalled();

    await expect(coordinator.decide({
      decision: "accept",
      currentCandidate: changed,
    })).resolves.toMatchObject({
      status: "ready",
      active: { sourceRevision: "authority-43" },
    });
    expect(publish).toHaveBeenCalledOnce();
    expect(publish).toHaveBeenCalledWith(changed);
  });

  it("persists defer and reject decisions idempotently and invalidates pointer drift", async () => {
    const runtimeDirectory = temporaryRuntimeDirectory();
    const publish = vi.fn(async () => ({ status: "ready" as const }));
    const coordinator = createFitnessIdentityEvolutionCoordinator({ runtimeDirectory, publish });
    const active = candidate();
    const changed = candidate({
      sourceRevision: "authority-43",
      projectionRevision: "projection-43",
      manifestChecksum: `sha256:${"b".repeat(64)}`,
      fields: { ...active.fields, "persona-core": field("新的核心人格", "identity-source") },
    });
    await coordinator.recordPublished(active);
    await coordinator.reconcile(changed);

    await expect(coordinator.decide({
      decision: "defer",
      currentCandidate: changed,
    })).resolves.toMatchObject({ status: "pending", pending: { decision: "deferred" } });
    const restarted = createFitnessIdentityEvolutionCoordinator({ runtimeDirectory, publish });
    await expect(restarted.diagnostics()).resolves.toMatchObject({
      status: "pending",
      pending: { decision: "deferred" },
    });
    await expect(restarted.decide({
      decision: "reject",
      currentCandidate: changed,
    })).resolves.toMatchObject({ status: "ready", active: { sourceRevision: "authority-42" } });
    await expect(restarted.reconcile(changed)).resolves.toMatchObject({
      status: "ready",
      active: { sourceRevision: "authority-42" },
    });
    await expect(restarted.decide({
      decision: "reject",
      currentCandidate: changed,
    })).resolves.toMatchObject({
      status: "ready",
      active: { sourceRevision: "authority-42" },
    });
    expect(publish).not.toHaveBeenCalled();

    const next = candidate({
      sourceRevision: "authority-44",
      projectionRevision: "projection-44",
      manifestChecksum: `sha256:${"c".repeat(64)}`,
      fields: { ...active.fields, "agent-name": field("Astra", "identity-source") },
    });
    await restarted.reconcile(next);
    const drifted = candidate({
      ...next,
      sourceRevision: "authority-45",
      projectionRevision: "projection-45",
      manifestChecksum: `sha256:${"d".repeat(64)}`,
    });
    await expect(restarted.decide({
      decision: "accept",
      currentCandidate: drifted,
    })).resolves.toMatchObject({
      status: "conflicted",
      reasonCode: "IDENTITY_CONFIRMATION_INVALIDATED",
      active: { sourceRevision: "authority-42" },
    });
    expect(publish).not.toHaveBeenCalled();
  });

  it("never lets an optional retraction hide a material identity change", () => {
    const active = snapshot();
    expect(classifyFitnessIdentityContextDiff(active, snapshot({
      fields: {
        "agent-name": field("Nova", "identity-source"),
        "persona-core": active.fields["persona-core"]!,
      },
      retractions: [{
        id: "retraction-user",
        sourceReferenceId: "user-source",
        retractedRevision: "authority-41",
      }],
    }))).toMatchObject({
      kind: "material",
      changedFieldIds: ["agent-name", "communication-preferences"],
    });
  });

  it("auto-publishes verified minor and retraction changes but retains active on degraded input", async () => {
    const runtimeDirectory = temporaryRuntimeDirectory();
    const publish = vi.fn(async () => ({ status: "ready" as const }));
    const coordinator = createFitnessIdentityEvolutionCoordinator({ runtimeDirectory, publish });
    const active = candidate();
    await coordinator.recordPublished(active);
    const minor = candidate({
      sourceRevision: "authority-43",
      projectionRevision: "projection-43",
      manifestChecksum: `sha256:${"b".repeat(64)}`,
      fields: {
        ...active.fields,
        "communication-preferences": field("先给结论", "user-source"),
      },
    });
    await expect(coordinator.reconcile(minor)).resolves.toMatchObject({
      status: "ready",
      active: { sourceRevision: "authority-43" },
    });
    const retracted = candidate({
      ...minor,
      sourceRevision: "authority-44",
      projectionRevision: "projection-44",
      manifestChecksum: `sha256:${"c".repeat(64)}`,
      fields: {
        "agent-name": minor.fields["agent-name"]!,
        "persona-core": minor.fields["persona-core"]!,
      },
      retractions: [{
        id: "retraction-user",
        sourceReferenceId: "user-source",
        retractedRevision: "authority-43",
      }],
    });
    await expect(coordinator.reconcile(retracted)).resolves.toMatchObject({
      status: "ready",
      active: { sourceRevision: "authority-44" },
    });
    expect(publish).toHaveBeenCalledTimes(2);

    await expect(coordinator.retainLastVerified({
      status: "degraded",
      reasonCode: "IDENTITY_CONTEXT_UNAVAILABLE",
    })).resolves.toMatchObject({
      status: "degraded",
      reasonCode: "IDENTITY_CONTEXT_UNAVAILABLE",
      active: { sourceRevision: "authority-44", asOf: "2026-08-25T00:00:00.000Z" },
    });
  });

  it("recovers a crash after workspace publication without losing the exact candidate", async () => {
    const runtimeDirectory = temporaryRuntimeDirectory();
    const publish = vi.fn(async () => ({ status: "ready" as const }));
    const coordinator = createFitnessIdentityEvolutionCoordinator({ runtimeDirectory, publish });
    const active = candidate();
    await coordinator.recordPublished(active);
    const minor = candidate({
      sourceRevision: "authority-43",
      projectionRevision: "projection-43",
      manifestChecksum: `sha256:${"b".repeat(64)}`,
      fields: { ...active.fields, "preferred-appellation": field("涛哥", "user-source") },
    });

    await expect(coordinator.reconcile(minor, {
      testHooks: { crashAfterPublication: true },
    })).rejects.toThrow("SIMULATED_IDENTITY_EVOLUTION_CRASH:published");
    const restarted = createFitnessIdentityEvolutionCoordinator({ runtimeDirectory, publish });
    await expect(restarted.recover(minor)).resolves.toMatchObject({
      status: "ready",
      active: { sourceRevision: "authority-43" },
    });
    expect(publish).toHaveBeenCalledTimes(2);
    expect(publish).toHaveBeenLastCalledWith(minor);
  });

  it("persists only identity metadata and never trusts a stored publication payload", async () => {
    const runtimeDirectory = temporaryRuntimeDirectory();
    const publish = vi.fn(async () => ({ status: "ready" as const }));
    const coordinator = createFitnessIdentityEvolutionCoordinator({
      runtimeDirectory,
      publish,
      captureRecoveryToken: async () => "workspace-revision-42",
      restore: vi.fn(async () => ({ status: "ready" as const })),
    });
    const active = candidate({
      fields: {
        ...candidate().fields,
        "preferred-appellation": field("私密称呼", "user-source"),
      },
      artifacts: [{ path: "USER.md", managedContent: "绝不应进入运行状态的私密背景\n" }],
    });
    await coordinator.recordPublished(active);

    const statePath = join(runtimeDirectory, "identity-evolution", "state.json");
    const stateBytes = readFileSync(statePath, "utf8");
    expect(stateBytes).not.toContain("私密称呼");
    expect(stateBytes).not.toContain("绝不应进入运行状态的私密背景");
    expect(stateBytes).not.toContain("managedContent");

    const minor = candidate({
      sourceRevision: "authority-43",
      projectionRevision: "projection-43",
      manifestChecksum: `sha256:${"b".repeat(64)}`,
      fields: { ...active.fields, "preferred-language": field("zh-CN", "user-source") },
    });
    await expect(coordinator.reconcile(minor, {
      testHooks: { crashAfterPublication: true },
    })).rejects.toThrow("SIMULATED_IDENTITY_EVOLUTION_CRASH:published");
    const journalBytes = readFileSync(
      join(runtimeDirectory, "identity-evolution", "journal.json"),
      "utf8",
    );
    expect(journalBytes).not.toContain("zh-CN");
    expect(journalBytes).not.toContain("managedContent");
  });

  it("rejects malformed nested evolution state instead of hydrating it", async () => {
    const runtimeDirectory = temporaryRuntimeDirectory();
    const coordinator = createFitnessIdentityEvolutionCoordinator({
      runtimeDirectory,
      publish: vi.fn(async () => ({ status: "ready" as const })),
    });
    await coordinator.recordPublished(candidate());
    const statePath = join(runtimeDirectory, "identity-evolution", "state.json");
    const state = JSON.parse(readFileSync(statePath, "utf8")) as Record<string, unknown>;
    writeFileSync(statePath, JSON.stringify({
      ...state,
      active: { sourceRevision: "authority-42" },
    }));

    await expect(coordinator.diagnostics()).rejects.toThrow(
      "IDENTITY_EVOLUTION_STATE_INVALID",
    );
  });

  it("rejects a canonical but contradictory persisted status", async () => {
    const runtimeDirectory = temporaryRuntimeDirectory();
    const coordinator = createFitnessIdentityEvolutionCoordinator({
      runtimeDirectory,
      publish: vi.fn(async () => ({ status: "ready" as const })),
    });
    await coordinator.recordPublished(candidate());
    const statePath = join(runtimeDirectory, "identity-evolution", "state.json");
    const state = JSON.parse(readFileSync(statePath, "utf8")) as Record<string, unknown>;
    writeFileSync(statePath, canonicalizeJcs({ ...state, status: "pending" }));

    await expect(coordinator.diagnostics()).rejects.toThrow(
      "IDENTITY_EVOLUTION_STATE_INVALID",
    );
  });

  it("refuses to persist contradictory retained conflict state", async () => {
    const runtimeDirectory = temporaryRuntimeDirectory();
    const coordinator = createFitnessIdentityEvolutionCoordinator({
      runtimeDirectory,
      publish: vi.fn(async () => ({ status: "ready" as const })),
    });
    await coordinator.recordPublished(candidate());

    await expect(coordinator.retainLastVerified({
      status: "degraded",
      reasonCode: "IDENTITY_CONTEXT_UNAVAILABLE",
      conflicts: [{
        id: "unexpected-conflict",
        sourceReferenceIds: ["source-a", "source-b"],
      }],
    } as unknown as Parameters<typeof coordinator.retainLastVerified>[0]))
      .rejects.toThrow("IDENTITY_EVOLUTION_STATE_INVALID");
    await expect(coordinator.diagnostics()).resolves.toMatchObject({
      status: "ready",
    });
  });

  it("invalidates a pending decision when the active workspace base drifts", async () => {
    const runtimeDirectory = temporaryRuntimeDirectory();
    let recoveryToken = "workspace-revision-42";
    const publish = vi.fn(async () => ({ status: "ready" as const }));
    const coordinator = createFitnessIdentityEvolutionCoordinator({
      runtimeDirectory,
      publish,
      captureRecoveryToken: async () => recoveryToken,
    });
    const active = candidate();
    const changed = candidate({
      sourceRevision: "authority-43",
      projectionRevision: "projection-43",
      manifestChecksum: `sha256:${"b".repeat(64)}`,
      fields: { ...active.fields, "agent-name": field("Nova", "identity-source") },
    });
    await coordinator.recordPublished(active);
    await coordinator.reconcile(changed);
    recoveryToken = "workspace-revision-99";

    await expect(coordinator.decide({
      decision: "accept",
      currentCandidate: changed,
    })).resolves.toMatchObject({
      status: "conflicted",
      reasonCode: "IDENTITY_CONFIRMATION_INVALIDATED",
      active: { sourceRevision: "authority-42" },
    });
    expect(publish).not.toHaveBeenCalled();
  });

  it("persists disclosure claims across coordinator restarts", async () => {
    const runtimeDirectory = temporaryRuntimeDirectory();
    const options = {
      runtimeDirectory,
      publish: vi.fn(async () => ({ status: "ready" as const })),
    } as const;
    const coordinator = createFitnessIdentityEvolutionCoordinator(options);
    await coordinator.recordPublished(candidate());

    await expect(coordinator.claimDisclosure("pending:update-42")).resolves.toBe("first");
    const restarted = createFitnessIdentityEvolutionCoordinator(options);
    await expect(restarted.claimDisclosure("pending:update-42")).resolves
      .toBe("unchanged");
    await expect(restarted.claimDisclosure("degraded:source-loss")).resolves
      .toBe("changed");
  });

  it("restores the last verified identity when a recovery candidate has drifted", async () => {
    const runtimeDirectory = temporaryRuntimeDirectory();
    const publish = vi.fn(async () => ({ status: "ready" as const }));
    const restore = vi.fn(async () => ({ status: "ready" as const }));
    const options = {
      runtimeDirectory,
      publish,
      captureRecoveryToken: async () => "workspace-revision-42",
      restore,
    } as const;
    const coordinator = createFitnessIdentityEvolutionCoordinator(options);
    const active = candidate();
    await coordinator.recordPublished(active);
    const minor = candidate({
      sourceRevision: "authority-43",
      projectionRevision: "projection-43",
      manifestChecksum: `sha256:${"b".repeat(64)}`,
      fields: { ...active.fields, "preferred-appellation": field("涛哥", "user-source") },
    });
    await expect(coordinator.reconcile(minor, {
      testHooks: { crashAfterPublication: true },
    })).rejects.toThrow("SIMULATED_IDENTITY_EVOLUTION_CRASH:published");
    const drifted = candidate({
      sourceRevision: "authority-44",
      projectionRevision: "projection-44",
      manifestChecksum: `sha256:${"c".repeat(64)}`,
    });
    const restarted = createFitnessIdentityEvolutionCoordinator(options);

    await expect(restarted.recover(drifted)).resolves.toMatchObject({
      status: "conflicted",
      reasonCode: "IDENTITY_RECOVERY_CANDIDATE_DRIFT",
      active: { sourceRevision: "authority-42" },
    });
    expect(restore).toHaveBeenCalledWith("workspace-revision-42");
    expect(publish).toHaveBeenCalledOnce();
  });
});

function snapshot(
  overrides: Partial<FitnessIdentitySnapshot> = {},
): FitnessIdentitySnapshot {
  return {
    sourceRevision: "authority-42",
    projectionRevision: "projection-42",
    manifestChecksum: `sha256:${"a".repeat(64)}`,
    asOf: "2026-08-25T00:00:00.000Z",
    freshness: "active",
    fields: {
      "agent-name": field("Stella", "identity-source"),
      "persona-core": field("温和、直接", "identity-source"),
      "communication-preferences": field("直接", "user-source"),
    },
    conflicts: [],
    retractions: [],
    ...overrides,
  };
}

function candidate(
  overrides: Partial<FitnessIdentityPublicationCandidate> = {},
): FitnessIdentityPublicationCandidate {
  return {
    ...snapshot(),
    artifacts: [{ path: "IDENTITY.md", managedContent: "Stella\n" }],
    disclosure: "identity disclosure",
    contextCompleteness: "complete",
    ...overrides,
  };
}

function temporaryRuntimeDirectory(): string {
  const root = mkdtempSync(join(tmpdir(), "stella-identity-evolution-"));
  temporaryRoots.push(root);
  return root;
}

function field(content: string, sourceReferenceId: string) {
  return { content, sourceReferenceIds: [sourceReferenceId] } as const;
}
