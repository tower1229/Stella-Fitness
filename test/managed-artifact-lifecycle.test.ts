import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createManagedArtifactLifecycleTransaction } from
  "../src/agent-workspace/lifecycle.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("managed artifact lifecycle transaction", () => {
  it("resumes after the workspace switch when the context state write fails", async () => {
    const runtimeDirectory = mkdtempSync(join(tmpdir(), "fitness-lifecycle-"));
    roots.push(runtimeDirectory);
    const transitionWorkspace = vi.fn(async () => ({
      status: "standalone-degraded" as const,
    }));
    const markContextStandalone = vi.fn()
      .mockRejectedValueOnce(new Error("simulated state write failure"))
      .mockResolvedValueOnce({ status: "standalone-degraded" as const });
    const transaction = createManagedArtifactLifecycleTransaction({
      runtimeDirectory,
      transitionWorkspace,
      markContextStandalone,
    });
    const input = {
      agentId: "fitness",
      asOf: "2026-08-24T01:00:00.000Z",
    } as const;

    await expect(transaction.retain(input)).rejects.toThrow(
      "simulated state write failure",
    );
    expect(readFileSync(
      join(runtimeDirectory, "managed-artifact-lifecycle-journal.json"),
      "utf8",
    )).toContain('"phase":"workspace-retained"');

    await expect(transaction.recover()).resolves.toBe(true);
    expect(transitionWorkspace).toHaveBeenCalledTimes(1);
    expect(markContextStandalone).toHaveBeenCalledTimes(2);
    expect(existsSync(
      join(runtimeDirectory, "managed-artifact-lifecycle-journal.json"),
    )).toBe(false);
  });

  it("reports that startup recovery has no pending transaction", async () => {
    const runtimeDirectory = mkdtempSync(join(tmpdir(), "fitness-lifecycle-"));
    roots.push(runtimeDirectory);
    const transaction = createManagedArtifactLifecycleTransaction({
      runtimeDirectory,
      transitionWorkspace: vi.fn(),
      markContextStandalone: vi.fn(),
    });

    await expect(transaction.recover()).resolves.toBe(false);
  });

  it("retains the journal and rejects an incomplete workspace transition", async () => {
    const runtimeDirectory = mkdtempSync(join(tmpdir(), "fitness-lifecycle-"));
    roots.push(runtimeDirectory);
    const transaction = createManagedArtifactLifecycleTransaction({
      runtimeDirectory,
      transitionWorkspace: async () => ({
        status: "conflicted",
        reasonCode: "MANAGED_ARTIFACT_TAMPERED",
      }),
      markContextStandalone: vi.fn(),
    });

    await expect(transaction.retain({
      agentId: "fitness",
      asOf: "2026-08-24T01:00:00.000Z",
    })).rejects.toThrow("MANAGED_ARTIFACT_TAMPERED");
    expect(existsSync(
      join(runtimeDirectory, "managed-artifact-lifecycle-journal.json"),
    )).toBe(true);
  });
});
