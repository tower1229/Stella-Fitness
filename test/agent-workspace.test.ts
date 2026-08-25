import { readFileSync } from "node:fs";
import {
  cp,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createFitnessAgentWorkspaceManager,
  type FitnessAgentWorkspaceHost,
} from "../src/agent-workspace/manager.js";
import { createManagedArtifactToolPolicy } from "../src/agent-workspace/policy.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(
    temporaryRoots.splice(0).map((root) =>
      rm(root, { recursive: true, force: true })
    ),
  );
});

describe("Fitness Agent workspace manager", () => {
  it("does not create a blank Agent before validated identity projections exist", async () => {
    const fixture = await workspaceFixture();
    fixture.host.prepareWorkspace = async (workspace) => {
      fixture.calls.push(`prepare:${workspace}`);
      await mkdir(workspace, { recursive: true });
    };
    const manager = createFitnessAgentWorkspaceManager({
      runtimeDirectory: fixture.runtimeDirectory,
      host: fixture.host,
    });

    await expect(manager.initialize({
      agentId: "fitness",
      artifacts: [{ path: "AGENTS.md", managedContent: "recording-only\n" }],
    })).resolves.toEqual({
      status: "blocked",
      agentId: "fitness",
      reasonCode: "IDENTITY_CORE_REQUIRED",
    });
    expect(fixture.calls).toEqual([
      "preflight",
      expect.stringMatching(/^prepare:/u),
    ]);
    expect(fixture.activeAgents).toEqual(new Map());
  });

  it("creates through the production artifact set after Host bootstrap validation", async () => {
    const fixture = await workspaceFixture();
    const manager = createFitnessAgentWorkspaceManager({
      runtimeDirectory: fixture.runtimeDirectory,
      host: fixture.host,
    });

    const result = await manager.initialize({
      agentId: "fitness",
      artifacts: [{ path: "AGENTS.md", managedContent: "recording-only\n" }],
    });

    expect(result).toMatchObject({ status: "ready", created: true });
    expect(await readFile(join(result.workspace!, "IDENTITY.md"), "utf8"))
      .toBe("Host bootstrap identity\n");
    expect(await readFile(join(result.workspace!, "SOUL.md"), "utf8"))
      .toBe("Host bootstrap soul\n");
    expect(JSON.parse(await readFile(
      join(result.workspace!, ".stella-fitness-ownership.json"),
      "utf8",
    ))).toMatchObject({ artifacts: [{ path: "AGENTS.md" }] });
  });

  it("creates and activates a complete managed workspace only after capability preflight", async () => {
    const fixture = await workspaceFixture();
    const manager = createFitnessAgentWorkspaceManager({
      runtimeDirectory: fixture.runtimeDirectory,
      host: fixture.host,
    });

    const result = await manager.initialize({
      agentId: "fitness",
      artifacts: managedArtifacts("Fitness stays recording-only.\n"),
    });

    expect(result).toMatchObject({
      status: "ready",
      agentId: "fitness",
      created: true,
      ownershipRevision: 1,
    });
    expect(fixture.calls).toEqual([
      "preflight",
      expect.stringMatching(/^prepare:/u),
      expect.stringMatching(/^activate:fitness:/u),
    ]);
    expect(fixture.activeAgents.get("fitness")).toBe(result.workspace);
    expect(readFileSync(join(result.workspace!, "AGENTS.md"), "utf8"))
      .toContain("Fitness stays recording-only.");
    expect(readFileSync(join(result.workspace!, "IDENTITY.md"), "utf8"))
      .toContain("Stella Fitness identity projection");
    expect(readFileSync(join(result.workspace!, "SOUL.md"), "utf8"))
      .toContain("Stella Fitness persona projection");
    expect(JSON.parse(
      await readFile(
        join(result.workspace!, ".stella-fitness-ownership.json"),
        "utf8",
      ),
    )).toMatchObject({
      schemaVersion: "stella-fitness/workspace-ownership/v1",
      agentId: "fitness",
      ownershipRevision: 1,
      artifacts: expect.arrayContaining([
        { path: "IDENTITY.md", checksum: expect.any(String) },
        { path: "SOUL.md", checksum: expect.any(String) },
        { path: "AGENTS.md", checksum: expect.any(String) },
      ]),
    });
  });

  it("adopts an existing workspace by preserving user content in a complete candidate", async () => {
    const fixture = await workspaceFixture();
    const existingWorkspace = join(fixture.root, "workspace-fitness");
    await mkdir(existingWorkspace);
    await writeFile(
      join(existingWorkspace, "AGENTS.md"),
      "# My private fitness notes\nNever remove this.\n",
    );
    await writeFile(join(existingWorkspace, "MEMORY.md"), "user memory\n");
    await writeFile(join(existingWorkspace, "IDENTITY.md"), "existing identity\n");
    await writeFile(join(existingWorkspace, "SOUL.md"), "existing soul\n");
    fixture.activeAgents.set("fitness", existingWorkspace);
    const manager = createFitnessAgentWorkspaceManager({
      runtimeDirectory: fixture.runtimeDirectory,
      host: fixture.host,
    });
    const input = {
      agentId: "fitness",
      artifacts: managedArtifacts("Fitness stays recording-only.\n"),
    } as const;

    await expect(manager.initialize(input)).resolves.toMatchObject({
      status: "adoption-required",
      reasonCode: "OWNERSHIP_MANIFEST_REQUIRED",
    });
    const adopted = await manager.adopt({ ...input, choice: "merge" });

    expect(adopted).toMatchObject({
      status: "ready",
      agentId: "fitness",
      created: false,
      adopted: true,
    });
    expect(adopted.workspace).not.toBe(existingWorkspace);
    expect(await readFile(join(existingWorkspace, "AGENTS.md"), "utf8"))
      .toBe("# My private fitness notes\nNever remove this.\n");
    expect(await readFile(join(adopted.workspace!, "AGENTS.md"), "utf8"))
      .toContain("# My private fitness notes\nNever remove this.");
    expect(await readFile(join(adopted.workspace!, "MEMORY.md"), "utf8"))
      .toBe("user memory\n");
  });

  it("records skip without changing an unmanaged workspace", async () => {
    const fixture = await workspaceFixture();
    const existingWorkspace = join(fixture.root, "workspace-fitness");
    await mkdir(existingWorkspace);
    await writeFile(join(existingWorkspace, "IDENTITY.md"), "my identity\n");
    await writeFile(join(existingWorkspace, "SOUL.md"), "my soul\n");
    fixture.activeAgents.set("fitness", existingWorkspace);
    const manager = createFitnessAgentWorkspaceManager({
      runtimeDirectory: fixture.runtimeDirectory,
      host: fixture.host,
    });

    await expect(manager.adopt({
      agentId: "fitness",
      artifacts: [],
      choice: "skip",
    })).resolves.toMatchObject({
      status: "adoption-required",
      reasonCode: "ADOPTION_SKIPPED",
      skipped: true,
    });
    expect(fixture.activeAgents.get("fitness")).toBe(existingWorkspace);
    expect(await readFile(join(existingWorkspace, "SOUL.md"), "utf8"))
      .toBe("my soul\n");
    expect(JSON.parse(await readFile(
      join(fixture.runtimeDirectory, "workspace-adoptions", "fitness.json"),
      "utf8",
    ))).toMatchObject({ agentId: "fitness", choice: "skip" });
    const restartedManager = createFitnessAgentWorkspaceManager({
      runtimeDirectory: fixture.runtimeDirectory,
      host: fixture.host,
    });
    await expect(restartedManager.adoptionRecord("fitness")).resolves
      .toMatchObject({
        agentId: "fitness",
        choice: "skip",
        result: { skipped: true, reasonCode: "ADOPTION_SKIPPED" },
      });
    await expect(restartedManager.adopt({
      agentId: "fitness",
      artifacts: [{ path: "AGENTS.md", managedContent: "recording-only\n" }],
      choice: "merge",
    })).resolves.toMatchObject({ status: "ready", adopted: true });
  });

  it("adopts under an alternate Agent ID without changing the existing Agent", async () => {
    const fixture = await workspaceFixture();
    const existingWorkspace = join(fixture.root, "workspace-fitness");
    await mkdir(existingWorkspace);
    await writeFile(join(existingWorkspace, "IDENTITY.md"), "existing identity\n");
    fixture.activeAgents.set("fitness", existingWorkspace);
    const manager = createFitnessAgentWorkspaceManager({
      runtimeDirectory: fixture.runtimeDirectory,
      host: fixture.host,
    });

    const adoption = {
      agentId: "fitness",
      artifacts: managedArtifacts("recording-only\n"),
      choice: { alternateAgentId: "fitness-private" },
    } as const;
    const result = await manager.adopt(adoption);

    expect(result).toMatchObject({
      status: "ready",
      agentId: "fitness-private",
      created: true,
    });
    expect(fixture.activeAgents.get("fitness")).toBe(existingWorkspace);
    expect(fixture.activeAgents.get("fitness-private")).toBe(result.workspace);
    expect(await readFile(join(existingWorkspace, "IDENTITY.md"), "utf8"))
      .toBe("existing identity\n");
    await expect(manager.adopt(adoption)).resolves.toEqual(result);
    await expect(manager.adoptionRecord("fitness")).resolves.toMatchObject({
      choice: { alternateAgentId: "fitness-private" },
      result: { status: "ready", agentId: "fitness-private" },
    });
  });

  it("syncs managed content while preserving a manually edited user section", async () => {
    const fixture = await workspaceFixture();
    const manager = createFitnessAgentWorkspaceManager({
      runtimeDirectory: fixture.runtimeDirectory,
      host: fixture.host,
    });
    const created = await manager.initialize({
      agentId: "fitness",
      artifacts: managedArtifacts("revision one\n"),
    });
    const agentsPath = join(created.workspace!, "AGENTS.md");
    const original = await readFile(agentsPath, "utf8");
    await writeFile(
      agentsPath,
      original.replace(
        "<!-- stella-fitness:user:start -->\n",
        "<!-- stella-fitness:user:start -->\nMy own durable instructions.\n",
      ),
    );

    const synced = await manager.sync({
      agentId: "fitness",
      artifacts: managedArtifacts("revision two\n"),
    });

    expect(synced).toMatchObject({
      status: "ready",
      ownershipRevision: 2,
      created: false,
    });
    expect(synced.workspace).not.toBe(created.workspace);
    const current = await readFile(join(synced.workspace!, "AGENTS.md"), "utf8");
    expect(current).toContain("revision two");
    expect(current).toContain("My own durable instructions.");
    expect(await readFile(agentsPath, "utf8")).toContain("revision one");
  });

  it("restores only the exact previously verified managed workspace", async () => {
    const fixture = await workspaceFixture();
    const manager = createFitnessAgentWorkspaceManager({
      runtimeDirectory: fixture.runtimeDirectory,
      host: fixture.host,
    });
    const created = await manager.initialize({
      agentId: "fitness",
      artifacts: managedArtifacts("revision one\n"),
    });
    const recoveryToken = await manager.captureRecoveryToken("fitness");
    expect(recoveryToken).toBeDefined();
    const synced = await manager.sync({
      agentId: "fitness",
      artifacts: managedArtifacts("revision two\n"),
    });
    expect(fixture.activeAgents.get("fitness")).toBe(synced.workspace);

    await expect(manager.restoreRecoveryToken(recoveryToken!)).resolves.toMatchObject({
      status: "ready",
      workspace: created.workspace,
      ownershipRevision: 1,
    });
    expect(fixture.activeAgents.get("fitness")).toBe(created.workspace);

    const forged = JSON.stringify({
      ...JSON.parse(recoveryToken!),
      ownershipRevision: 2,
    });
    await expect(manager.restoreRecoveryToken(forged)).resolves.toMatchObject({
      status: "conflicted",
      reasonCode: "RECOVERY_WORKSPACE_INVALID",
    });
    expect(fixture.activeAgents.get("fitness")).toBe(created.workspace);

    const unrelatedWorkspace = join(fixture.root, "unrelated-valid-workspace");
    await cp(created.workspace!, unrelatedWorkspace, { recursive: true });
    const unrelated = JSON.stringify({
      ...JSON.parse(recoveryToken!),
      workspace: unrelatedWorkspace,
    });
    await expect(manager.restoreRecoveryToken(unrelated)).resolves.toMatchObject({
      status: "conflicted",
      reasonCode: "RECOVERY_WORKSPACE_INVALID",
    });
    expect(fixture.activeAgents.get("fitness")).toBe(created.workspace);
  });

  it("stops publication when managed content was manually changed", async () => {
    const fixture = await workspaceFixture();
    const manager = createFitnessAgentWorkspaceManager({
      runtimeDirectory: fixture.runtimeDirectory,
      host: fixture.host,
    });
    const created = await manager.initialize({
      agentId: "fitness",
      artifacts: managedArtifacts("owned value\n"),
    });
    const path = join(created.workspace!, "AGENTS.md");
    await writeFile(
      path,
      (await readFile(path, "utf8")).replace("owned value", "tampered value"),
    );

    await expect(manager.sync({
      agentId: "fitness",
      artifacts: managedArtifacts("new value\n"),
    })).resolves.toMatchObject({
      status: "conflicted",
      reasonCode: "MANAGED_ARTIFACT_TAMPERED",
    });
    expect(fixture.activeAgents.get("fitness")).toBe(created.workspace);
  });

  it("treats lost metadata in a managed workspace as conflict, not adoption", async () => {
    const fixture = await workspaceFixture();
    const manager = createFitnessAgentWorkspaceManager({
      runtimeDirectory: fixture.runtimeDirectory,
      host: fixture.host,
    });
    const created = await manager.initialize({
      agentId: "fitness",
      artifacts: managedArtifacts("owned value\n"),
    });
    await rm(join(created.workspace!, ".stella-fitness-ownership.json"));

    await expect(manager.sync({
      agentId: "fitness",
      artifacts: managedArtifacts("new value\n"),
    })).resolves.toMatchObject({
      status: "conflicted",
      reasonCode: "OWNERSHIP_MANIFEST_MISSING",
    });
  });

  it("treats a manifest with deleted artifact ownership as a conflict", async () => {
    const fixture = await workspaceFixture();
    const manager = createFitnessAgentWorkspaceManager({
      runtimeDirectory: fixture.runtimeDirectory,
      host: fixture.host,
    });
    const created = await manager.initialize({
      agentId: "fitness",
      artifacts: managedArtifacts("owned value\n"),
    });
    const manifestPath = join(
      created.workspace!,
      ".stella-fitness-ownership.json",
    );
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.artifacts = [];
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    await expect(manager.sync({
      agentId: "fitness",
      artifacts: managedArtifacts("new value\n"),
    })).resolves.toMatchObject({
      status: "conflicted",
      reasonCode: "OWNERSHIP_MARKER_SET_MISMATCH",
    });
  });

  it("serializes concurrent initialization and publishes one workspace", async () => {
    const fixture = await workspaceFixture();
    const manager = createFitnessAgentWorkspaceManager({
      runtimeDirectory: fixture.runtimeDirectory,
      host: fixture.host,
    });
    const input = {
      agentId: "fitness",
      artifacts: managedArtifacts("owned value\n"),
    } as const;

    const results = await Promise.all([
      manager.initialize(input),
      manager.initialize(input),
    ]);

    expect(new Set(results.map(({ workspace }) => workspace)).size).toBe(1);
    expect(fixture.calls.filter((call) => call.startsWith("prepare:")))
      .toHaveLength(1);
    expect(fixture.calls.filter((call) => call.startsWith("activate:")))
      .toHaveLength(1);
  });

  it("locks an alternate Agent ID against concurrent direct initialization", async () => {
    const fixture = await workspaceFixture();
    const existingWorkspace = join(fixture.root, "workspace-fitness");
    await mkdir(existingWorkspace);
    await writeFile(join(existingWorkspace, "IDENTITY.md"), "existing identity\n");
    await writeFile(join(existingWorkspace, "SOUL.md"), "existing soul\n");
    fixture.activeAgents.set("fitness", existingWorkspace);
    const manager = createFitnessAgentWorkspaceManager({
      runtimeDirectory: fixture.runtimeDirectory,
      host: fixture.host,
    });
    const artifacts = managedArtifacts("recording-only\n");

    const [adopted, initialized] = await Promise.all([
      manager.adopt({
        agentId: "fitness",
        artifacts,
        choice: { alternateAgentId: "fitness-private" },
      }),
      manager.initialize({ agentId: "fitness-private", artifacts }),
    ]);

    expect(adopted.workspace).toBe(initialized.workspace);
    expect(fixture.calls.filter((call) => call.startsWith("prepare:")))
      .toHaveLength(1);
    expect(fixture.calls.filter((call) => call.startsWith("activate:fitness-private:")))
      .toHaveLength(1);
  });

  it("recovers an abandoned cross-process initialization lock", async () => {
    const fixture = await workspaceFixture();
    const locks = join(fixture.runtimeDirectory, "workspace-locks");
    await mkdir(locks);
    await writeFile(join(locks, "fitness.lock"), "999999:dead-owner\n");
    const manager = createFitnessAgentWorkspaceManager({
      runtimeDirectory: fixture.runtimeDirectory,
      host: fixture.host,
    });

    await expect(manager.initialize({
      agentId: "fitness",
      artifacts: managedArtifacts("owned value\n"),
    })).resolves.toMatchObject({ status: "ready", created: true });
  });

  it("keeps the previous complete workspace when activation fails and recovers on retry", async () => {
    const fixture = await workspaceFixture();
    const manager = createFitnessAgentWorkspaceManager({
      runtimeDirectory: fixture.runtimeDirectory,
      host: fixture.host,
    });
    const created = await manager.initialize({
      agentId: "fitness",
      artifacts: managedArtifacts("revision one\n"),
    });
    const activateAgent = fixture.host.activateAgent!;
    fixture.host.activateAgent = async () => {
      throw new Error("simulated host activation crash");
    };

    await expect(manager.sync({
      agentId: "fitness",
      artifacts: managedArtifacts("revision two\n"),
    })).rejects.toThrow("simulated host activation crash");
    expect(fixture.activeAgents.get("fitness")).toBe(created.workspace);
    expect(await readFile(join(created.workspace!, "AGENTS.md"), "utf8"))
      .toContain("revision one");

    fixture.host.activateAgent = activateAgent;
    await expect(manager.sync({
      agentId: "fitness",
      artifacts: managedArtifacts("revision two\n"),
    })).resolves.toMatchObject({ status: "ready", ownershipRevision: 2 });
  });

  it("recovers a durable merge choice when activation crashes after switching", async () => {
    const fixture = await workspaceFixture();
    const existingWorkspace = join(fixture.root, "workspace-fitness");
    await mkdir(existingWorkspace);
    await writeFile(join(existingWorkspace, "IDENTITY.md"), "existing identity\n");
    await writeFile(join(existingWorkspace, "SOUL.md"), "existing soul\n");
    fixture.activeAgents.set("fitness", existingWorkspace);
    const activate = fixture.host.activateAgent!;
    fixture.host.activateAgent = async (agentId, workspace) => {
      await activate(agentId, workspace);
      throw new Error("simulated crash after switch");
    };
    const manager = createFitnessAgentWorkspaceManager({
      runtimeDirectory: fixture.runtimeDirectory,
      host: fixture.host,
    });
    const input = {
      agentId: "fitness",
      artifacts: managedArtifacts("recording-only\n"),
      choice: "merge" as const,
    };

    await expect(manager.adopt(input)).rejects.toThrow("simulated crash after switch");
    await expect(manager.adoptionRecord("fitness")).resolves.toMatchObject({
      choice: "merge",
      result: { status: "ready", adopted: true },
    });

    fixture.host.activateAgent = activate;
    await expect(manager.adopt(input)).resolves.toMatchObject({
      status: "ready",
      adopted: true,
    });
    await expect(manager.adoptionRecord("fitness")).resolves.toMatchObject({
      choice: "merge",
      result: { status: "ready", adopted: true },
    });
  });

  it("persists an alternate adoption result before the Host switches Agent IDs", async () => {
    const fixture = await workspaceFixture();
    const existingWorkspace = join(fixture.root, "workspace-fitness");
    await mkdir(existingWorkspace);
    await writeFile(join(existingWorkspace, "IDENTITY.md"), "existing identity\n");
    await writeFile(join(existingWorkspace, "SOUL.md"), "existing soul\n");
    fixture.activeAgents.set("fitness", existingWorkspace);
    const activate = fixture.host.activateAgent!;
    fixture.host.activateAgent = async (agentId, workspace) => {
      await activate(agentId, workspace);
      throw new Error("simulated crash after alternate switch");
    };
    const manager = createFitnessAgentWorkspaceManager({
      runtimeDirectory: fixture.runtimeDirectory,
      host: fixture.host,
    });

    await expect(manager.adopt({
      agentId: "fitness",
      artifacts: [{ path: "AGENTS.md", managedContent: "recording-only\n" }],
      choice: { alternateAgentId: "fitness-private" },
    })).rejects.toThrow("simulated crash after alternate switch");
    expect(fixture.activeAgents.has("fitness-private")).toBe(true);
    await expect(manager.adoptionRecord("fitness")).resolves.toMatchObject({
      choice: { alternateAgentId: "fitness-private" },
      result: {
        status: "ready",
        agentId: "fitness-private",
        workspace: fixture.activeAgents.get("fitness-private"),
      },
    });
  });

  it("reports a conflict when the source workspace changes during copying", async () => {
    const fixture = await workspaceFixture();
    const existingWorkspace = join(fixture.root, "workspace-fitness");
    await mkdir(existingWorkspace);
    await writeFile(join(existingWorkspace, "IDENTITY.md"), "existing identity\n");
    await writeFile(join(existingWorkspace, "SOUL.md"), "existing soul\n");
    await writeFile(join(existingWorkspace, "notes.txt"), "before\n");
    fixture.activeAgents.set("fitness", existingWorkspace);
    const manager = createFitnessAgentWorkspaceManager({
      runtimeDirectory: fixture.runtimeDirectory,
      host: fixture.host,
      async copyWorkspace(source, destination) {
        await cp(source, destination, {
          recursive: true,
          errorOnExist: true,
          preserveTimestamps: true,
        });
        await writeFile(join(source, "notes.txt"), "after\n");
      },
    });

    await expect(manager.adopt({
      agentId: "fitness",
      artifacts: managedArtifacts("recording-only\n"),
      choice: "merge",
    })).resolves.toMatchObject({
      status: "conflicted",
      reasonCode: "WORKSPACE_CHANGED_DURING_READ",
    });
    expect(fixture.activeAgents.get("fitness")).toBe(existingWorkspace);
  });

  it("reports a conflict when a source file disappears during copying", async () => {
    const fixture = await workspaceFixture();
    const existingWorkspace = join(fixture.root, "workspace-fitness");
    await mkdir(existingWorkspace);
    await writeFile(join(existingWorkspace, "IDENTITY.md"), "existing identity\n");
    await writeFile(join(existingWorkspace, "SOUL.md"), "existing soul\n");
    fixture.activeAgents.set("fitness", existingWorkspace);
    const manager = createFitnessAgentWorkspaceManager({
      runtimeDirectory: fixture.runtimeDirectory,
      host: fixture.host,
      async copyWorkspace() {
        const error = new Error("source disappeared");
        Object.assign(error, { code: "ENOENT" });
        throw error;
      },
    });

    await expect(manager.adopt({
      agentId: "fitness",
      artifacts: managedArtifacts("recording-only\n"),
      choice: "merge",
    })).resolves.toMatchObject({
      status: "conflicted",
      reasonCode: "WORKSPACE_CHANGED_DURING_READ",
    });
  });

  it("blocks before creating files when the public Agent bootstrap seam is unavailable", async () => {
    const fixture = await workspaceFixture();
    delete fixture.host.prepareWorkspace;
    const manager = createFitnessAgentWorkspaceManager({
      runtimeDirectory: fixture.runtimeDirectory,
      host: fixture.host,
    });

    await expect(manager.initialize({
      agentId: "fitness",
      artifacts: managedArtifacts("owned value\n"),
    })).resolves.toEqual({
      status: "blocked",
      agentId: "fitness",
      reasonCode: "AGENT_FILES_BOOTSTRAP_UNAVAILABLE",
    });
    expect(fixture.activeAgents).toEqual(new Map());
    expect(fixture.calls).toEqual([]);
  });

  it("blocks ordinary Agent file tools from modifying managed sections", async () => {
    const fixture = await workspaceFixture();
    const manager = createFitnessAgentWorkspaceManager({
      runtimeDirectory: fixture.runtimeDirectory,
      host: fixture.host,
    });
    const created = await manager.initialize({
      agentId: "fitness",
      artifacts: managedArtifacts("owned value\n"),
    });
    const policy = createManagedArtifactToolPolicy({ host: fixture.host });

    await expect(policy.evaluate({
      toolName: "apply_patch",
      params: {},
      derivedPaths: [join(created.workspace!, "AGENTS.md")],
    }, {
      agentId: "fitness",
      toolName: "apply_patch",
    })).resolves.toEqual({
      block: true,
      blockReason: "Stella Fitness managed Agent artifacts are read-only",
    });
    const agentsPath = join(created.workspace!, "AGENTS.md");
    const emptyUserSection = [
      "<!-- stella-fitness:user:start -->",
      "",
      "<!-- stella-fitness:user:end -->",
    ].join("\n");
    const populatedUserSection = [
      "<!-- stella-fitness:user:start -->",
      "my user instruction",
      "<!-- stella-fitness:user:end -->",
    ].join("\n");
    await expect(policy.evaluate({
      toolName: "edit_file",
      params: {
        path: agentsPath,
        oldText: emptyUserSection,
        newText: populatedUserSection,
      },
    }, {
      agentId: "fitness",
      toolName: "edit_file",
    })).resolves.toBeUndefined();
    await writeFile(
      agentsPath,
      (await readFile(agentsPath, "utf8")).replace(
        emptyUserSection,
        populatedUserSection,
      ),
    );
    await expect(policy.evaluate({
      toolName: "edit_file",
      params: {
        path: agentsPath,
        oldText: "my user instruction",
        newText: "my revised instruction",
      },
    }, {
      agentId: "fitness",
      toolName: "edit_file",
    })).resolves.toBeUndefined();
    await expect(policy.evaluate({
      toolName: "edit_file",
      params: {
        path: agentsPath,
        oldText: "owned value",
        newText: "tampered value",
      },
    }, {
      agentId: "fitness",
      toolName: "edit_file",
    })).resolves.toEqual({
      block: true,
      blockReason: "Stella Fitness managed Agent artifacts are read-only",
    });
    await expect(policy.evaluate({
      toolName: "apply_patch",
      params: {},
      derivedPaths: [join(created.workspace!, "MEMORY.md")],
    }, {
      agentId: "fitness",
      toolName: "apply_patch",
    })).resolves.toBeUndefined();
    await expect(policy.evaluate({
      toolName: "apply_patch",
      params: {},
      derivedPaths: [join(created.workspace!, "AGENTS.md")],
    }, {
      agentId: "main",
      toolName: "apply_patch",
    })).resolves.toBeUndefined();
    const ownershipPath = join(
      created.workspace!,
      ".stella-fitness-ownership.json",
    );
    const ownership = JSON.parse(await readFile(ownershipPath, "utf8"));
    ownership.artifacts = [];
    await writeFile(ownershipPath, `${JSON.stringify(ownership, null, 2)}\n`);
    await expect(policy.evaluate({
      toolName: "edit_file",
      params: {
        path: agentsPath,
        oldText: "my user instruction",
        newText: "another instruction",
      },
    }, {
      agentId: "fitness",
      toolName: "edit_file",
    })).resolves.toEqual({
      block: true,
      blockReason: "Stella Fitness managed Agent artifacts are read-only",
    });
    await rm(ownershipPath);
    await expect(policy.evaluate({
      toolName: "edit_file",
      params: {
        path: agentsPath,
        oldText: "my user instruction",
        newText: "another instruction",
      },
    }, {
      agentId: "fitness",
      toolName: "edit_file",
    })).resolves.toEqual({
      block: true,
      blockReason: "Stella Fitness managed Agent artifacts are read-only",
    });
  });
});

