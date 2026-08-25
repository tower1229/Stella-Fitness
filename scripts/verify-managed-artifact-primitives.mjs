import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const workspace = new URL("../", import.meta.url);
const root = await mkdtemp(join(tmpdir(), "stella-lifecycle-package-"));

try {
  const [{ createFitnessAgentWorkspaceManager }, { resolveStellaPersonalDataPaths }] =
    await Promise.all([
      import(new URL("dist/agent-workspace/manager.js", workspace).href),
      import(new URL("dist/context/runtime-contract.js", workspace).href),
    ]);
  const runtimeDirectory = join(root, "runtime");
  const repository = join(root, "repository");
  await mkdir(join(repository, "stella", "fitness"), { recursive: true });
  await mkdir(join(repository, "stella", "projections", "fitness"), {
    recursive: true,
  });
  const canonicalPath = join(repository, "stella", "fitness", "canonical.txt");
  await writeFile(canonicalPath, "canonical fact\n");
  const activeAgents = new Map();
  let activationCrash = false;
  const host = {
    preflight: () => ({ ready: true }),
    discoverAgent(agentId) {
      return activeAgents.has(agentId)
        ? { exists: true, workspace: activeAgents.get(agentId) }
        : { exists: false, workspace: join(root, `workspace-${agentId}`) };
    },
    async prepareWorkspace(candidate) {
      await mkdir(candidate, { recursive: true });
      await writeFile(join(candidate, "IDENTITY.md"), "Host identity\n");
      await writeFile(join(candidate, "SOUL.md"), "Host soul\n");
    },
    async activateAgent(agentId, candidate) {
      if (activationCrash) throw new Error("simulated packaged upgrade crash");
      activeAgents.set(agentId, candidate);
    },
    async retainAgent(agentId, candidate) {
      activeAgents.set(agentId, candidate);
    },
  };
  const artifacts = (revision) => [
    { path: "AGENTS.md", managedContent: `recording-only ${revision}\n` },
    { path: "IDENTITY.md", managedContent: "Stella identity\n" },
    { path: "SOUL.md", managedContent: "Stella persona\n" },
    { path: "USER.md", managedContent: "verified user context\n" },
  ];
  const manager = createFitnessAgentWorkspaceManager({ runtimeDirectory, host });
  const initial = await manager.initialize({
    agentId: "fitness",
    artifacts: artifacts("v1"),
  });
  assert.equal(initial.status, "ready");

  const disabledWorkspace = activeAgents.get("fitness");
  assert.equal(disabledWorkspace, initial.workspace);

  activationCrash = true;
  await assert.rejects(
    manager.sync({ agentId: "fitness", artifacts: artifacts("v2") }),
    /simulated packaged upgrade crash/u,
  );
  assert.equal(activeAgents.get("fitness"), initial.workspace);
  activationCrash = false;
  const upgraded = await manager.sync({
    agentId: "fitness",
    artifacts: artifacts("v2"),
  });
  assert.equal(upgraded.status, "ready");

  const uninstalled = await manager.transitionToStandaloneDegraded({
    agentId: "fitness",
    asOf: "2026-08-24T01:00:00.000Z",
  });
  assert.equal(uninstalled.status, "standalone-degraded");
  assert.match(
    await readFile(join(uninstalled.workspace, "AGENTS.md"), "utf8"),
    /status: standalone-degraded[\s\S]*must not be represented as current or real-time/u,
  );
  assert.equal(await readFile(canonicalPath, "utf8"), "canonical fact\n");

  const restarted = createFitnessAgentWorkspaceManager({ runtimeDirectory, host });
  assert.deepEqual(
    await restarted.transitionToStandaloneDegraded({
      agentId: "fitness",
      asOf: "2026-08-24T01:00:00.000Z",
    }),
    uninstalled,
  );
  const reinstalled = await restarted.sync({
    agentId: "fitness",
    artifacts: artifacts("v2"),
  });
  assert.equal(reinstalled.status, "ready");
  assert.doesNotMatch(
    await readFile(join(reinstalled.workspace, "AGENTS.md"), "utf8"),
    /standalone-degraded/u,
  );

  await writeFile(
    join(reinstalled.workspace, "SOUL.md"),
    (await readFile(join(reinstalled.workspace, "SOUL.md"), "utf8"))
      .replace("Stella persona", "tampered persona"),
  );
  const conflicted = await restarted.transitionToStandaloneDegraded({
    agentId: "fitness",
    asOf: "2026-08-24T01:00:00.000Z",
  });
  assert.equal(conflicted.status, "conflicted");
  assert.equal(conflicted.reasonCode, "MANAGED_ARTIFACT_TAMPERED");
  assert.equal(activeAgents.get("fitness"), reinstalled.workspace);

  const hostConfig = {
    plugins: {
      entries: {
        "cognitive-runtime": {
          config: {
            runtime: { instance_id: "runtime-test" },
            stella: {
              schema_version: "stella.personal-data-locator/v1",
              instance_id: "runtime-test",
              personal_data_repository: repository,
            },
          },
        },
      },
    },
  };
  assert.equal(
    resolveStellaPersonalDataPaths(hostConfig).repository,
    await realpath(repository),
  );
  delete hostConfig.plugins.entries["cognitive-runtime"];
  assert.throws(
    () => resolveStellaPersonalDataPaths(hostConfig),
    /LOCATOR_REQUIRED/u,
  );

  process.stdout.write(`${JSON.stringify({
    scope: "packaged-primitives-only",
    builtLifecyclePrimitives: "passed",
    upgradeCrash: "passed",
    standaloneTransition: "passed",
    hostRestart: "passed",
    reinstall: "passed",
    ownershipConflict: "passed",
  })}\n`);
} finally {
  await rm(root, { recursive: true, force: true });
}
