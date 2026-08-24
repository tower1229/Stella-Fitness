import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { verifyTelegramChannelFlow } from "./verify-channel-e2e.mjs";
import { resolveCleanInstallNpmCache } from "./clean-install-cache.mjs";

const workspace = fileURLToPath(new URL("../", import.meta.url));
const temporaryRoot = mkdtempSync(join(tmpdir(), "stella-clean-install-"));
const openclaw = resolve(workspace, "node_modules/.bin/openclaw");
const stateDir = join(temporaryRoot, "state");
const cleanInstallNpmCache = resolveCleanInstallNpmCache({
  temporaryRoot,
  environment: process.env,
});
const commandEnvironment = {
  ...process.env,
  OPENCLAW_HOME: join(temporaryRoot, "home"),
  OPENCLAW_STATE_DIR: stateDir,
  OPENCLAW_CONFIG_PATH: join(stateDir, "openclaw.json"),
  NPM_CONFIG_CACHE: cleanInstallNpmCache,
  npm_config_cache: cleanInstallNpmCache,
};
const progress = (message) =>
  process.stderr.write(`[clean-install] ${message}\n`);

function run(command, args) {
  return execFileSync(command, args, {
    cwd: workspace,
    env: commandEnvironment,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

try {
  progress("packing workspace");
  const [pack] = JSON.parse(run("npm", [
    "pack",
    "--json",
    "--pack-destination",
    temporaryRoot,
    "--cache",
    cleanInstallNpmCache,
  ]));
  const tarball = pack.filename;
  progress("workspace packed");
  run(openclaw, [
    "plugins",
    "install",
    `npm-pack:${join(temporaryRoot, tarball)}`,
    "--force",
  ]);
  progress("package installed");
  run(openclaw, [
    "config",
    "set",
    "plugins.allow",
    '["stella-fitness"]',
  ]);
  run(openclaw, [
    "config",
    "set",
    "plugins.entries.stella-fitness.hooks.allowConversationAccess",
    "true",
  ]);
  run(openclaw, [
    "config",
    "set",
    "plugins.entries.stella-fitness.config",
    JSON.stringify({ dedicatedAgentId: "fitness" }),
    "--strict-json",
  ]);

  const inspection = JSON.parse(
    run(openclaw, [
      "plugins",
      "inspect",
      "stella-fitness",
      "--runtime",
      "--json",
    ]),
  );
  const status = run(openclaw, ["stella-fitness", "status"]);
  progress("runtime inspection complete");
  const expectedStatus =
    "Stella Fitness: BLOCKED_CONFIGURATION\ncontract: openclaw>=2026.6.34\nscope: recording-only\ntechnical-readiness: personal-data-directory: blocked - Runtime-owned Stella Personal Data locator is unavailable (LOCATOR_REQUIRED)\ntechnical-readiness: conversation: ready - Plugin conversation hook access is enabled\ntechnical-readiness: time-zone: blocked - Configure agents.defaults.userTimezone with an IANA timezone\ntechnical-readiness: media: ready - OpenClaw structured media extraction is available\ntechnical-readiness: model-permission: setup-required - Configure an allowlisted extraction provider and model\nreason: CONTEXT_LOCATOR_INVALID: Runtime-owned Stella Personal Data locator is unavailable (LOCATOR_REQUIRED)\nreason: USER_TIMEZONE_REQUIRED: Configure agents.defaults.userTimezone with an IANA timezone\ncontext-sync: degraded - Runtime Identity Context is unavailable (IDENTITY_CONTEXT_UNAVAILABLE)";

  if (inspection.plugin.status !== "loaded") {
    throw new Error(`Plugin did not load: ${inspection.plugin.status}`);
  }
  if (inspection.plugin.hookCount !== 5) {
    throw new Error(`Expected 5 Plugin hooks, got ${inspection.plugin.hookCount}`);
  }
  if (!inspection.plugin.commands.includes("stella-status")) {
    throw new Error("Plugin command stella-status was not registered");
  }
  if (!inspection.plugin.commands.includes("stella-start")) {
    throw new Error("Plugin command stella-start was not registered");
  }
  const commands = [...inspection.plugin.commands].sort();
  const expectedCommands = [
    "stella-12rm",
    "stella-activate",
    "stella-confirm",
    "stella-facts",
    "stella-prerequisite",
    "stella-print",
    "stella-start",
    "stella-status",
    "stella-weight",
    "stella-workspace",
  ];
  if (JSON.stringify(commands) !== JSON.stringify(expectedCommands)) {
    throw new Error(
      `Plugin exposes unexpected commands: ${JSON.stringify(commands)}`,
    );
  }
  if (inspection.diagnostics.length !== 0) {
    throw new Error(
      `Plugin diagnostics are not empty: ${JSON.stringify(inspection.diagnostics)}`,
    );
  }
  if (status !== expectedStatus) {
    throw new Error(`Unexpected status response: ${JSON.stringify(status)}`);
  }
  const recording = await verifyInstalledRecordingFlow();
  progress("installed scenario recording complete");
  const channel = await verifyTelegramChannelFlow({
    workspace,
    temporaryRoot,
    openclaw,
    stateDir,
    commandEnvironment,
    run,
  });
  progress("Telegram channel journey complete");

  process.stdout.write(
    `${JSON.stringify({ installed: true, loaded: true, hooks: 5, commands, diagnostics: 0, recording, channel, status })}\n`,
  );
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}


async function verifyInstalledRecordingFlow() {
  const projectsRoot = join(stateDir, "npm", "projects");
  const projects = readdirSync(projectsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  if (projects.length !== 1) {
    throw new Error(
      `Expected one clean-install npm project, got ${projects.length}`,
    );
  }
  const installedPackage = join(
    projectsRoot,
    projects[0],
    "node_modules",
    "@tower1229",
    "stella-fitness",
  );
  const scenario = await import(
    pathToFileURL(join(installedPackage, "dist/scenario/harness.js")).href
  );
  const personalDataDirectory = join(temporaryRoot, "personal-data");
  const runtimeDirectory = join(temporaryRoot, "runtime-data");
  mkdirSync(personalDataDirectory, { recursive: true });
  mkdirSync(runtimeDirectory, { recursive: true });
  const harness = scenario.createScenarioHarness({
    extractionRuntime: new scenario.ControlledExtractionRuntime([]),
    personalDataDirectory: () => personalDataDirectory,
    runtimeDirectory: () => runtimeDirectory,
    preflight: () => ({ readiness: "READY", reasons: [] }),
  });
  try {
    const recorded = await harness.recordBodyWeight({
      text: "今天体重 68.4 kg",
      receivedAt: "2026-08-11T03:00:00.000Z",
      source: { channel: "clean-install", messageId: "recording-flow-1" },
    });
    if (
      recorded.status !== "recorded" ||
      recorded.observation.value.amount !== 68.4 ||
      recorded.observation.value.unit !== "kg" ||
      recorded.view.points.length !== 1 ||
      recorded.view.errors.length !== 0
    ) {
      throw new Error(
        `Installed package did not persist the expected Observation: ${JSON.stringify(recorded)}`,
      );
    }
    return {
      kind: recorded.observation.kind,
      persisted: true,
      points: recorded.view.points.length,
    };
  } finally {
    await harness.shutdown();
  }
}