function managedArtifacts(agentsContent: string) {
  return [
    { path: "IDENTITY.md", managedContent: "Stella Fitness identity projection\n" },
    { path: "SOUL.md", managedContent: "Stella Fitness persona projection\n" },
    { path: "AGENTS.md", managedContent: agentsContent },
  ] as const;
}

async function workspaceFixture(): Promise<{
  root: string;
  runtimeDirectory: string;
  calls: string[];
  activeAgents: Map<string, string>;
  host: FitnessAgentWorkspaceHost;
}> {
  const root = await mkdtemp(join(tmpdir(), "stella-agent-workspace-test-"));
  temporaryRoots.push(root);
  const runtimeDirectory = join(root, "runtime");
  await mkdir(runtimeDirectory);
  const calls: string[] = [];
  const activeAgents = new Map<string, string>();
  return {
    root,
    runtimeDirectory,
    calls,
    activeAgents,
    host: {
      preflight() {
        calls.push("preflight");
        return { ready: true };
      },
      discoverAgent(agentId) {
        const workspace = activeAgents.get(agentId);
        return workspace === undefined
          ? { exists: false, workspace: join(root, `workspace-${agentId}`) }
          : { exists: true, workspace };
      },
      async prepareWorkspace(workspace) {
        calls.push(`prepare:${workspace}`);
        await mkdir(workspace, { recursive: true });
        await writeFile(join(workspace, "IDENTITY.md"), "Host bootstrap identity\n");
        await writeFile(join(workspace, "SOUL.md"), "Host bootstrap soul\n");
      },
      async activateAgent(agentId, workspace) {
        calls.push(`activate:${agentId}:${workspace}`);
        activeAgents.set(agentId, workspace);
      },
    },
  };
}
