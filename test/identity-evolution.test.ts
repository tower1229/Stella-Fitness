import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  classifyFitnessIdentityContextDiff,
  createFitnessIdentityEvolutionCoordinator,
  type FitnessIdentityPublicationCandidate,
  type FitnessIdentitySnapshot,
} from "../src/context/identity-evolution.js";

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

  it("restores the last verified identity when a recovery candidate has drifted", async () => {
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
    const drifted = candidate({
      sourceRevision: "authority-44",
      projectionRevision: "projection-44",
      manifestChecksum: `sha256:${"c".repeat(64)}`,
    });
    const restarted = createFitnessIdentityEvolutionCoordinator({ runtimeDirectory, publish });

    await expect(restarted.recover(drifted)).resolves.toMatchObject({
      status: "conflicted",
      reasonCode: "IDENTITY_RECOVERY_CANDIDATE_DRIFT",
      active: { sourceRevision: "authority-42" },
    });
    expect(publish).toHaveBeenLastCalledWith(active);
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
